import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { DeviceCredentials, UpsertSubscriptionInput } from "./store";
import { customerChanged } from "./model";
import type {
  DeliveryResult,
  NotificationHistoryEntry,
  PushAudience,
  PushPreferences,
  PushStoreStats,
  StoredPushSubscription,
} from "./types";

const HISTORY_LIMIT = 500;
const BINDING_LIMIT = 5_000;

type SubscriptionRow = {
  id: string;
  device_id: string;
  customer_id: string | null;
  device_token_hash: string;
  endpoint: string;
  expiration_time: string | number | null;
  p256dh: string;
  auth: string;
  orders_enabled: boolean;
  promos_enabled: boolean;
  locale: string | null;
  city: string | null;
  user_agent: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_sent_at: Date | string | null;
  last_success_at: Date | string | null;
  last_error: string | null;
  failure_count: number;
  revoked_at: Date | string | null;
  revoke_reason: string | null;
};

type HistoryRow = {
  id: string;
  kind: NotificationHistoryEntry["kind"];
  event_name: NotificationHistoryEntry["event"] | null;
  audience: NotificationHistoryEntry["audience"] | null;
  order_number: string | null;
  order_status: string | null;
  payload: NotificationHistoryEntry["payload"];
  delivery: NotificationHistoryEntry["delivery"];
  created_at: Date | string;
};

type Runtime = {
  connectionString: string;
  poolPromise: Promise<Pool> | null;
};

const runtimeRoot = globalThis as typeof globalThis & { __inkarPushDatabase?: Runtime };

function connectionString(): string {
  const value = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!value) throw new Error("push_database_not_configured");
  return value;
}

