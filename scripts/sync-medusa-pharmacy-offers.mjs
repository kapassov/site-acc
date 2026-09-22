#!/usr/bin/env node

/**
 * Incrementally cache the public Medusa per-pharmacy price snapshots.
 *
 * Product listing calculated_price is empty for this sales channel. This
 * worker keeps Postgres warm without issuing ~28k requests on a user path.
 * Missing/oldest checkpoints are processed first, so runs resume naturally.
 */

import process from "node:process";
import pg from "pg";
import {
  normalizePharmacyPayload,
  offerSyncExitCode,
  parseOfferSyncArgs,
  retryableStatus,
  retryableTransactionError,
  transactionRetryDelayMs,
} from "./lib/medusa-offer-sync.mjs";
import { secureMedusaUrl } from "./lib/secure-medusa-url.mjs";

const { Client } = pg;
// Shared with sync-medusa-catalog.mjs so both scans cannot load Medusa at once.
const ADVISORY_LOCK_ID = 4_930_511_108;
const TRANSACTION_ATTEMPTS = 5;

function usage() {
  return `
Usage: node scripts/sync-medusa-pharmacy-offers.mjs [options]

  --apply                       Atomically replace valid product snapshots
  --full                        Backfill every active catalog product
  --failed-only                 Select only products whose last attempt failed
  --limit <1..100000>           Products per resumable run (default: 300)
  --concurrency <1..8>          Concurrent Medusa requests (default: 3)
  --timeout-ms <1000..60000>    Per-attempt timeout (default: 10000)
  --attempts <1..5>             Attempts per product (default: 2)
  --max-pharmacies <1..10000>   Reject unexpectedly large snapshots
  --max-response-bytes <n>      Response body safety limit
  --batch-delay-ms <0..10000>   Pause between request batches

DATABASE_URL, MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY are required. The same
options can be set with CATALOG_OFFER_SYNC_* environment variables.
`;
}

function required(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  throw new Error(`${name} is required`);
}

function postgresOptions(connectionString) {
  const parsed = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  return {
    connectionString,
    statement_timeout: 120_000,
    application_name: "inkar-offer-sync",
    ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined,
  };
}

function medusaBase() {
  return secureMedusaUrl(required("MEDUSA_URL"));
}

function wait(milliseconds) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 1_000);
}

async function limitedJson(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("response_too_large");
  if (!response.body) throw new Error("response_missing_body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks, total);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("response_invalid_json");
  }
}

async function fetchSnapshot(base, publishableKey, productId, options) {
  const endpoint = new URL(`/store/products/${encodeURIComponent(productId)}/pharmacies`, base);
  let finalError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json", "x-publishable-api-key": publishableKey },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`medusa_http_${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await limitedJson(response, options.maxResponseBytes);
    } catch (error) {
      finalError = error;
      const retryable = error?.name === "AbortError"
        || typeof error?.status !== "number"
        || retryableStatus(error.status);
      if (!retryable || attempt >= options.attempts) break;
      await wait(Math.min(2_000, 250 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 100));
    } finally {
      clearTimeout(timer);
    }
  }
  throw finalError;
}

async function selectedProducts(client, limit, failedOnly) {
  const result = await client.query(`
    SELECT product.id, offers.offer_updated_at, state.last_attempt_at
    FROM catalog_products product
    LEFT JOIN catalog_offer_sync_state state ON state.product_id = product.id
    LEFT JOIN LATERAL (
      SELECT max(offer.updated_at) AS offer_updated_at
      FROM catalog_pharmacy_offers offer
      WHERE offer.product_id = product.id
    ) offers ON true
    WHERE product.active
      AND ($2::boolean IS FALSE OR state.status = 'failed')
    ORDER BY greatest(
               coalesce(offers.offer_updated_at, '-infinity'::timestamptz),
               coalesce(state.last_attempt_at, '-infinity'::timestamptz)
             ) ASC,
             product.id ASC
    LIMIT $1
  `, [limit, failedOnly]);
  return result.rows.map((row) => String(row.id));
}

async function recordNonSuccess(client, productId, status, error) {
  await client.query(`
    INSERT INTO catalog_offer_sync_state (
      product_id, last_attempt_at, status, consecutive_failures, last_error, updated_at
    ) VALUES ($1, clock_timestamp(), $2, 1, $3, clock_timestamp())
    ON CONFLICT (product_id) DO UPDATE SET
      last_attempt_at = EXCLUDED.last_attempt_at,
      status = EXCLUDED.status,
      consecutive_failures = catalog_offer_sync_state.consecutive_failures + 1,
      last_error = EXCLUDED.last_error,
      updated_at = EXCLUDED.updated_at
  `, [productId, status, error.slice(0, 1_000)]);
}

