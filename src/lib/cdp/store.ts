import { randomUUID } from "node:crypto";

export type CdpEventRow = {
  idempotencyKey: string;
  eventName: string;
  eventVersion: number;
  customerId: string | null;
  anonymousIdHash: string | null;
  sessionIdHash: string | null;
  source: "web" | "android" | "ios";
  occurredAt: string;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  consentSnapshot: Record<string, unknown>;
};

type InsertResult = { idempotencyKey: string; inserted: boolean };

type Runtime = { poolPromise: Promise<import("pg").Pool> | null };

const runtimeRoot = globalThis as typeof globalThis & { __inkarCdpDatabase?: Runtime };
const runtime = runtimeRoot.__inkarCdpDatabase ??= { poolPromise: null };

async function databasePool() {
  const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!connectionString) throw new Error("cdp_database_not_configured");
  if (!runtime.poolPromise) {
    runtime.poolPromise = (async () => {
      const parsed = new URL(connectionString);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error("cdp_database_url_invalid");
      }
      const { Pool } = await import("pg");
      const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(connectionString)
        ? { rejectUnauthorized: true }
        : undefined;
      const created = new Pool({
        connectionString,
        ssl,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        application_name: "inkar-cdp",
      });
      created.on("error", (error) => console.error("[cdp/database] idle client error", error));
      return created;
    })().catch((error) => {
      runtime.poolPromise = null;
      throw error;
    });
  }
  return runtime.poolPromise;
}

export async function insertCdpEvents(events: CdpEventRow[]): Promise<InsertResult[]> {
  const db = await databasePool();
  const client = await db.connect();
  const results: InsertResult[] = [];
  try {
    await client.query("BEGIN");
    const schema = await client.query("SELECT to_regclass('cdp_events') AS table_name");
    if (!schema.rows[0]?.table_name) throw new Error("cdp_schema_not_migrated");

    for (const event of events) {
      const inserted = await client.query<{ idempotency_key: string }>(`
        INSERT INTO cdp_events (
          id, idempotency_key, event_name, event_version, customer_id,
          anonymous_id_hash, session_id_hash, source, occurred_at,
          properties, context, consent_snapshot
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10::jsonb, $11::jsonb, $12::jsonb
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key
      `, [
        randomUUID(), event.idempotencyKey, event.eventName, event.eventVersion,
        event.customerId, event.anonymousIdHash, event.sessionIdHash, event.source,
        event.occurredAt, JSON.stringify(event.properties), JSON.stringify(event.context),
        JSON.stringify(event.consentSnapshot),
      ]);
      results.push({ idempotencyKey: event.idempotencyKey, inserted: inserted.rowCount === 1 });
    }
    await client.query("COMMIT");
    return results;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[cdp/database] rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
