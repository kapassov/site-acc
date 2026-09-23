#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { mapDaribarProduct } from "../src/lib/daribar/catalog-data.ts";
import { daribarCatalogSnapshotPath, readDaribarCatalogSnapshot } from "../src/lib/daribar/snapshot-file.ts";

const { Client } = pg;
const LOCK_ID = 4_930_511_108;
const BATCH_SIZE = 250;

function fail(code) { throw new Error(code); }

function databaseUrl(env = process.env) {
  const value = String(env.DATABASE_URL || env.POSTGRES_URL || "").trim();
  if (!value) fail("daribar_catalog_database_not_configured");
  return value;
}

function connectionOptions(connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("daribar_catalog_database_url_invalid");
  return {
    connectionString,
    ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 120_000,
    application_name: "daribar-catalog-publish",
  };
}

function checksum(snapshot) {
  return createHash("sha256").update(JSON.stringify({
    schema: snapshot.schema,
    generatedAt: snapshot.generatedAt,
    city: snapshot.city,
    totalCount: snapshot.totalCount,
    uniqueCount: snapshot.uniqueCount,
    skus: snapshot.products.map((product) => String(product.sku || "")),
  })).digest("hex");
}

export function normalizeDaribarSnapshot(snapshot) {
  const products = [];
  const seenSku = new Set();
  const seenProduct = new Set();
  const seenVariant = new Set();
  const seenSlug = new Set();
  for (const raw of snapshot.products) {
    const product = mapDaribarProduct(raw);
    if (!product?.sku || !product.variantId) continue;
    if (seenSku.has(product.sku) || seenProduct.has(product.id)
        || seenVariant.has(product.variantId) || seenSlug.has(product.slug)) {
      fail("daribar_catalog_normalized_duplicate");
    }
    seenSku.add(product.sku);
    seenProduct.add(product.id);
    seenVariant.add(product.variantId);
    seenSlug.add(product.slug);
    products.push({
      sku: product.sku,
      product_id: product.id,
      variant_id: product.variantId,
      slug: product.slug,
      name: product.name,
      brand: product.brand === "—" ? null : product.brand,
      category_slug: product.categorySlug,
      category_handles: product.categoryHandles || [product.categorySlug],
      price_amount: product.priceTBD || product.price <= 0 ? null : product.price,
      image_url: product.image || null,
      prescription: product.prescription === true,
      catalog_stock: product.inStock ? Math.max(1, product.stockPharmacies || 1) : 0,
      product,
      raw_payload: raw,
    });
  }
  if (products.length === 0 || products.length < Math.floor(snapshot.uniqueCount * 0.9)) {
    fail("daribar_catalog_normalized_incomplete");
  }
  return products;
}

async function insertBatch(client, runId, products) {
  await client.query(`
    INSERT INTO daribar_catalog_products (
      run_id, sku, product_id, variant_id, slug, name, brand, category_slug,
      category_handles, price_amount, image_url, prescription, catalog_stock,
      product, raw_payload
    )
    SELECT $1::uuid, item.sku, item.product_id, item.variant_id, item.slug,
           item.name, item.brand, item.category_slug, item.category_handles,
           item.price_amount, item.image_url, item.prescription,
           item.catalog_stock, item.product, item.raw_payload
    FROM jsonb_to_recordset($2::jsonb) AS item(
      sku text, product_id text, variant_id text, slug text, name text,
      brand text, category_slug text, category_handles text[],
      price_amount bigint, image_url text, prescription boolean,
      catalog_stock integer, product jsonb, raw_payload jsonb
    )
  `, [runId, JSON.stringify(products)]);
}

export async function publishDaribarCatalog(options = {}) {
  const snapshot = options.snapshot || await readDaribarCatalogSnapshot(
    daribarCatalogSnapshotPath(options.snapshotPath),
  );
  const products = normalizeDaribarSnapshot(snapshot);
  const runId = options.runId || randomUUID();
  const digest = checksum(snapshot);
  const client = options.client || new Client(connectionOptions(databaseUrl(options.env)));
  const ownsClient = !options.client;
  let transaction = false;
  if (ownsClient) await client.connect();
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const existing = await client.query(`
      SELECT id, status FROM daribar_catalog_runs WHERE checksum = $1 ORDER BY created_at DESC LIMIT 1
    `, [digest]);
    if (existing.rows[0]?.status === "published") {
      await client.query("ROLLBACK");
      transaction = false;
      return { ok: true, skipped: true, runId: existing.rows[0].id, checksum: digest, count: products.length };
    }
    await client.query(`
      INSERT INTO daribar_catalog_runs (
        id, status, city, generated_at, source_count, normalized_count, checksum, metrics
      ) VALUES ($1, 'staging', $2, $3, $4, 0, $5, $6::jsonb)
    `, [runId, snapshot.city, snapshot.generatedAt, snapshot.uniqueCount, digest, JSON.stringify({
      schema: snapshot.schema,
      raw_count: snapshot.rawCount,
      duplicate_count: snapshot.duplicateCount,
      invalid_sku_count: snapshot.invalidSkuCount,
      pages_fetched: snapshot.pagesFetched,
    })]);
    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      await insertBatch(client, runId, products.slice(offset, offset + BATCH_SIZE));
    }
    const verified = await client.query(`
      SELECT count(*)::integer AS count,
             count(*) FILTER (WHERE price_amount IS NOT NULL)::integer AS priced,
             count(DISTINCT sku)::integer AS distinct_skus
      FROM daribar_catalog_products WHERE run_id = $1
    `, [runId]);
    const metrics = verified.rows[0];
    if (metrics.count !== products.length || metrics.distinct_skus !== products.length) {
      fail("daribar_catalog_database_verification_failed");
    }
    const previous = await client.query(`
      SELECT active_run_id FROM daribar_catalog_state WHERE singleton FOR UPDATE
    `);
    const previousRunId = previous.rows[0]?.active_run_id || null;
    await client.query(`
      UPDATE daribar_catalog_runs
      SET status = 'published', normalized_count = $2, published_at = now(),
          metrics = metrics || $3::jsonb
      WHERE id = $1 AND status = 'staging'
    `, [runId, products.length, JSON.stringify({ priced_count: metrics.priced })]);
    await client.query(`
      UPDATE daribar_catalog_state
      SET active_run_id = $1, previous_run_id = $2, updated_at = now()
      WHERE singleton
    `, [runId, previousRunId]);
    if (previousRunId && previousRunId !== runId) {
      await client.query(`UPDATE daribar_catalog_runs SET status = 'superseded' WHERE id = $1`, [previousRunId]);
    }
    await client.query("COMMIT");
    transaction = false;
    return {
      ok: true,
      skipped: false,
      runId,
      previousRunId,
      checksum: digest,
      count: products.length,
      pricedCount: metrics.priced,
      generatedAt: snapshot.generatedAt,
    };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (ownsClient) await client.end();
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") return { help: true };
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail("daribar_catalog_missing_argument");
    if (flag === "--snapshot") options.snapshotPath = value;
    else fail("daribar_catalog_unknown_argument");
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve().then(async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/publish-daribar-catalog.mjs [--snapshot PATH]\n");
      return;
    }
    process.stdout.write(`${JSON.stringify(await publishDaribarCatalog(options))}\n`);
  }).catch((error) => {
    const code = /^daribar_catalog_[a-z0-9_]+$/.test(String(error?.message))
      ? error.message : "daribar_catalog_publish_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
}

