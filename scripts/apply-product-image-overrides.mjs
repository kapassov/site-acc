#!/usr/bin/env node

/**
 * Apply audited local product-image fallbacks to the PostgreSQL read catalogue.
 *
 * The fallback is used only while the upstream Medusa product has no thumbnail.
 * A non-empty upstream thumbnail always wins on the next catalogue sync.
 * Dry-run is the default; --apply is required for writes.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import pg from "pg";

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

function parseArgs(argv) {
  const args = { apply: false, rollback: false, manifest: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--apply") args.apply = true;
    else if (item === "--rollback") args.rollback = true;
    else if (item === "--manifest") args.manifest = argv[++index] || "";
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!args.manifest) throw new Error("--manifest is required");
  if (args.rollback && !args.apply) throw new Error("--rollback requires --apply");
  return args;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadEntries(path) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(payload?.approved)) throw new Error("manifest approved[] is required");
  const entries = payload.approved.map((item) => {
    const wareId = String(item?.ware_id || "").trim().toUpperCase();
    const productId = String(item?.product_id || "").trim();
    if (!UUID_RE.test(wareId) || !/^prod_[A-Za-z0-9]+$/.test(productId)) {
      throw new Error("manifest contains an invalid product_id or ware_id");
    }
    return {
      product_id: productId,
      url: `/api/uploads/${wareId}.webp`,
      source: String(item?.source || payload?.source || "daribar").trim().toLowerCase() || "daribar",
      source_url: String(item?.source_url || "").trim(),
      source_sha256: String(item?.source_sha256 || "").trim(),
      source_sku: String(item?.source_sku || item?.daribar_sku || "").trim(),
      title: String(item?.title || "").trim(),
    };
  });
  if (entries.some((entry) => !/^[a-z0-9_-]{2,40}$/.test(entry.source))) {
    throw new Error("manifest contains an invalid source");
  }
  const unique = new Map(entries.map((entry) => [entry.product_id, entry]));
  if (unique.size !== entries.length) throw new Error("manifest contains duplicate product IDs");
  return [...unique.values()];
}

async function classify(client, entries) {
  const result = await client.query(`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS item(product_id text, url text, source text, source_url text, source_sha256 text, source_sku text, title text)
    )
    SELECT requested.*,
           product.id IS NOT NULL AS product_exists,
           product.active,
           product.thumbnail_url,
           EXISTS (SELECT 1 FROM catalog_images image WHERE image.product_id = product.id) AS has_images
    FROM requested
    LEFT JOIN catalog_products product ON product.id = requested.product_id
    ORDER BY requested.product_id
  `, [JSON.stringify(entries)]);
  return result.rows;
}

function summarize(rows) {
  const summary = { requested: rows.length, eligible: 0, missing_product: 0, inactive: 0, existing_media: 0 };
  for (const row of rows) {
    if (!row.product_exists) summary.missing_product += 1;
    else if (!row.active) summary.inactive += 1;
    else if (row.thumbnail_url || row.has_images) summary.existing_media += 1;
    else summary.eligible += 1;
  }
  return summary;
}

async function installStorage(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS catalog_product_media_overrides (
      product_id text PRIMARY KEY REFERENCES catalog_products(id) ON DELETE CASCADE,
      url text NOT NULL,
      source text NOT NULL,
      source_url text,
      source_sha256 text,
      source_sku text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (url ~ '^/api/uploads/[0-9A-Fa-f-]+\\.webp$')
    )
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION preserve_catalog_product_media_override()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE fallback_url text;
    BEGIN
      IF NEW.thumbnail_url IS NULL OR btrim(NEW.thumbnail_url) = '' THEN
        SELECT url INTO fallback_url
        FROM catalog_product_media_overrides
        WHERE product_id = NEW.id;
        IF fallback_url IS NOT NULL THEN NEW.thumbnail_url := fallback_url; END IF;
      END IF;
      RETURN NEW;
    END
    $$
  `);
  await client.query(`
    DROP TRIGGER IF EXISTS catalog_product_media_override_trigger ON catalog_products
  `);
  await client.query(`
    CREATE TRIGGER catalog_product_media_override_trigger
    BEFORE INSERT OR UPDATE OF thumbnail_url ON catalog_products
    FOR EACH ROW EXECUTE FUNCTION preserve_catalog_product_media_override()
  `);
}

async function applyEntries(client, rows) {
  const eligible = rows.filter((row) => row.product_exists && row.active && !row.thumbnail_url && !row.has_images);
  if (!eligible.length) return 0;
  await client.query(`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS item(product_id text, url text, source text, source_url text, source_sha256 text, source_sku text, title text)
    )
    INSERT INTO catalog_product_media_overrides (
      product_id, url, source, source_url, source_sha256, source_sku, metadata, updated_at
    )
    SELECT product_id, url, source, nullif(source_url, ''), nullif(source_sha256, ''),
           nullif(source_sku, ''), jsonb_build_object('title_at_import', title), now()
    FROM requested
    ON CONFLICT (product_id) DO UPDATE SET
      url = excluded.url,
      source = excluded.source,
      source_url = excluded.source_url,
      source_sha256 = excluded.source_sha256,
      source_sku = excluded.source_sku,
      metadata = excluded.metadata,
      updated_at = now()
  `, [JSON.stringify(eligible)]);
  const update = await client.query(`
    UPDATE catalog_products product
    SET thumbnail_url = media.url, updated_at = now()
    FROM catalog_product_media_overrides media
    WHERE product.id = media.product_id
      AND product.id = ANY($1::text[])
      AND (product.thumbnail_url IS NULL OR btrim(product.thumbnail_url) = '')
      AND NOT EXISTS (SELECT 1 FROM catalog_images image WHERE image.product_id = product.id)
  `, [eligible.map((row) => row.product_id)]);
  return update.rowCount;
}

async function rollbackEntries(client, entries) {
  const ids = entries.map((entry) => entry.product_id);
  const cleared = await client.query(`
    UPDATE catalog_products product
    SET thumbnail_url = NULL, updated_at = now()
    FROM catalog_product_media_overrides media
    WHERE product.id = media.product_id
      AND product.id = ANY($1::text[])
      AND product.thumbnail_url = media.url
  `, [ids]);
  await client.query(
    "DELETE FROM catalog_product_media_overrides WHERE product_id = ANY($1::text[])",
    [ids],
  );
  return cleared.rowCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = await loadEntries(resolve(args.manifest));
  const connectionString = requiredEnvironment("DATABASE_URL");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const rows = await classify(client, entries);
    const summary = summarize(rows);
    console.log(JSON.stringify({ mode: args.apply ? (args.rollback ? "rollback" : "apply") : "dry_run", ...summary }));
    if (!args.apply) return;

    await client.query("BEGIN");
    try {
      await installStorage(client);
      const changed = args.rollback
        ? await rollbackEntries(client, entries)
        : await applyEntries(client, rows);
      await client.query("COMMIT");
      console.log(JSON.stringify({ committed: true, changed }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
