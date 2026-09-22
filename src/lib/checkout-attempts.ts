import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { ordersDatabasePool } from "@/lib/orders/store";
import {
  checkoutAttemptDecision,
  checkoutAttemptStorageMode,
  type CheckoutAttemptIdentity,
  type CheckoutAttemptSnapshot,
  type CheckoutAttemptState,
} from "@/lib/checkout-attempts-model";

export type CheckoutAttemptResponse = {
  status: number;
  payload: Record<string, unknown>;
};

export type BeginCheckoutAttemptResult =
  | { outcome: "started"; attemptId: string }
  | { outcome: "pending" }
  | { outcome: "uncertain"; attemptId: string; response: CheckoutAttemptResponse }
  | { outcome: "replay"; attemptId: string; response: CheckoutAttemptResponse }
  | { outcome: "conflict" };

export type CheckoutAttemptForActor = {
  id: string;
  state: CheckoutAttemptState;
  response: CheckoutAttemptResponse | null;
  providerOrderId: string | null;
  retainUntil: number;
  createdAt: number;
};

type AttemptRow = {
  id: string;
  idempotency_key: string;
  actor_key: string;
  cart_instance_key: string;
  cart_hash: string;
  request_hash: string;
  state: CheckoutAttemptState;
  response_status: number | null;
  response_payload: Record<string, unknown> | null;
  provider_order_id: string | null;
  provider_started_at: Date | string | null;
  lease_expires_at: Date | string;
  retain_until: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type BeginInput = CheckoutAttemptIdentity & {
  leaseMs?: number;
  retainMs?: number;
};

type CompleteInput = CheckoutAttemptResponse & {
  state: "uncertain" | "replay";
  providerOrderId?: string;
  retainMs?: number;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "checkout-attempts.json");
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LEASE_MS = 2 * 60_000;
const DEFAULT_RETAIN_MS = 24 * 60 * 60_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_FILE_ROWS = 500;
let fileChain: Promise<unknown> = Promise.resolve();

const UNCERTAIN_RESPONSE: CheckoutAttemptResponse = {
  status: 502,
  payload: {
    error: "order_status_uncertain",
    orderCreated: null,
    recovery: "check_orders",
  },
};

function boundedDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(30_000, Math.min(7 * 24 * 60 * 60_000, Math.trunc(value!)))
    : fallback;
}

function validateBegin(input: BeginInput): BeginInput {
  if (!KEY.test(input.idempotencyKey)
      || !HASH.test(input.actorKey)
      || !HASH.test(input.cartInstanceKey)
      || !HASH.test(input.cartHash)
      || !HASH.test(input.requestHash)) {
    throw new Error("invalid_checkout_attempt");
  }
  return input;
}

function validateResponse(input: CompleteInput): CompleteInput {
  if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599
      || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("invalid_checkout_attempt_response");
  }
  const serialized = JSON.stringify(input.payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("checkout_attempt_response_too_large");
  }
  return { ...input, payload: JSON.parse(serialized) as Record<string, unknown> };
}

function dateValue(value: Date | string): number {
  const parsed = value instanceof Date ? value.valueOf() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("checkout_attempt_store_corrupt");
  return parsed;
}

function snapshot(row: AttemptRow): CheckoutAttemptSnapshot {
  return {
    idempotencyKey: row.idempotency_key,
    actorKey: row.actor_key,
    cartInstanceKey: row.cart_instance_key,
    cartHash: row.cart_hash,
    requestHash: row.request_hash,
    state: row.state,
    leaseExpiresAt: dateValue(row.lease_expires_at),
    providerStarted: Boolean(row.provider_started_at),
  };
}

function storedResponse(row: AttemptRow): CheckoutAttemptResponse {
  if (!row.response_status || !row.response_payload) throw new Error("checkout_attempt_store_corrupt");
  return { status: Number(row.response_status), payload: row.response_payload };
}

function actorAttempt(row: AttemptRow): CheckoutAttemptForActor {
  return {
    id: row.id,
    state: row.state,
    response: row.response_status !== null && row.response_payload !== null ? storedResponse(row) : null,
    providerOrderId: row.provider_order_id,
    retainUntil: dateValue(row.retain_until),
    createdAt: dateValue(row.created_at),
  };
}

function storageMode(): "postgres" | "file" {
  return checkoutAttemptStorageMode(
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.NODE_ENV,
  );
}

