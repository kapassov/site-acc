#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { aggregateDaribarAvailability } from "../src/lib/daribar/availability-index.ts";
import { searchAllDaribarProductsV3 } from "../src/lib/daribar/product-search-v3.ts";

const LOCK_ID = 4_930_511_111;
const INDEX_COUNT_DESIRED = 99;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function connectionOptions(connectionString, maximum) {
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("availability_database_url_invalid");
  return {
    connectionString,
    max: maximum,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 120_000,
    application_name: "inkar-daribar-availability-sync",
    ...(parsed.searchParams.get("sslmode") === "require" ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}

async function delay(milliseconds) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function loadBatch(skus, city, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await searchAllDaribarProductsV3({
        city,
        // Daribar caps `quantity` at count_desired. Ask for the storefront's
        // maximum per-line quantity so PostgreSQL stores usable stock, not a
        // boolean-looking quantity of one.
        items: skus.map((sku) => ({ sku, countDesired: INDEX_COUNT_DESIRED })),
        availability: "partial",
        replacements: false,
        enableOnSite: true,
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(Math.min(8_000, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error("availability_batch_failed");
}

async function loadBatchResilient(skus, city, attempts) {
  try {
    return await loadBatch(skus, city, attempts);
  } catch (error) {
    if (skus.length === 1) {
      console.warn(JSON.stringify({
        event: "availability_sync_sku_failed",
        sku: skus[0],
        error: String(error?.message || "availability_batch_failed").slice(0, 200),
      }));
      return [];
    }
    const middle = Math.ceil(skus.length / 2);
    const [left, right] = await Promise.all([
      loadBatchResilient(skus.slice(0, middle), city, attempts),
      loadBatchResilient(skus.slice(middle), city, attempts),
    ]);
    return [...left, ...right];
  }
}

async function storeBatch(pool, runId, products, offers) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO daribar_product_availability (
        run_id, sku, in_stock, min_price, pharmacy_count, total_quantity, checked_at
      )
      SELECT $1::uuid, item.sku, item.in_stock, item.min_price,
             item.pharmacy_count, item.total_quantity, item.checked_at
      FROM jsonb_to_recordset($2::jsonb) AS item(
        sku text, in_stock boolean, min_price numeric,
        pharmacy_count integer, total_quantity numeric, checked_at timestamptz
      )
    `, [runId, JSON.stringify(products.map((product) => ({
      sku: product.sku,
      in_stock: product.inStock,
      min_price: product.minPrice,
      pharmacy_count: product.pharmacyCount,
      total_quantity: product.totalQuantity,
      checked_at: product.checkedAt,
    })))]);
    if (offers.length) {
      await client.query(`
        INSERT INTO daribar_pharmacy_offers (
          run_id, sku, source_code, price_amount, stock_quantity,
          payment_on_site, payment_by_card, with_reserve, opening_hours, checked_at
        )
        SELECT $1::uuid, item.sku, item.source_code, item.price_amount,
               item.stock_quantity, item.payment_on_site, item.payment_by_card,
               item.with_reserve, item.opening_hours, item.checked_at
        FROM jsonb_to_recordset($2::jsonb) AS item(
          sku text, source_code text, price_amount numeric,
          stock_quantity numeric, payment_on_site boolean,
          payment_by_card boolean, with_reserve boolean,
          opening_hours text, checked_at timestamptz
        )
      `, [runId, JSON.stringify(offers.map((offer) => ({
        sku: offer.sku,
        source_code: offer.sourceCode,
        price_amount: offer.price,
        stock_quantity: offer.quantity,
        payment_on_site: offer.paymentOnSite ?? null,
        payment_by_card: offer.paymentByCard ?? null,
        with_reserve: offer.withReserve ?? null,
        opening_hours: offer.openingHours ?? null,
        checked_at: offer.checkedAt,
      })))]);
    }
    await client.query(`
      UPDATE daribar_availability_runs
      SET processed_skus = processed_skus + $2,
          offer_count = offer_count + $3
      WHERE id = $1 AND status = 'staging'
    `, [runId, products.length, offers.length]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function syncDaribarAvailability(environment = process.env) {
  const connectionString = String(environment.DATABASE_URL || environment.POSTGRES_URL || "").trim();
  if (!connectionString) throw new Error("availability_database_url_missing");
  const concurrency = boundedInteger(environment.DARIBAR_AVAILABILITY_CONCURRENCY, 2, 1, 6);
  const batchSize = boundedInteger(environment.DARIBAR_AVAILABILITY_BATCH_SIZE, 30, 1, 30);
  const attempts = boundedInteger(environment.DARIBAR_AVAILABILITY_RETRIES, 4, 1, 8);
  const ttlSeconds = boundedInteger(environment.DARIBAR_AVAILABILITY_TTL_SECONDS, 7_200, 300, 86_400);
  const pool = new pg.Pool(connectionOptions(connectionString, concurrency + 2));
  const lockClient = await pool.connect();
  let locked = false;
  let runId;
  try {
    locked = (await lockClient.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID])).rows[0]?.locked === true;
    if (!locked) throw new Error("availability_sync_already_running");
    const active = await lockClient.query(`
      SELECT run.id, run.city
      FROM daribar_catalog_state state
      JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
      WHERE state.singleton
      LIMIT 1
    `);
    const catalogRun = active.rows[0];
    if (!catalogRun) throw new Error("availability_catalog_unavailable");
    const candidates = await lockClient.query(`
      SELECT product.sku
      FROM daribar_catalog_products product
      WHERE product.run_id = $1
      ORDER BY product.sku
    `, [catalogRun.id]);
    const skus = candidates.rows.map((row) => String(row.sku || "").trim()).filter(Boolean);
    if (!skus.length) throw new Error("availability_candidates_empty");
    const mappings = await lockClient.query(`
      SELECT mapping.source_code
      FROM daribar_pharmacy_mappings mapping
      JOIN catalog_pharmacies pharmacy ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
      WHERE mapping.enabled
    `);
    const mapped = new Set(mappings.rows.map((row) => String(row.source_code || "").trim()).filter(Boolean));
    if (!mapped.size) throw new Error("availability_pharmacy_mappings_empty");

    runId = randomUUID();
    await lockClient.query(`
      INSERT INTO daribar_availability_runs (
        id, catalog_run_id, status, city, expected_skus, metrics
      ) VALUES ($1, $2, 'staging', $3, $4, $5::jsonb)
    `, [runId, catalogRun.id, catalogRun.city, skus.length, JSON.stringify({
      batchSize, concurrency, mappedPharmacies: mapped.size,
    })]);

    let cursor = 0;
    let completed = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const start = cursor;
        cursor += batchSize;
        if (start >= skus.length) return;
        const batch = skus.slice(start, start + batchSize);
        const checkedAt = new Date().toISOString();
        const live = await loadBatchResilient(batch, catalogRun.city, attempts);
        const indexed = aggregateDaribarAvailability(batch, live, mapped, checkedAt);
        await storeBatch(pool, runId, indexed.products, indexed.offers);
        completed += batch.length;
        if (completed === skus.length || completed % (batchSize * 20) < batch.length) {
          console.log(JSON.stringify({ event: "availability_sync_progress", completed, expected: skus.length }));
        }
      }
    });
    await Promise.all(workers);

    await lockClient.query("BEGIN");
    const run = await lockClient.query(`
      SELECT processed_skus, expected_skus, offer_count
      FROM daribar_availability_runs
      WHERE id = $1 AND status = 'staging'
      FOR UPDATE
    `, [runId]);
    const counts = await lockClient.query(`
      SELECT count(*)::integer AS stored_skus,
             count(*) FILTER (WHERE in_stock)::integer AS available_skus
      FROM daribar_product_availability
      WHERE run_id = $1
    `, [runId]);
    const row = { ...(run.rows[0] || {}), ...(counts.rows[0] || {}) };
    if (Number(row.processed_skus) !== skus.length || Number(row.expected_skus) !== skus.length
        || Number(row.stored_skus) !== skus.length) throw new Error("availability_sync_incomplete");
    const previous = await lockClient.query(`
      SELECT active_run_id FROM daribar_availability_state WHERE singleton FOR UPDATE
    `);
    const previousRunId = previous.rows[0]?.active_run_id || null;
    await lockClient.query(`
      UPDATE daribar_availability_runs
      SET status = 'published', finished_at = clock_timestamp(),
          valid_until = clock_timestamp() + make_interval(secs => $2::double precision),
          metrics = metrics || $3::jsonb
      WHERE id = $1 AND status = 'staging'
    `, [runId, ttlSeconds, JSON.stringify({ availableSkus: Number(row.available_skus) })]);
    await lockClient.query(`
      UPDATE daribar_availability_state
      SET active_run_id = $1, previous_run_id = $2, updated_at = clock_timestamp()
      WHERE singleton
    `, [runId, previousRunId]);
    if (previousRunId) {
      await lockClient.query(`UPDATE daribar_availability_runs SET status = 'superseded' WHERE id = $1 AND status = 'published'`, [previousRunId]);
    }
    await lockClient.query("COMMIT");
    await lockClient.query(`
      DELETE FROM daribar_availability_runs run
      WHERE run.status IN ('superseded', 'failed')
        AND run.id NOT IN (
          SELECT state.active_run_id FROM daribar_availability_state state WHERE state.active_run_id IS NOT NULL
          UNION
          SELECT state.previous_run_id FROM daribar_availability_state state WHERE state.previous_run_id IS NOT NULL
        )
    `);
    const summary = {
      ok: true, runId, catalogRunId: catalogRun.id, processedSkus: skus.length,
      availableSkus: Number(row.available_skus), offers: Number(row.offer_count),
      mappedPharmacies: mapped.size, ttlSeconds,
    };
    console.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    if (runId) {
      await lockClient.query(`
        UPDATE daribar_availability_runs
        SET status = 'failed', finished_at = clock_timestamp(), error_message = $2
        WHERE id = $1 AND status = 'staging'
      `, [runId, String(error?.message || "availability_sync_failed").slice(0, 1_000)]).catch(() => undefined);
    }
    throw error;
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    lockClient.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncDaribarAvailability().catch((error) => {
    console.error(error instanceof Error ? error.message : "availability_sync_failed");
    process.exitCode = 1;
  });
}
