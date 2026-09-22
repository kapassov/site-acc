import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as postgresStore from "./postgres-store";
import { canBindOrder, customerChanged } from "./model";
import type {
  BrowserPushSubscription,
  DeliveryResult,
  NotificationHistoryEntry,
  PushAudience,
  PushPreferences,
  PushStoreData,
  PushStoreStats,
  StoredPushSubscription,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "push.json");
const BACKUP_FILE = path.join(DATA_DIR, "push.json.bak");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const HISTORY_LIMIT = 500;
const BINDING_LIMIT = 5_000;

type StoreState = {
  cache: PushStoreData | null;
  chain: Promise<void>;
};

const globalStore = globalThis as typeof globalThis & {
  __inkarPushStore?: StoreState;
};

const state = globalStore.__inkarPushStore ?? {
  cache: null,
  chain: Promise.resolve(),
};
globalStore.__inkarPushStore = state;

export interface UpsertSubscriptionInput {
  subscription: BrowserPushSubscription;
  customerId: string;
  deviceId?: string;
  deviceToken?: string;
  preferences?: Partial<PushPreferences>;
  locale?: string;
  city?: string;
  userAgent?: string;
}

export interface DeviceCredentials {
  deviceId: string;
  deviceToken: string;
  preferences: PushPreferences;
}

/**
 * Production uses the shared Postgres store whenever a database URL is
 * configured. The JSON backend is intentionally retained only for local
 * development, where running Postgres should not be a prerequisite.
 */