async function replaceOffers(client, productId, offers) {
  // Every writer acquires shared pharmacy rows in the same order. Combined
  // with the per-product row lock this prevents the read-through cache and
  // backfill from forming opposite product/offer/pharmacy lock chains.
  const orderedOffers = [...offers].sort((left, right) => left.id.localeCompare(right.id));
  const payload = JSON.stringify(orderedOffers);
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    await client.query("BEGIN");
    try {
      const product = await client.query(
        "SELECT id FROM catalog_products WHERE id = $1 AND active FOR NO KEY UPDATE",
        [productId],
      );
      if (product.rowCount !== 1) throw new Error("local_product_missing_or_inactive");
      await client.query(`
        WITH incoming AS (
          SELECT id, name, nullif(city, '') AS city, nullif(address, '') AS address
          FROM jsonb_to_recordset($1::jsonb)
            AS item(id text, name text, city text, address text, price bigint)
        )
        INSERT INTO catalog_pharmacies (id, name, city, address, metadata, active, updated_at)
        SELECT id, name, city, address,
               '{"source":"medusa_store_product_pharmacies"}'::jsonb,
               true, clock_timestamp()
        FROM incoming
        ORDER BY id
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          city = coalesce(EXCLUDED.city, catalog_pharmacies.city),
          address = coalesce(EXCLUDED.address, catalog_pharmacies.address),
          metadata = catalog_pharmacies.metadata || EXCLUDED.metadata,
          active = true,
          updated_at = EXCLUDED.updated_at
      `, [payload]);
      await client.query("DELETE FROM catalog_pharmacy_offers WHERE product_id = $1", [productId]);
      await client.query(`
        WITH incoming AS (
          SELECT id, price
          FROM jsonb_to_recordset($2::jsonb)
            AS item(id text, name text, city text, address text, price bigint)
        )
        INSERT INTO catalog_pharmacy_offers (
          product_id, variant_id, pharmacy_id, price_amount, currency_code,
          stock_quantity, in_stock, source_updated_at, updated_at
        )
        SELECT $1, NULL, id, price, 'kzt', NULL, true,
               clock_timestamp(), clock_timestamp()
        FROM incoming
        ORDER BY id
      `, [productId, payload]);
      await client.query(`
        INSERT INTO catalog_offer_sync_state (
          product_id, last_attempt_at, last_success_at, status,
          consecutive_failures, last_offer_count, last_error, updated_at
        ) VALUES ($1, clock_timestamp(), clock_timestamp(), 'success', 0, $2, NULL, clock_timestamp())
        ON CONFLICT (product_id) DO UPDATE SET
          last_attempt_at = EXCLUDED.last_attempt_at,
          last_success_at = EXCLUDED.last_success_at,
          status = 'success', consecutive_failures = 0,
          last_offer_count = EXCLUDED.last_offer_count,
          last_error = NULL, updated_at = EXCLUDED.updated_at
      `, [productId, orderedOffers.length]);
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!retryableTransactionError(error) || attempt >= TRANSACTION_ATTEMPTS) throw error;
      console.warn(JSON.stringify({
        event: "offer_sync_db_transaction_retry",
        product_id: productId,
        attempt,
        error_code: error.code,
      }));
      await wait(transactionRetryDelayMs(attempt));
    }
  }
}

async function main() {
  const options = parseOfferSyncArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const databaseUrl = required("DATABASE_URL", ["POSTGRES_URL"]);
  const base = medusaBase();
  const publishableKey = required("MEDUSA_PUBLISHABLE_KEY");
  const client = new Client(postgresOptions(databaseUrl));
  let locked = false;
  const summary = { selected: 0, attempted: 0, updated: 0, empty: 0, failed: 0 };
  try {
    await client.connect();
    const schema = await client.query(`
      SELECT to_regclass('catalog_products') AS products,
             to_regclass('catalog_offer_sync_state') AS sync_state
    `);
    if (!schema.rows[0]?.products || !schema.rows[0]?.sync_state) {
      throw new Error("Catalog offer schema is missing; run npm run db:migrate first");
    }
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [ADVISORY_LOCK_ID]);
    if (!lock.rows[0]?.locked) {
      console.log(JSON.stringify({
        event: "offer_sync_skipped",
        scope: options.full ? "full" : "incremental",
        reason: "catalog_sync_lock_busy",
      }));
      // A bounded timer run may safely skip and try again at its next tick.
      // A manually started full backfill has no timer of its own: report a
      // temporary failure so its systemd unit can retry instead of silently
      // declaring the one-time job complete.
      if (options.full) process.exitCode = 75;
      return;
    }
    locked = true;
    const productIds = await selectedProducts(client, options.limit, options.failedOnly);
    summary.selected = productIds.length;

    for (let offset = 0; offset < productIds.length; offset += options.concurrency) {
      const batch = productIds.slice(offset, offset + options.concurrency);
      const fetched = await Promise.all(batch.map(async (productId) => {
        try {
          const raw = await fetchSnapshot(base, publishableKey, productId, options);
          return { productId, normalized: normalizePharmacyPayload(raw, options) };
        } catch (error) {
          return { productId, error: safeError(error) };
        }
      }));

      for (const result of fetched) {
        summary.attempted += 1;
        if (result.error) {
          summary.failed += 1;
          if (options.apply) await recordNonSuccess(client, result.productId, "failed", result.error);
          console.error(JSON.stringify({ event: "offer_sync_product_failed", product_id: result.productId, error: result.error }));
          continue;
        }
        if (result.normalized.status !== "valid") {
          const status = result.normalized.status === "empty" ? "empty" : "failed";
          if (status === "empty") summary.empty += 1;
          else summary.failed += 1;
          if (options.apply) await recordNonSuccess(client, result.productId, status, result.normalized.reason);
          continue;
        }
        if (options.apply) await replaceOffers(client, result.productId, result.normalized.offers);
        summary.updated += 1;
      }
      if (summary.attempted > 0 && (summary.attempted % 500 === 0 || summary.attempted === summary.selected)) {
        console.log(JSON.stringify({ event: "offer_sync_progress", ...summary }));
      }
      if (offset + options.concurrency < productIds.length) await wait(options.batchDelayMs);
    }
    console.log(JSON.stringify({
      event: "offer_sync_completed",
      mode: options.apply ? "apply" : "dry_run",
      scope: options.full ? "full" : "incremental",
      ...summary,
    }));
    const exitCode = offerSyncExitCode(summary);
    if (exitCode !== 0) {
      console.error(JSON.stringify({
        event: "offer_sync_incomplete",
        scope: options.full ? "full" : "incremental",
        retryable_products: summary.failed + summary.empty,
        exit_code: exitCode,
      }));
      process.exitCode = exitCode;
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