async function postgresBegin(input: BeginInput): Promise<BeginCheckoutAttemptResult> {
  const db = await ordersDatabasePool();
  const client = await db.connect();
  const attemptId = randomUUID();
  const leaseMs = boundedDuration(input.leaseMs, DEFAULT_LEASE_MS);
  const retainMs = boundedDuration(input.retainMs, DEFAULT_RETAIN_MS);
  try {
    await client.query("BEGIN");
    // Attempts are never deleted automatically. `retain_until` is an archival
    // hint for an explicit reconciliation job, not an idempotency expiry.
    const inserted = await client.query<AttemptRow>(`
      INSERT INTO checkout_attempts (
        id, idempotency_key, actor_key, cart_instance_key, cart_hash,
        request_hash, state, lease_expires_at, retain_until
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'pending',
        clock_timestamp() + ($7 * interval '1 millisecond'),
        clock_timestamp() + ($8 * interval '1 millisecond')
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      attemptId,
      input.idempotencyKey,
      input.actorKey,
      input.cartInstanceKey,
      input.cartHash,
      input.requestHash,
      leaseMs,
      retainMs,
    ]);
    if (inserted.rows[0]) {
      await client.query("COMMIT");
      return { outcome: "started", attemptId };
    }

    const existing = await client.query<AttemptRow>(`
      SELECT * FROM checkout_attempts
      WHERE actor_key = $1
        AND (idempotency_key = $2 OR cart_instance_key = $3)
      ORDER BY created_at DESC
      FOR UPDATE
    `, [input.actorKey, input.idempotencyKey, input.cartInstanceKey]);
    if (existing.rowCount !== 1) {
      await client.query("COMMIT");
      return { outcome: "conflict" };
    }
    const row = existing.rows[0];
    const decision = checkoutAttemptDecision(snapshot(row), input, Date.now());
    if (decision === "resume") {
      await client.query(`
        UPDATE checkout_attempts
        SET idempotency_key = $2,
            lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
            retain_until = clock_timestamp() + ($4 * interval '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = $1
      `, [row.id, input.idempotencyKey, leaseMs, retainMs]);
      await client.query("COMMIT");
      return { outcome: "started", attemptId: row.id };
    }
    if (decision === "mark_uncertain") {
      const updated = await client.query<AttemptRow>(`
        UPDATE checkout_attempts
        SET state = 'uncertain',
            response_status = $2,
            response_payload = $3::jsonb,
            retain_until = clock_timestamp() + ($4 * interval '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *
      `, [row.id, UNCERTAIN_RESPONSE.status, JSON.stringify(UNCERTAIN_RESPONSE.payload), retainMs]);
      await client.query("COMMIT");
      return { outcome: "uncertain", attemptId: row.id, response: storedResponse(updated.rows[0]) };
    }
    await client.query("COMMIT");
    if (decision === "pending") return { outcome: "pending" };
    if (decision === "uncertain") return { outcome: "uncertain", attemptId: row.id, response: storedResponse(row) };
    if (decision === "replay") return { outcome: "replay", attemptId: row.id, response: storedResponse(row) };
    return { outcome: "conflict" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function postgresMarkProviderStarted(attemptId: string, leaseMs?: number): Promise<void> {
  const db = await ordersDatabasePool();
  const result = await db.query(`
    UPDATE checkout_attempts
    SET provider_started_at = COALESCE(provider_started_at, clock_timestamp()),
        lease_expires_at = clock_timestamp() + ($2 * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = $1 AND state = 'pending'
  `, [attemptId, boundedDuration(leaseMs, DEFAULT_LEASE_MS)]);
  if (result.rowCount !== 1) throw new Error("checkout_attempt_missing");
}

async function postgresComplete(attemptId: string, input: CompleteInput): Promise<void> {
  const db = await ordersDatabasePool();
  const result = await db.query(`
    UPDATE checkout_attempts
    SET state = $2,
        response_status = $3,
        response_payload = $4::jsonb,
        provider_order_id = NULLIF($5, ''),
        updated_at = clock_timestamp(),
        retain_until = clock_timestamp() + ($6 * interval '1 millisecond')
    WHERE id = $1 AND state IN ('pending', 'uncertain', 'replay')
  `, [
    attemptId,
    input.state,
    input.status,
    JSON.stringify(input.payload),
    String(input.providerOrderId || "").slice(0, 256),
    boundedDuration(input.retainMs, DEFAULT_RETAIN_MS),
  ]);
  if (result.rowCount !== 1) throw new Error("checkout_attempt_missing");
}

async function postgresRelease(attemptId: string): Promise<void> {
  const db = await ordersDatabasePool();
  await db.query("DELETE FROM checkout_attempts WHERE id = $1 AND state = 'pending'", [attemptId]);
}

async function postgresReadForActor(
  attemptId: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  const db = await ordersDatabasePool();
  const result = await db.query<AttemptRow>(`
    SELECT * FROM checkout_attempts
    WHERE id = $1 AND actor_key = $2
    LIMIT 1
  `, [attemptId, actorKey]);
  const row = result.rows[0];
  return row ? actorAttempt(row) : null;
}

async function postgresReadByKeyForActor(
  idempotencyKey: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  const db = await ordersDatabasePool();
  const result = await db.query<AttemptRow>(`
    SELECT * FROM checkout_attempts
    WHERE idempotency_key = $1 AND actor_key = $2
    LIMIT 1
  `, [idempotencyKey, actorKey]);
  const row = result.rows[0];
  return row ? actorAttempt(row) : null;
}

async function postgresRenewPaymentSessionForActor(
  attemptId: string,
  actorKey: string,
  maxAgeMs: number,
  retainMs: number,
): Promise<CheckoutAttemptForActor | null> {
  const db = await ordersDatabasePool();
  const result = await db.query<AttemptRow>(`
    UPDATE checkout_attempts
    SET retain_until = clock_timestamp() + ($3 * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = $1
      AND actor_key = $2
      AND state = 'replay'
      AND response_status = 202
      AND provider_order_id IS NOT NULL
      AND retain_until <= clock_timestamp()
      AND created_at >= clock_timestamp() - ($4 * interval '1 millisecond')
    RETURNING *
  `, [attemptId, actorKey, boundedDuration(retainMs, DEFAULT_RETAIN_MS), boundedDuration(maxAgeMs, 7 * 24 * 60 * 60_000)]);
  return result.rows[0] ? actorAttempt(result.rows[0]) : null;
}

function isAttemptRow(value: unknown): value is AttemptRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AttemptRow>;
  return typeof row.id === "string" && UUID.test(row.id)
    && typeof row.idempotency_key === "string" && KEY.test(row.idempotency_key)
    && typeof row.actor_key === "string" && HASH.test(row.actor_key)
    && typeof row.cart_instance_key === "string" && HASH.test(row.cart_instance_key)
    && typeof row.cart_hash === "string" && HASH.test(row.cart_hash)
    && typeof row.request_hash === "string" && HASH.test(row.request_hash)
    && ["pending", "uncertain", "replay"].includes(String(row.state));
}

async function readFileRows(): Promise<AttemptRow[]> {
  let source: string;
  try {
    source = await fs.readFile(FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("checkout_attempt_store_corrupt");
  }
  if (!Array.isArray(parsed) || parsed.some((row) => !isAttemptRow(row))) {
    throw new Error("checkout_attempt_store_corrupt");
  }
  return parsed;
}

async function writeFileRows(rows: AttemptRow[]): Promise<void> {
  const protectedRows = rows.filter((row) => row.state !== "replay");
  if (protectedRows.length > MAX_FILE_ROWS) throw new Error("checkout_attempt_store_full");
  const replayRows = rows.filter((row) => row.state === "replay");
  const persisted = [...protectedRows, ...replayRows.slice(-(MAX_FILE_ROWS - protectedRows.length))];
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(JSON.stringify(persisted, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, FILE);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function fileExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = fileChain.then(operation, operation);
  fileChain = result.then(() => undefined, () => undefined);
  return result;
}

async function fileBegin(input: BeginInput): Promise<BeginCheckoutAttemptResult> {
  return fileExclusive(async () => {
    const now = Date.now();
    const rows = await readFileRows();
    const matching = rows.filter((row) => row.actor_key === input.actorKey && (
      row.idempotency_key === input.idempotencyKey || row.cart_instance_key === input.cartInstanceKey
    ));
    if (matching.length > 1) {
      await writeFileRows(rows);
      return { outcome: "conflict" };
    }
    const row = matching[0];
    if (row) {
      const decision = checkoutAttemptDecision(snapshot(row), input, now);
      if (decision === "resume") {
        row.idempotency_key = input.idempotencyKey;
        row.lease_expires_at = new Date(now + boundedDuration(input.leaseMs, DEFAULT_LEASE_MS)).toISOString();
        row.retain_until = new Date(now + boundedDuration(input.retainMs, DEFAULT_RETAIN_MS)).toISOString();
        row.updated_at = new Date(now).toISOString();
        await writeFileRows(rows);
        return { outcome: "started", attemptId: row.id };
      }
      if (decision === "mark_uncertain") {
        row.state = "uncertain";
        row.response_status = UNCERTAIN_RESPONSE.status;
        row.response_payload = UNCERTAIN_RESPONSE.payload;
        row.retain_until = new Date(now + boundedDuration(input.retainMs, DEFAULT_RETAIN_MS)).toISOString();
        row.updated_at = new Date(now).toISOString();
        await writeFileRows(rows);
        return { outcome: "uncertain", attemptId: row.id, response: storedResponse(row) };
      }
      await writeFileRows(rows);
      if (decision === "pending") return { outcome: "pending" };
      if (decision === "uncertain") return { outcome: "uncertain", attemptId: row.id, response: storedResponse(row) };
      if (decision === "replay") return { outcome: "replay", attemptId: row.id, response: storedResponse(row) };
      return { outcome: "conflict" };
    }
    if (rows.length >= MAX_FILE_ROWS) throw new Error("checkout_attempt_store_full");
    const iso = new Date(now).toISOString();
    const created: AttemptRow = {
      id: randomUUID(),
      idempotency_key: input.idempotencyKey,
      actor_key: input.actorKey,
      cart_instance_key: input.cartInstanceKey,
      cart_hash: input.cartHash,
      request_hash: input.requestHash,
      state: "pending",
      response_status: null,
      response_payload: null,
      provider_order_id: null,
      provider_started_at: null,
      lease_expires_at: new Date(now + boundedDuration(input.leaseMs, DEFAULT_LEASE_MS)).toISOString(),
      retain_until: new Date(now + boundedDuration(input.retainMs, DEFAULT_RETAIN_MS)).toISOString(),
      created_at: iso,
      updated_at: iso,
    };
    rows.push(created);
    await writeFileRows(rows);
    return { outcome: "started", attemptId: created.id };
  });
}

async function fileMarkProviderStarted(attemptId: string, leaseMs?: number): Promise<void> {
  await fileExclusive(async () => {
    const rows = await readFileRows();
    const row = rows.find((value) => value.id === attemptId && value.state === "pending");
    if (!row) throw new Error("checkout_attempt_missing");
    const now = Date.now();
    row.provider_started_at ||= new Date(now).toISOString();
    row.lease_expires_at = new Date(now + boundedDuration(leaseMs, DEFAULT_LEASE_MS)).toISOString();
    row.updated_at = new Date(now).toISOString();
    await writeFileRows(rows);
  });
}

async function fileComplete(attemptId: string, input: CompleteInput): Promise<void> {
  await fileExclusive(async () => {
    const rows = await readFileRows();
    const row = rows.find((value) => value.id === attemptId);
    if (!row) throw new Error("checkout_attempt_missing");
    row.state = input.state;
    row.response_status = input.status;
    row.response_payload = input.payload;
    row.provider_order_id = String(input.providerOrderId || "").slice(0, 256) || null;
    row.updated_at = new Date().toISOString();
    row.retain_until = new Date(Date.now() + boundedDuration(input.retainMs, DEFAULT_RETAIN_MS)).toISOString();
    await writeFileRows(rows);
  });
}

async function fileRelease(attemptId: string): Promise<void> {
  await fileExclusive(async () => {
    const rows = await readFileRows();
    await writeFileRows(rows.filter((row) => row.id !== attemptId || row.state !== "pending"));
  });
}

async function fileReadForActor(
  attemptId: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  return fileExclusive(async () => {
    const rows = await readFileRows();
    const row = rows.find((value) => value.id === attemptId && value.actor_key === actorKey);
    return row ? actorAttempt(row) : null;
  });
}

async function fileReadByKeyForActor(
  idempotencyKey: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  return fileExclusive(async () => {
    const rows = await readFileRows();
    const row = rows.find((value) => value.idempotency_key === idempotencyKey && value.actor_key === actorKey);
    return row ? actorAttempt(row) : null;
  });
}

async function fileRenewPaymentSessionForActor(
  attemptId: string,
  actorKey: string,
  maxAgeMs: number,
  retainMs: number,
): Promise<CheckoutAttemptForActor | null> {
  return fileExclusive(async () => {
    const rows = await readFileRows();
    const row = rows.find((value) => value.id === attemptId && value.actor_key === actorKey);
    const now = Date.now();
    if (!row
        || row.state !== "replay"
        || row.response_status !== 202
        || !row.provider_order_id
        || dateValue(row.retain_until) > now
        || dateValue(row.created_at) < now - boundedDuration(maxAgeMs, 7 * 24 * 60 * 60_000)) {
      return null;
    }
    row.retain_until = new Date(now + boundedDuration(retainMs, DEFAULT_RETAIN_MS)).toISOString();
    row.updated_at = new Date(now).toISOString();
    await writeFileRows(rows);
    return actorAttempt(row);
  });
}

export async function beginCheckoutAttempt(input: BeginInput): Promise<BeginCheckoutAttemptResult> {
  const valid = validateBegin(input);
  return storageMode() === "postgres" ? postgresBegin(valid) : fileBegin(valid);
}

export async function markCheckoutProviderStarted(attemptId: string, leaseMs?: number): Promise<void> {
  if (!UUID.test(attemptId)) throw new Error("invalid_checkout_attempt");
  return storageMode() === "postgres"
    ? postgresMarkProviderStarted(attemptId, leaseMs)
    : fileMarkProviderStarted(attemptId, leaseMs);
}

export async function completeCheckoutAttempt(
  attemptId: string,
  input: CompleteInput,
): Promise<void> {
  if (!UUID.test(attemptId)) throw new Error("invalid_checkout_attempt");
  const valid = validateResponse(input);
  return storageMode() === "postgres" ? postgresComplete(attemptId, valid) : fileComplete(attemptId, valid);
}

export async function releaseCheckoutAttempt(attemptId: string): Promise<void> {
  if (!UUID.test(attemptId)) return;
  return storageMode() === "postgres" ? postgresRelease(attemptId) : fileRelease(attemptId);
}

/**
 * Reads an attempt only when both its opaque id and its verified customer
 * identity match. A miss and an ownership mismatch deliberately have the same
 * result so callers cannot enumerate another customer's payment sessions.
 */
export async function readCheckoutAttemptForActor(
  attemptId: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  if (!UUID.test(attemptId) || !HASH.test(actorKey)) return null;
  return storageMode() === "postgres"
    ? postgresReadForActor(attemptId, actorKey)
    : fileReadForActor(attemptId, actorKey);
}

/**
 * Recovers the server-side result for the exact browser idempotency key. The
 * verified actor key is mandatory, so another customer cannot probe or resume
 * somebody else's checkout.
 */
export async function readCheckoutAttemptByKeyForActor(
  idempotencyKey: string,
  actorKey: string,
): Promise<CheckoutAttemptForActor | null> {
  if (!KEY.test(idempotencyKey) || !HASH.test(actorKey)) return null;
  return storageMode() === "postgres"
    ? postgresReadByKeyForActor(idempotencyKey, actorKey)
    : fileReadByKeyForActor(idempotencyKey, actorKey);
}

/**
 * Re-opens only an expired, already completed payment session for the same
 * verified customer. It never creates or resubmits a provider order.
 */
export async function renewCheckoutPaymentSessionForActor(
  attemptId: string,
  actorKey: string,
  options: { maxAgeMs?: number; retainMs?: number } = {},
): Promise<CheckoutAttemptForActor | null> {
  if (!UUID.test(attemptId) || !HASH.test(actorKey)) return null;
  const maxAgeMs = boundedDuration(options.maxAgeMs, 7 * 24 * 60 * 60_000);
  const retainMs = boundedDuration(options.retainMs, DEFAULT_RETAIN_MS);
  return storageMode() === "postgres"
    ? postgresRenewPaymentSessionForActor(attemptId, actorKey, maxAgeMs, retainMs)
    : fileRenewPaymentSessionForActor(attemptId, actorKey, maxAgeMs, retainMs);
}