async function databasePool(): Promise<Pool> {
  const databaseUrl = connectionString();
  let runtime = runtimeRoot.__inkarPushDatabase;
  if (!runtime || runtime.connectionString !== databaseUrl) {
    runtime = { connectionString: databaseUrl, poolPromise: null };
    runtimeRoot.__inkarPushDatabase = runtime;
  }
  if (!runtime.poolPromise) {
    runtime.poolPromise = (async () => {
      const parsed = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error("push_database_url_invalid");
      }
      const { Pool: PgPool } = await import("pg");
      const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(databaseUrl)
        ? { rejectUnauthorized: true }
        : undefined;
      const pool = new PgPool({
        connectionString: databaseUrl,
        ssl,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        application_name: "inkar-push",
      });
      pool.on("error", (error) => console.error("[push/database] idle client error", error));
      return pool;
    })().catch((error) => {
      runtime!.poolPromise = null;
      throw error;
    });
  }
  return runtime.poolPromise;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenHashMatches(expectedHash: string, token: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const expected = Buffer.from(expectedHash, "hex");
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | undefined {
  return value ? iso(value) : undefined;
}

function expirationTime(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function databaseExpirationTime(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function rowToSubscription(row: SubscriptionRow): StoredPushSubscription {
  return {
    id: row.id,
    deviceId: row.device_id,
    customerId: row.customer_id || undefined,
    deviceTokenHash: row.device_token_hash,
    subscription: {
      endpoint: row.endpoint,
      expirationTime: expirationTime(row.expiration_time),
      keys: { p256dh: row.p256dh, auth: row.auth },
    },
    preferences: { orders: row.orders_enabled, promos: row.promos_enabled },
    locale: row.locale || undefined,
    city: row.city || undefined,
    userAgent: row.user_agent || undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastSentAt: optionalIso(row.last_sent_at),
    lastSuccessAt: optionalIso(row.last_success_at),
    lastError: row.last_error || undefined,
    failureCount: row.failure_count,
    revokedAt: optionalIso(row.revoked_at),
    revokeReason: row.revoke_reason || undefined,
  };
}

function rowToHistory(row: HistoryRow): NotificationHistoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    event: row.event_name || undefined,
    audience: row.audience || undefined,
    orderNumber: row.order_number || undefined,
    orderStatus: row.order_status || undefined,
    payload: row.payload,
    delivery: row.delivery,
    createdAt: iso(row.created_at),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("[push/database] rollback failed", error);
  }
}

export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<DeviceCredentials> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Endpoint swaps can otherwise deadlock when two devices exchange endpoints:
    // each transaction locks its device row and then waits for the other one.
    // Registration volume is tiny, so one transaction lock is safer and cheap.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('inkar:push:subscription-upsert'))");

    let row: SubscriptionRow | undefined;
    let deviceToken = "";
    if (input.deviceId && input.deviceToken) {
      const candidate = await client.query<SubscriptionRow>(`
        SELECT * FROM push_subscriptions
        WHERE device_id::text = $1
        FOR UPDATE
      `, [input.deviceId]);
      if (candidate.rows[0] && tokenHashMatches(candidate.rows[0].device_token_hash, input.deviceToken)) {
        row = candidate.rows[0];
        deviceToken = input.deviceToken;
      }
    }

    if (!row) {
      const endpointMatch = await client.query<SubscriptionRow>(`
        SELECT * FROM push_subscriptions
        WHERE endpoint = $1
        ORDER BY revoked_at NULLS FIRST, updated_at DESC
        LIMIT 1
        FOR UPDATE
      `, [input.subscription.endpoint]);
      row = endpointMatch.rows[0];
      deviceToken = newDeviceToken();
    }

    const now = new Date();
    const preferences = preferencesFor(
      row ? { orders: row.orders_enabled, promos: row.promos_enabled } : undefined,
      input.preferences,
    );
    const tokenDigest = row && deviceToken === input.deviceToken
      ? row.device_token_hash
      : tokenHash(deviceToken);

    if (!row) {
      const created = await client.query<SubscriptionRow>(`
        INSERT INTO push_subscriptions (
          id, device_id, customer_id, device_token_hash, endpoint,
          expiration_time, p256dh, auth, orders_enabled, promos_enabled,
          locale, city, user_agent, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $14
        )
        RETURNING *
      `, [
        randomUUID(), randomUUID(), input.customerId, tokenDigest,
        input.subscription.endpoint, databaseExpirationTime(input.subscription.expirationTime),
        input.subscription.keys.p256dh, input.subscription.keys.auth,
        preferences.orders, preferences.promos, clipped(input.locale, 20) || null,
        clipped(input.city, 80) || null, clipped(input.userAgent, 300) || null, now,
      ]);
      row = created.rows[0];
    } else {
      if (customerChanged(row.customer_id || undefined, input.customerId)) {
        await client.query("DELETE FROM push_order_bindings WHERE device_id = $1", [row.device_id]);
      }
      await client.query(`
        UPDATE push_subscriptions
        SET revoked_at = $3, revoke_reason = 'endpoint_reassigned', updated_at = $3
        WHERE endpoint = $1 AND id <> $2 AND revoked_at IS NULL
      `, [input.subscription.endpoint, row.id, now]);
      const updated = await client.query<SubscriptionRow>(`
        UPDATE push_subscriptions SET
          customer_id = $2,
          device_token_hash = $3,
          endpoint = $4,
          expiration_time = $5,
          p256dh = $6,
          auth = $7,
          orders_enabled = $8,
          promos_enabled = $9,
          locale = coalesce($10, locale),
          city = coalesce($11, city),
          user_agent = coalesce($12, user_agent),
          failure_count = 0,
          last_error = NULL,
          revoked_at = NULL,
          revoke_reason = NULL,
          updated_at = $13
        WHERE id = $1
        RETURNING *
      `, [
        row.id, input.customerId, tokenDigest, input.subscription.endpoint,
        databaseExpirationTime(input.subscription.expirationTime), input.subscription.keys.p256dh,
        input.subscription.keys.auth, preferences.orders, preferences.promos,
        clipped(input.locale, 20) || null, clipped(input.city, 80) || null,
        clipped(input.userAgent, 300) || null, now,
      ]);
      row = updated.rows[0];
    }

    await client.query("COMMIT");
    return { deviceId: row.device_id, deviceToken, preferences };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateDevice(deviceId: string, deviceToken: string): Promise<StoredPushSubscription | null> {
  const db = await databasePool();
  const result = await db.query<SubscriptionRow>(`
    SELECT * FROM push_subscriptions
    WHERE device_id::text = $1 AND revoked_at IS NULL
    LIMIT 1
  `, [deviceId]);
  const row = result.rows[0];
  return row && tokenHashMatches(row.device_token_hash, deviceToken) ? rowToSubscription(row) : null;
}

export async function revokeDevice(deviceId: string, deviceToken: string, reason = "unsubscribed"): Promise<boolean> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<SubscriptionRow>(`
      SELECT * FROM push_subscriptions
      WHERE device_id::text = $1 AND revoked_at IS NULL
      FOR UPDATE
    `, [deviceId]);
    const row = result.rows[0];
    if (!row || !tokenHashMatches(row.device_token_hash, deviceToken)) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(`
      UPDATE push_subscriptions
      SET revoked_at = now(), revoke_reason = $2, updated_at = now()
      WHERE id = $1
    `, [row.id, clipped(reason, 160) || "unsubscribed"]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function bindOrderToDevice(
  orderNumber: string,
  deviceId: string,
  customerId: string,
): Promise<boolean> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const bound = await client.query(`
      INSERT INTO push_order_bindings (order_number, device_id, created_at, updated_at)
      SELECT $1, device_id, now(), now()
      FROM push_subscriptions
      WHERE device_id::text = $2
        AND revoked_at IS NULL
        AND customer_id = $3
        AND EXISTS (
          SELECT 1
          FROM site_orders owned_order
          WHERE owned_order.customer_id = $3
            AND (
              owned_order.id = $1
              OR owned_order.source_order_id = $1
              OR owned_order.display_number::text = $1
            )
        )
      ON CONFLICT (order_number, device_id) DO UPDATE SET updated_at = now()
      RETURNING device_id
    `, [orderNumber.slice(0, 160), deviceId, customerId]);
    await client.query(`
      DELETE FROM push_order_bindings
      WHERE ctid IN (
        SELECT ctid FROM push_order_bindings
        ORDER BY updated_at DESC, order_number, device_id
        OFFSET $1
      )
    `, [BINDING_LIMIT]);
    await client.query("COMMIT");
    return bound.rowCount === 1;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function subscribersForAudience(audience: PushAudience): Promise<StoredPushSubscription[]> {
  const db = await databasePool();
  const preference = audience === "orders" ? "orders_enabled" : audience === "promos" ? "promos_enabled" : null;
  const result = await db.query<SubscriptionRow>(`
    SELECT * FROM push_subscriptions
    WHERE revoked_at IS NULL
      AND customer_id IS NOT NULL
      ${preference ? `AND ${preference}` : ""}
    ORDER BY updated_at DESC
  `);
  return result.rows.map(rowToSubscription);
}

export async function subscribersForOrder(orderNumber: string): Promise<StoredPushSubscription[]> {
  const db = await databasePool();
  const result = await db.query<SubscriptionRow>(`
    SELECT subscription.*
    FROM push_subscriptions subscription
    JOIN push_order_bindings binding ON binding.device_id = subscription.device_id
    WHERE binding.order_number = $1
      AND subscription.revoked_at IS NULL
      AND subscription.customer_id IS NOT NULL
      AND subscription.orders_enabled
    ORDER BY subscription.updated_at DESC
  `, [orderNumber]);
  return result.rows.map(rowToSubscription);
}

export async function applyDeliveryResults(results: DeliveryResult[]): Promise<void> {
  if (results.length === 0) return;
  const payload = results.map((result) => ({
    endpoint: result.endpoint,
    ok: result.ok,
    status_code: result.statusCode,
    error: clipped(result.error, 300) || null,
    revoked: result.revoked,
  }));
  const db = await databasePool();
  await db.query(`
    WITH result AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS item(endpoint text, ok boolean, status_code integer, error text, revoked boolean)
    )
    UPDATE push_subscriptions subscription SET
      last_sent_at = now(),
      last_success_at = CASE WHEN result.ok THEN now() ELSE subscription.last_success_at END,
      failure_count = CASE WHEN result.ok THEN 0 ELSE subscription.failure_count + 1 END,
      last_error = CASE WHEN result.ok THEN NULL ELSE coalesce(result.error, 'HTTP ' || result.status_code::text) END,
      revoked_at = CASE WHEN result.revoked THEN now() ELSE subscription.revoked_at END,
      revoke_reason = CASE WHEN result.revoked THEN 'push_endpoint_' || result.status_code::text ELSE subscription.revoke_reason END,
      updated_at = now()
    FROM result
    WHERE subscription.endpoint = result.endpoint
  `, [JSON.stringify(payload)]);
}

export async function appendHistory(entry: NotificationHistoryEntry): Promise<void> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO push_notification_history (
        id, kind, event_name, audience, order_number, order_status,
        payload, delivery, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
      ON CONFLICT (id) DO NOTHING
    `, [
      entry.id, entry.kind, entry.event || null, entry.audience || null,
      entry.orderNumber || null, entry.orderStatus || null,
      JSON.stringify(entry.payload), JSON.stringify(entry.delivery), entry.createdAt,
    ]);
    await client.query(`
      DELETE FROM push_notification_history
      WHERE id IN (
        SELECT id FROM push_notification_history
        ORDER BY created_at DESC, id DESC
        OFFSET $1
      )
    `, [HISTORY_LIMIT]);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function adminPushSnapshot(limit = 100): Promise<{
  stats: PushStoreStats;
  history: NotificationHistoryEntry[];
  updatedAt: string;
}> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const statsResult = await client.query(`
      SELECT
        (SELECT count(*) FROM push_subscriptions) AS subscriptions_total,
        (SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL AND customer_id IS NOT NULL) AS subscriptions_active,
        (SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NOT NULL OR customer_id IS NULL) AS subscriptions_revoked,
        (SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL AND customer_id IS NOT NULL AND orders_enabled) AS subscriptions_orders,
        (SELECT count(*) FROM push_subscriptions WHERE revoked_at IS NULL AND customer_id IS NOT NULL AND promos_enabled) AS subscriptions_promos,
        (SELECT count(*) FROM push_order_bindings) AS order_bindings,
        (SELECT count(*) FROM push_notification_history) AS history,
        (SELECT coalesce(sum(coalesce((delivery->>'sent')::integer, 0)), 0) FROM push_notification_history) AS deliveries_sent,
        (SELECT coalesce(sum(coalesce((delivery->>'failed')::integer, 0)), 0) FROM push_notification_history) AS deliveries_failed,
        (SELECT coalesce(sum(coalesce((delivery->>'revoked')::integer, 0)), 0) FROM push_notification_history) AS deliveries_revoked,
        coalesce(greatest(
          (SELECT max(updated_at) FROM push_subscriptions),
          (SELECT max(updated_at) FROM push_order_bindings),
          (SELECT max(created_at) FROM push_notification_history)
        ), to_timestamp(0)) AS updated_at
    `);
    const historyResult = await client.query<HistoryRow>(`
      SELECT * FROM push_notification_history
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `, [Math.max(1, Math.min(Math.trunc(limit), 200))]);
    await client.query("COMMIT");

    const row = statsResult.rows[0] || {};
    const updated = row.updated_at;
    return {
      stats: {
        subscriptions: {
          total: count(row.subscriptions_total),
          active: count(row.subscriptions_active),
          revoked: count(row.subscriptions_revoked),
          orders: count(row.subscriptions_orders),
          promos: count(row.subscriptions_promos),
        },
        orderBindings: count(row.order_bindings),
        history: count(row.history),
        deliveries: {
          sent: count(row.deliveries_sent),
          failed: count(row.deliveries_failed),
          revoked: count(row.deliveries_revoked),
        },
      },
      history: historyResult.rows.map(rowToHistory),
      updatedAt: updated ? iso(updated) : new Date(0).toISOString(),
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
