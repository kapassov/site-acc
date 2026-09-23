#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;
const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
if (!connectionString) throw new Error("daribar_catalog_database_not_configured");
const parsed = new URL(connectionString);
const client = new Client({ connectionString, application_name: "daribar-catalog-rollback",
  ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [4_930_511_108]);
  const state = await client.query(`
    SELECT active_run_id, previous_run_id FROM daribar_catalog_state WHERE singleton FOR UPDATE
  `);
  const { active_run_id: active, previous_run_id: previous } = state.rows[0] || {};
  if (!active || !previous) throw new Error("daribar_catalog_rollback_unavailable");
  await client.query(`UPDATE daribar_catalog_runs SET status = 'superseded' WHERE id = $1`, [active]);
  await client.query(`UPDATE daribar_catalog_runs SET status = 'published' WHERE id = $1`, [previous]);
  await client.query(`
    UPDATE daribar_catalog_state
    SET active_run_id = $1, previous_run_id = $2, updated_at = now()
    WHERE singleton
  `, [previous, active]);
  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ ok: true, activeRunId: previous, previousRunId: active })}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || "daribar_catalog_rollback_failed") })}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

