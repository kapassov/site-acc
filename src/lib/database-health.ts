import { promises as fs } from "node:fs";
import path from "node:path";

export type PostgresHealth = {
  configured: boolean;
  reachable: boolean;
  ready: boolean;
  latencyMs: number | null;
  migrations: {
    tracked: boolean;
    expected: number | null;
    applied: number | null;
    pending: string[];
    lastApplied: string | null;
  };
  error?: "database_url_invalid" | "database_unreachable" | "database_migrations_pending";
};

type HealthRuntime = {
  key: string;
  result: PostgresHealth | null;
  checkedAt: number;
  inflight: Promise<PostgresHealth> | null;
};

const healthRoot = globalThis as typeof globalThis & { __inkarPostgresHealth?: HealthRuntime };
const healthRuntime = healthRoot.__inkarPostgresHealth ??= {
  key: "",
  result: null,
  checkedAt: 0,
  inflight: null,
};

async function expectedMigrations(): Promise<string[] | null> {
  try {
    const entries = await fs.readdir(path.join(process.cwd(), "db", "migrations"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d+[_-].+\.sql$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch {
    return null;
  }
}

function unconfigured(): PostgresHealth {
  return {
    configured: false,
    reachable: false,
    ready: false,
    latencyMs: null,
    migrations: { tracked: false, expected: null, applied: null, pending: [], lastApplied: null },
  };
}

/** A bounded, read-only dependency probe used only by deep readiness checks. */
async function probePostgresHealth(): Promise<PostgresHealth> {
  const databaseUrl = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!databaseUrl) return unconfigured();

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("invalid_protocol");
  } catch {
    return { ...unconfigured(), configured: true, error: "database_url_invalid" };
  }

  const startedAt = Date.now();
  const { Client } = await import("pg");
  const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(databaseUrl)
    ? { rejectUnauthorized: true }
    : undefined;
  const client = new Client({
    connectionString: databaseUrl,
    ssl,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 4_000,
    query_timeout: 4_000,
    application_name: "inkar-health",
  });
  try {
    await client.connect();
    const table = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('schema_migrations')::text AS table_name",
    );
    const tracked = Boolean(table.rows[0]?.table_name);
    let appliedFiles: string[] = [];
    if (tracked) {
      const result = await client.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations ORDER BY filename",
      );
      appliedFiles = result.rows.map((row) => row.filename);
    }
    const expectedFiles = await expectedMigrations();
    const applied = new Set(appliedFiles);
    const pending = expectedFiles?.filter((filename) => !applied.has(filename)) || [];
    const migrationsReady = tracked && expectedFiles !== null && pending.length === 0;
    return {
      configured: true,
      reachable: true,
      ready: migrationsReady,
      latencyMs: Date.now() - startedAt,
      migrations: {
        tracked,
        expected: expectedFiles?.length ?? null,
        applied: tracked ? appliedFiles.length : 0,
        pending,
        lastApplied: appliedFiles.at(-1) || null,
      },
      ...(migrationsReady ? {} : { error: "database_migrations_pending" as const }),
    };
  } catch (error) {
    console.error("[health/postgres] probe failed", error);
    return {
      configured: true,
      reachable: false,
      ready: false,
      latencyMs: Date.now() - startedAt,
      migrations: { tracked: false, expected: null, applied: null, pending: [], lastApplied: null },
      error: "database_unreachable",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Coalesce public readiness requests so they cannot fan out DB connections. */
export async function inspectPostgresHealth(): Promise<PostgresHealth> {
  const key = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (healthRuntime.key !== key) {
    healthRuntime.key = key;
    healthRuntime.result = null;
    healthRuntime.checkedAt = 0;
    healthRuntime.inflight = null;
  }
  if (healthRuntime.result && Date.now() - healthRuntime.checkedAt < 5_000) {
    return healthRuntime.result;
  }
  if (healthRuntime.inflight) return healthRuntime.inflight;
  const task = probePostgresHealth();
  healthRuntime.inflight = task;
  try {
    const result = await task;
    healthRuntime.result = result;
    healthRuntime.checkedAt = Date.now();
    return result;
  } finally {
    if (healthRuntime.inflight === task) healthRuntime.inflight = null;
  }
}
