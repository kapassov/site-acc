#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(scriptDirectory, "../db/migrations");
const advisoryLockId = 4_930_511_107;

function requiredDatabaseUrl() {
  const value = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!value) throw new Error("DATABASE_URL or POSTGRES_URL is required");
  return value;
}

function migrationChecksum(sql) {
  // Git may materialize the same migration with LF or CRLF. Hash a canonical
  // representation so a checkout's line-ending policy cannot look like an edit.
  return createHash("sha256").update(sql.replace(/\r\n?/g, "\n")).digest("hex");
}

function connectionOptions(connectionString) {
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Database URL must use postgres:// or postgresql://");
  }
  return {
    connectionString,
    statement_timeout: 120_000,
    application_name: "inkar-db-migrate",
    ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined,
  };
}

async function main() {
  const databaseUrl = requiredDatabaseUrl();
  const files = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d+[_-].+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  if (!files.length) throw new Error(`No migrations found in ${migrationsDirectory}`);

  const client = new Client(connectionOptions(databaseUrl));
  let connected = false;
  let advisoryLockHeld = false;
  try {
    await client.connect();
    connected = true;
    await client.query("SELECT pg_advisory_lock($1)", [advisoryLockId]);
    advisoryLockHeld = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    let applied = 0;
    for (const filename of files) {
      const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
      const sha256 = migrationChecksum(sql);
      const existing = await client.query(
        "SELECT sha256 FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== sha256) {
          throw new Error(`Applied migration ${filename} was edited; create a new migration instead`);
        }
        console.log(`skip ${filename}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)",
          [filename, sha256],
        );
        await client.query("COMMIT");
        applied += 1;
        console.log(`apply ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log(JSON.stringify({ ok: true, discovered: files.length, applied }));
  } finally {
    if (connected) {
      try {
        if (advisoryLockHeld) {
          await client.query("SELECT pg_advisory_unlock($1)", [advisoryLockId]);
        }
      } finally {
        await client.end();
      }
    } else {
      await client.end().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