function postgresEnabled(): boolean {
  return Boolean(String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim());
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): PushStoreData {
  return {
    version: 1,
    updatedAt: nowIso(),
    subscriptions: [],
    orderBindings: [],
    history: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredSubscription(value: unknown): value is StoredPushSubscription {
  if (!isRecord(value) || !isRecord(value.subscription) || !isRecord(value.preferences)) return false;
  const keys = value.subscription.keys;
  return (
    typeof value.id === "string" &&
    typeof value.deviceId === "string" &&
    typeof value.deviceTokenHash === "string" &&
    typeof value.subscription.endpoint === "string" &&
    isRecord(keys) &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string" &&
    typeof value.preferences.orders === "boolean" &&
    typeof value.preferences.promos === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function normalizeStore(value: unknown): PushStoreData {
  if (!isRecord(value)) return emptyStore();
  const subscriptions = Array.isArray(value.subscriptions)
    ? value.subscriptions.filter(isStoredSubscription).map((item) => ({
        ...item,
        failureCount: Number.isFinite(item.failureCount) ? Math.max(0, Number(item.failureCount)) : 0,
      }))
    : [];
  const orderBindings = Array.isArray(value.orderBindings)
    ? value.orderBindings.filter((item): item is PushStoreData["orderBindings"][number] => (
        isRecord(item) &&
        typeof item.orderNumber === "string" &&
        typeof item.deviceId === "string" &&
        typeof item.createdAt === "string" &&
        typeof item.updatedAt === "string"
      ))
    : [];
  const history = Array.isArray(value.history)
    ? value.history.filter((item): item is NotificationHistoryEntry => (
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.kind === "string" &&
        typeof item.createdAt === "string" &&
        isRecord(item.payload) &&
        isRecord(item.delivery)
      )).slice(0, HISTORY_LIMIT)
    : [];
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
    subscriptions,
    orderBindings: orderBindings.slice(-BINDING_LIMIT),
    history,
  };
}

async function parseFile(file: string): Promise<PushStoreData> {
  return normalizeStore(JSON.parse(await fs.readFile(file, "utf8")));
}

async function loadStore(): Promise<PushStoreData> {
  if (state.cache) return state.cache;
  try {
    state.cache = await parseFile(STORE_FILE);
  } catch {
    try {
      state.cache = await parseFile(BACKUP_FILE);
    } catch {
      state.cache = emptyStore();
    }
  }
  return state.cache;
}

async function persistStore(data: PushStoreData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try { await fs.chmod(DATA_DIR, 0o700); } catch { /* Windows may ignore POSIX modes. */ }

  const tempFile = path.join(DATA_DIR, `.push-${process.pid}-${randomUUID()}.tmp`);
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await fs.chmod(tempFile, 0o600); } catch { /* Best effort on Windows. */ }

  try {
    await fs.rename(tempFile, STORE_FILE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") {
      await fs.rm(tempFile, { force: true });
      throw error;
    }

    // Windows cannot atomically replace an existing file. Keep a recoverable
    // backup while swapping, and restore it if the second rename fails.
    await fs.rm(BACKUP_FILE, { force: true });
    let movedOriginal = false;
    try {
      await fs.rename(STORE_FILE, BACKUP_FILE);
      movedOriginal = true;
    } catch (moveError) {
      if ((moveError as NodeJS.ErrnoException).code !== "ENOENT") throw moveError;
    }
    try {
      await fs.rename(tempFile, STORE_FILE);
      if (movedOriginal) await fs.rm(BACKUP_FILE, { force: true });
    } catch (swapError) {
      if (movedOriginal) {
        try { await fs.rename(BACKUP_FILE, STORE_FILE); } catch { /* Preserve the original error. */ }
      }
      throw swapError;
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  }
}

async function mutateStore<T>(mutator: (data: PushStoreData) => T | Promise<T>): Promise<T> {
  let result!: T;
  const operation = state.chain.then(async () => {
    // Mutate a copy so a failed disk write cannot leak an unpersisted state
    // through the process cache.
    const data = structuredClone(await loadStore());
    result = await mutator(data);
    data.updatedAt = nowIso();
    await persistStore(data);
    state.cache = data;
  });
  state.chain = operation.catch(() => undefined);
  await operation;
  return result;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(record: StoredPushSubscription, token: string): boolean {
  if (!token) return false;
  const expected = Buffer.from(record.deviceTokenHash, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

function clipped(value: string | undefined, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}

function preferencesFor(
  current: PushPreferences | undefined,
  patch: Partial<PushPreferences> | undefined,
): PushPreferences {
  return {
    orders: typeof patch?.orders === "boolean" ? patch.orders : (current?.orders ?? true),
    promos: typeof patch?.promos === "boolean" ? patch.promos : (current?.promos ?? false),
  };
}

export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<DeviceCredentials> {
  if (postgresEnabled()) return postgresStore.upsertSubscription(input);
  return mutateStore((data) => {
    const now = nowIso();
    let record: StoredPushSubscription | undefined;
    let deviceToken = "";

    if (input.deviceId && input.deviceToken) {
      const candidate = data.subscriptions.find((item) => item.deviceId === input.deviceId);
      if (candidate && tokenMatches(candidate, input.deviceToken)) {
        record = candidate;
        deviceToken = input.deviceToken;
      }
    }

    if (!record) {
      record = data.subscriptions.find((item) => item.subscription.endpoint === input.subscription.endpoint);
      deviceToken = newDeviceToken();
      if (record) {
        record.deviceTokenHash = tokenHash(deviceToken);
      }
    }

    if (!record) {
      const deviceId = randomUUID();
      deviceToken = newDeviceToken();
      record = {
        id: randomUUID(),
        deviceId,
        customerId: input.customerId,
        deviceTokenHash: tokenHash(deviceToken),
        subscription: input.subscription,
        preferences: preferencesFor(undefined, input.preferences),
        locale: clipped(input.locale, 20),
        city: clipped(input.city, 80),
        userAgent: clipped(input.userAgent, 300),
        createdAt: now,
        updatedAt: now,
        failureCount: 0,
      };
      data.subscriptions.push(record);
    } else {
      if (customerChanged(record.customerId, input.customerId)) {
        data.orderBindings = data.orderBindings.filter((binding) => binding.deviceId !== record!.deviceId);
      }
      // One browser endpoint belongs to exactly one device record.
      for (const duplicate of data.subscriptions) {
        if (duplicate.id !== record.id && duplicate.subscription.endpoint === input.subscription.endpoint && !duplicate.revokedAt) {
          duplicate.revokedAt = now;
          duplicate.revokeReason = "endpoint_reassigned";
          duplicate.updatedAt = now;
        }
      }
      record.subscription = input.subscription;
      record.customerId = input.customerId;
      record.preferences = preferencesFor(record.preferences, input.preferences);
      record.locale = clipped(input.locale, 20) ?? record.locale;
      record.city = clipped(input.city, 80) ?? record.city;
      record.userAgent = clipped(input.userAgent, 300) ?? record.userAgent;
      record.updatedAt = now;
      record.failureCount = 0;
      delete record.revokedAt;
      delete record.revokeReason;
      delete record.lastError;
    }

    return {
      deviceId: record.deviceId,
      deviceToken,
      preferences: record.preferences,
    };
  });
}

export async function authenticateDevice(deviceId: string, deviceToken: string): Promise<StoredPushSubscription | null> {
  if (postgresEnabled()) return postgresStore.authenticateDevice(deviceId, deviceToken);
  await state.chain.catch(() => undefined);
  const data = await loadStore();
  const record = data.subscriptions.find((item) => item.deviceId === deviceId && !item.revokedAt);
  return record && tokenMatches(record, deviceToken) ? structuredClone(record) : null;
}

export async function revokeDevice(deviceId: string, deviceToken: string, reason = "unsubscribed"): Promise<boolean> {
  if (postgresEnabled()) return postgresStore.revokeDevice(deviceId, deviceToken, reason);
  return mutateStore((data) => {
    const record = data.subscriptions.find((item) => item.deviceId === deviceId && !item.revokedAt);
    if (!record || !tokenMatches(record, deviceToken)) return false;
    record.revokedAt = nowIso();
    record.revokeReason = reason;
    record.updatedAt = record.revokedAt;
    return true;
  });
}

export async function bindOrderToDevice(
  orderNumber: string,
  deviceId: string,
  customerId: string,
): Promise<boolean> {
  if (postgresEnabled()) return postgresStore.bindOrderToDevice(orderNumber, deviceId, customerId);
  let ownedOrder: Parameters<typeof canBindOrder>[0];
  try {
    const value: unknown = JSON.parse(await fs.readFile(ORDERS_FILE, "utf8"));
    if (Array.isArray(value)) {
      const candidate = value.find((item) => {
        if (!isRecord(item)) return false;
        return String(item.id || "") === orderNumber
          || String(item.sourceOrderId || "") === orderNumber
          || String(item.n ?? "") === orderNumber;
      });
      if (isRecord(candidate)) {
        ownedOrder = {
          id: String(candidate.id || ""),
          sourceOrderId: String(candidate.sourceOrderId || ""),
          displayNumber: Number(candidate.n || 0),
          customerId: typeof candidate.customerId === "string" ? candidate.customerId : undefined,
        };
      }
    }
  } catch {
    // Missing/corrupt local order storage must fail closed.
  }
  return mutateStore((data) => {
    const device = data.subscriptions.find((item) => item.deviceId === deviceId && !item.revokedAt);
    if (!device || !canBindOrder(ownedOrder, orderNumber, device.customerId, customerId)) return false;
    const now = nowIso();
    const existing = data.orderBindings.find((item) => item.orderNumber === orderNumber && item.deviceId === deviceId);
    if (existing) existing.updatedAt = now;
    else data.orderBindings.push({ orderNumber, deviceId, createdAt: now, updatedAt: now });
    if (data.orderBindings.length > BINDING_LIMIT) {
      data.orderBindings.splice(0, data.orderBindings.length - BINDING_LIMIT);
    }
    return true;
  });
}

export async function subscribersForAudience(audience: PushAudience): Promise<StoredPushSubscription[]> {
  if (postgresEnabled()) return postgresStore.subscribersForAudience(audience);
  await state.chain.catch(() => undefined);
  const data = await loadStore();
  return data.subscriptions
    .filter((item) => !item.revokedAt && Boolean(item.customerId))
    .filter((item) => audience === "all" || item.preferences[audience])
    .map((item) => structuredClone(item));
}

export async function subscribersForOrder(orderNumber: string): Promise<StoredPushSubscription[]> {
  if (postgresEnabled()) return postgresStore.subscribersForOrder(orderNumber);
  await state.chain.catch(() => undefined);
  const data = await loadStore();
  const deviceIds = new Set(
    data.orderBindings.filter((item) => item.orderNumber === orderNumber).map((item) => item.deviceId),
  );
  return data.subscriptions
    .filter((item) => deviceIds.has(item.deviceId) && !item.revokedAt && Boolean(item.customerId) && item.preferences.orders)
    .map((item) => structuredClone(item));
}

export async function applyDeliveryResults(results: DeliveryResult[]): Promise<void> {
  if (postgresEnabled()) return postgresStore.applyDeliveryResults(results);
  if (results.length === 0) return;
  await mutateStore((data) => {
    const now = nowIso();
    const byEndpoint = new Map(results.map((result) => [result.endpoint, result]));
    for (const record of data.subscriptions) {
      const result = byEndpoint.get(record.subscription.endpoint);
      if (!result) continue;
      record.lastSentAt = now;
      record.updatedAt = now;
      if (result.ok) {
        record.lastSuccessAt = now;
        record.failureCount = 0;
        delete record.lastError;
      } else {
        record.failureCount += 1;
        record.lastError = clipped(result.error || `HTTP ${result.statusCode}`, 300);
        if (result.revoked) {
          record.revokedAt = now;
          record.revokeReason = `push_endpoint_${result.statusCode}`;
        }
      }
    }
  });
}

export async function appendHistory(entry: NotificationHistoryEntry): Promise<void> {
  if (postgresEnabled()) return postgresStore.appendHistory(entry);
  await mutateStore((data) => {
    data.history.unshift(entry);
    if (data.history.length > HISTORY_LIMIT) data.history.length = HISTORY_LIMIT;
  });
}

function statsFor(data: PushStoreData): PushStoreStats {
  const active = data.subscriptions.filter((item) => !item.revokedAt && Boolean(item.customerId));
  return {
    subscriptions: {
      total: data.subscriptions.length,
      active: active.length,
      revoked: data.subscriptions.length - active.length,
      orders: active.filter((item) => item.preferences.orders).length,
      promos: active.filter((item) => item.preferences.promos).length,
    },
    orderBindings: data.orderBindings.length,
    history: data.history.length,
    deliveries: data.history.reduce(
      (sum, item) => ({
        sent: sum.sent + item.delivery.sent,
        failed: sum.failed + item.delivery.failed,
        revoked: sum.revoked + item.delivery.revoked,
      }),
      { sent: 0, failed: 0, revoked: 0 },
    ),
  };
}

export async function adminPushSnapshot(limit = 100): Promise<{
  stats: PushStoreStats;
  history: NotificationHistoryEntry[];
  updatedAt: string;
}> {
  if (postgresEnabled()) return postgresStore.adminPushSnapshot(limit);
  await state.chain.catch(() => undefined);
  const data = await loadStore();
  return {
    stats: statsFor(data),
    history: structuredClone(data.history.slice(0, Math.max(1, Math.min(limit, 200)))),
    updatedAt: data.updatedAt,
  };
}
