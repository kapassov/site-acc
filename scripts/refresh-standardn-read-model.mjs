#!/usr/bin/env node
/** Complete Medusa content + validated mapped stock, staged before one atomic publish.
 * Default is read-only validation. Usage: node --env-file=.env.production scripts/refresh-standardn-read-model.mjs --manifest /absolute/mapped-manifest.json [--apply] [--force]
 * Run migrations 015, 017 and 018 first. Historical integer-price/fixed-scale stock columns are NOT authoritative.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, statfs } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { fetchJson, normalizePage, syncPage } from "./sync-medusa-catalog.mjs";
import { kztMinorUnits } from "../src/lib/money.ts";

const hashPattern = /^[0-9a-f]{64}$/;
const lockId = 4_930_511_108; // Same lock as the ordinary catalogue importer.
const idPattern = { product: /^prod_[A-Za-z0-9]+$/, variant: /^variant_[A-Za-z0-9]+$/, location: /^sloc_[A-Za-z0-9]+$/ };
const text = (value) => typeof value === "string" ? value.trim() : "";
const publishBatchSize = 10_000;
const minimumFreeBytes = 2 * 1024 ** 3;

// Match Medusa's identity rule without rewriting protected product metadata.
export function canonicalWareId(value) {
  if (typeof value !== "string") return null;
  const result = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result) ? result : null;
}

// Native identifiers are validated separately. Ordinals avoid retaining 1.38M
// concatenated ID strings; multiplication must remain exact (never a hash).
export function compactPairKey(left, right, rightCount) {
  if (![left, right, rightCount].every(Number.isSafeInteger) || left < 0 || right < 0
    || rightCount < 1 || right >= rightCount) throw new Error("invalid_pair_ordinal");
  const key = left * rightCount + right;
  if (!Number.isSafeInteger(key) || !Number.isSafeInteger(left * rightCount)) throw new Error("pair_ordinal_overflow");
  return key;
}

export async function databaseStoragePaths(client, directory, resolvePath = realpath, configuredDataDirectory) {
  const configured = text(configuredDataDirectory);
  if (configuredDataDirectory !== undefined && !isAbsolute(configured)) throw new Error("invalid_postgres_data_directory_override");
  // Only trusted worker environment may supply this path, never HTTP input.
  // App roles need not receive pg_read_all_settings solely for a disk check.
  const result = await client.query(`SELECT ${configured ? "$1::text" : "current_setting('data_directory')"} AS data_directory,
    ARRAY(SELECT pg_tablespace_location(oid) FROM pg_tablespace WHERE pg_tablespace_location(oid) <> '') AS tablespaces`, configured ? [configured] : []);
  const settings = result.rows[0];
  if (!isAbsolute(settings?.data_directory || "") || !Array.isArray(settings.tablespaces)
    || settings.tablespaces.some((path) => !isAbsolute(path))) throw new Error("postgres_storage_paths_unavailable");
  // Resolve the WAL symlink too: downloads, table/temp tablespaces and WAL can
  // be on different filesystems. A downloads-only free-space check is unsafe.
  return [...new Set(await Promise.all([directory, settings.data_directory,
    join(settings.data_directory, "pg_wal"), ...settings.tablespaces].map((path) => resolvePath(path))))];
}

export async function assertStorageHeadroom(paths, stage, inspect = statfs) {
  for (const path of paths) {
    const disk = await inspect(path);
    if (disk.bavail * disk.bsize < minimumFreeBytes) throw new Error(`insufficient_catalog_${stage}_headroom`);
  }
}

export async function publishOfferBatches(client, expected, beforeBatch = async () => {}, report = () => {}) {
  let published = 0, lastProduct = "", lastLocation = "";
  while (published < expected) {
    await beforeBatch();
    // This remains inside the caller's SINGLE publish transaction. Bounded
    // statements also bound FK-trigger memory and respect statement_timeout.
    const result = await client.query(`WITH batch AS MATERIALIZED (
      SELECT * FROM stage_medusa_offers WHERE (product_id,location_id)>($1::text,$2::text)
      ORDER BY product_id,location_id LIMIT $3
    ), written AS (
      INSERT INTO catalog_pharmacy_offers(product_id,variant_id,pharmacy_id,price_amount,price_decimal,currency_code,stock_quantity,source_quantity,in_stock,source_updated_at,source_snapshot_id,updated_at)
      SELECT product_id,variant_id,location_id,0,price_decimal,'kzt',NULL,source_quantity,in_stock,source_updated_at,source_snapshot_id,now() FROM batch
      ON CONFLICT(product_id,pharmacy_id) DO UPDATE SET variant_id=excluded.variant_id,price_amount=0,price_decimal=excluded.price_decimal,
      currency_code='kzt',stock_quantity=NULL,source_quantity=excluded.source_quantity,in_stock=excluded.in_stock,source_updated_at=excluded.source_updated_at,
      source_snapshot_id=excluded.source_snapshot_id,updated_at=now()
      RETURNING 1
    ) SELECT count(*) AS published,
      (SELECT product_id FROM batch ORDER BY product_id DESC,location_id DESC LIMIT 1) AS last_product,
      (SELECT location_id FROM batch ORDER BY product_id DESC,location_id DESC LIMIT 1) AS last_location FROM written`,
    [lastProduct, lastLocation, publishBatchSize]);
    const row = result.rows[0], count = Number(row?.published);
    if (!Number.isSafeInteger(count) || count < 1 || count > publishBatchSize || published + count > expected
      || !idPattern.product.test(row?.last_product || "") || !idPattern.location.test(row?.last_location || "")
      || (row.last_product === lastProduct && row.last_location === lastLocation)) throw new Error("published_offer_batch_mismatch");
    published += count; lastProduct = row.last_product; lastLocation = row.last_location;
    report({ event: "offers_written_uncommitted", offers: published, expected });
  }
  return published;
}

export function validateMappedManifest(manifest, now = Date.now()) {
  const observedAt = Date.parse(manifest?.observed_at), validUntil = Date.parse(manifest?.valid_until);
  const almatyMidnight = (Math.floor((now + 5 * 3600_000) / 86_400_000) + 1) * 86_400_000 - 5 * 3600_000;
  if (manifest?.complete !== true || !hashPattern.test(manifest.snapshot_id || "")
    || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.source_date || "")
    || !Number.isFinite(Date.parse(manifest.observed_at))
    || now - Date.parse(manifest.observed_at) > 48 * 3600_000
    || Date.parse(manifest.observed_at) > now + 300_000
    || !(validUntil > now) || validUntil > observedAt + 48 * 3600_000
    || validUntil > almatyMidnight) throw new Error("mapped_manifest_incomplete_or_stale");
  for (const kind of ["offers", "pharmacies"]) {
    const spec = manifest.files?.[kind];
    if (!spec || !text(spec.file) || basename(spec.file) !== spec.file || spec.file.includes("\\")
      || !hashPattern.test(spec.sha256 || "") || !hashPattern.test(spec.uncompressed_sha256 || "")
      || !Number.isSafeInteger(manifest.counts?.[kind]) || manifest.counts[kind] < 1) throw new Error(`mapped_manifest_invalid_${kind}`);
  }
  if (manifest.files.offers.file === manifest.files.pharmacies.file) throw new Error("mapped_manifest_files_must_differ");
  return manifest;
}

async function* mappedRows(directory, spec) {
  const raw = createReadStream(join(directory, spec.file));
  const zippedHash = createHash("sha256"), contentHash = createHash("sha256");
  raw.on("data", (chunk) => zippedHash.update(chunk));
  const decoded = spec.file.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  raw.on("error", (error) => decoded.destroy(error));
  const decoder = new TextDecoder();
  let pending = "", count = 0;
  try {
    for await (const chunk of decoded) {
      contentHash.update(chunk);
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (!line) throw new Error(`blank_ndjson_line:${spec.file}:${count + 1}`);
        yield JSON.parse(line); count++;
      }
      if (pending.length > 8 * 1024 * 1024) throw new Error("ndjson_line_too_large");
    }
    pending += decoder.decode();
    if (pending.trim()) { yield JSON.parse(pending); count++; }
    if (zippedHash.digest("hex") !== spec.sha256 || contentHash.digest("hex") !== spec.uncompressed_sha256) throw new Error(`mapped_hash_mismatch:${spec.file}`);
  } finally { raw.destroy(); decoded.destroy(); }
}

async function verifyCompressedFiles(directory, manifest) {
  for (const spec of Object.values(manifest.files)) {
    if (!spec || basename(spec.file) !== spec.file || spec.file.includes("\\")) throw new Error("unsafe_manifest_file");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(directory, spec.file))) hash.update(chunk);
    if (hash.digest("hex") !== spec.sha256) throw new Error(`mapped_hash_mismatch:${spec.file}`);
  }
}

export function normalizeMappedOffer(row, manifest) {
  const product_id = text(row?.product_id), variant_id = text(row?.variant_id), location_id = text(row?.location_id);
  const ware_id = canonicalWareId(row?.ware_id);
  const quantity = Number(row?.available_quantity), rawPrice = row?.retail_amount ?? row?.price;
  const sourceQuantity = typeof row?.available_quantity === "string" ? row.available_quantity.trim() : String(quantity);
  const decimal = sourceQuantity.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  const minor = rawPrice == null ? null : kztMinorUnits(Number(rawPrice));
  if (!idPattern.product.test(product_id) || !idPattern.variant.test(variant_id) || !idPattern.location.test(location_id)
    || row?.snapshot_id !== manifest.snapshot_id || row?.source_date !== manifest.source_date
    || row?.currency !== "KZT" || !ware_id
    || !Number.isFinite(quantity) || quantity < 0 || quantity >= 100_000_000_000
    || !decimal
    || (rawPrice != null && minor === null)) throw new Error("mapped_offer_invalid");
  const coefficient = decimal[1] + (decimal[2] || "");
  const firstNonzero = coefficient.search(/[1-9]/);
  const hasWholePack = firstNonzero >= 0 && decimal[1].length + Number(decimal[3] || 0) - firstNonzero >= 1;
  return { product_id, variant_id, location_id, ware_id,
    pharmacy_external_id: String(row.pharmacy_id ?? ""), source_quantity: sourceQuantity,
    price_decimal: minor == null ? null : minor / 100,
    in_stock: hasWholePack && minor !== null && minor > 0,
    source_snapshot_id: manifest.snapshot_id, source_updated_at: manifest.observed_at };
}

function normalizePharmacy(row) {
  const id = text(row?.location_id || row?.id);
  if (!idPattern.location.test(id) || !text(row?.name)) throw new Error("mapped_pharmacy_invalid");
  const coordinate = (value, maximum) => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= maximum ? Number(value) : null;
  return { id, external_id: String(row.pharmacy_id ?? row.pharm_id ?? "") || null, name: row.name.trim(),
    city: text(row.city) || null, address: text(row.address) || null,
    latitude: coordinate(row.latitude ?? row.lat, 90), longitude: coordinate(row.longitude ?? row.lon, 180),
    metadata: { source: "medusa_standardn", hours: text(row.hours) } };
}

async function stageJson(client, table, rows) {
  if (!client || !rows.length) return;
  const allowed = ["stage_medusa_products", "stage_medusa_pharmacies"];
  if (!allowed.includes(table)) throw new Error("invalid_staging_table");
  await client.query(`INSERT INTO ${table}(id,doc) SELECT item->>'id',item FROM jsonb_array_elements($1::jsonb) item`, [JSON.stringify(rows)]);
}

export async function refreshReadModel({ manifestPath, apply = false, force = false }, environment = process.env) {
  if (!isAbsolute(manifestPath)) throw new Error("manifest_path_must_be_absolute");
  const manifestBytes = await readFile(manifestPath);
  const manifest = validateMappedManifest(JSON.parse(manifestBytes.toString("utf8")));
  const manifestHash = createHash("sha256").update(manifestBytes).digest("hex");
  const medusa = new URL(environment.MEDUSA_URL || "");
  if ((medusa.protocol !== "https:" && !(medusa.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(medusa.hostname)))
    || medusa.username || medusa.password || !environment.MEDUSA_PUBLISHABLE_KEY) throw new Error("secure_medusa_configuration_required");
  const headers = { accept: "application/json", "x-publishable-api-key": environment.MEDUSA_PUBLISHABLE_KEY };
  const directory = dirname(manifestPath), runId = randomUUID();
  const products = new Map(), variants = new Map(), pharmacies = new Map();
  const productOrdinals = new Map(), variantOrdinals = new Map(), locationOrdinals = new Map();
  const productOfferKeys = new Set(), variantOfferKeys = new Set();
  let storagePaths = [];
  let client = null, transaction = false, locked = false, expected = null, offset = 0, offerCount = 0;
  try {
    if (apply) {
      const connectionString = environment.DATABASE_URL || environment.POSTGRES_URL;
      if (!connectionString) throw new Error("DATABASE_URL_required");
      client = new pg.Client({ connectionString, application_name: "inkar-standardn-atomic-read-refresh", statement_timeout: 120_000 });
      await client.connect();
      await client.query("SET lock_timeout='5s'");
      locked = (await client.query("SELECT pg_try_advisory_lock($1) locked", [lockId])).rows[0]?.locked === true;
      if (!locked) throw new Error("catalog_sync_already_running");
      await client.query("SELECT price_decimal, source_quantity, source_snapshot_id FROM catalog_pharmacy_offers LIMIT 0");
      if (!force) {
        const previous = await client.query(`SELECT r.id,r.expected_products,r.metrics FROM catalog_import_runs r
          WHERE r.source='medusa_standardn' AND r.status='completed' AND r.expected_products=r.processed_products
            AND r.metrics @> '{"complete":true,"start_offset":0,"started_offset":0,"limit":null}'::jsonb
            AND r.metrics->>'manifest_sha256'=$1 AND r.metrics->>'snapshot_id'=$2
            AND r.expected_products=(SELECT count(*) FROM catalog_products WHERE active)
            AND NOT EXISTS(SELECT 1 FROM catalog_products p WHERE p.active AND
              (p.source_run_id IS DISTINCT FROM r.id OR p.metadata->>'standard_n_snapshot_id' IS DISTINCT FROM $2))
          ORDER BY r.started_at DESC LIMIT 1`, [manifestHash, manifest.snapshot_id]);
        if (previous.rows[0]) {
          // The same manifest/content hashes were fully verified on the successful run.
          // Re-hash the compressed files before skipping decompression/HTTP/catalog scans.
          await verifyCompressedFiles(directory, manifest);
          validateMappedManifest(manifest);
          const summary = { ...previous.rows[0].metrics, skipped: true, unchanged: true };
          console.log(JSON.stringify({ event: "read_model_unchanged", ...summary }));
          return summary;
        }
      }
      storagePaths = await databaseStoragePaths(client, directory, realpath, environment.CATALOG_PG_DATA_DIRECTORY);
      await assertStorageHeadroom(storagePaths, "staging");
      await client.query(`CREATE TEMP TABLE stage_medusa_products(id text PRIMARY KEY,doc jsonb NOT NULL);
        CREATE TEMP TABLE stage_medusa_pharmacies(id text PRIMARY KEY,doc jsonb NOT NULL);
        CREATE TEMP TABLE stage_medusa_offers(product_id text,variant_id text,location_id text,ware_id text,pharmacy_external_id text,source_quantity numeric,price_decimal numeric(18,2),in_stock boolean,source_snapshot_id text,source_updated_at timestamptz,PRIMARY KEY(product_id,location_id));`);
    }
    // Content is complete before any published table is touched. Every page must belong to the same source snapshot.
    do {
      const url = new URL("/store/products", medusa);
      url.search = new URLSearchParams({ limit: "500", offset: String(offset), fields: "id,title,handle,subtitle,description,thumbnail,created_at,updated_at,+metadata,*variants,*categories,*images" }).toString();
      if (environment.MEDUSA_SALES_CHANNEL) url.searchParams.set("sales_channel_id", environment.MEDUSA_SALES_CHANNEL);
      const data = await fetchJson(url, headers);
      if (!Array.isArray(data?.products) || !Number.isSafeInteger(data.count) || data.count < 1 || data.products.length > 500
        || (expected !== null && data.count !== expected)) throw new Error("medusa_product_page_incomplete");
      expected = data.count;
      if (!data.products.length && offset < expected) throw new Error("medusa_product_page_stalled");
      for (const product of data.products) {
        if (!idPattern.product.test(product?.id || "") || !text(product.title) || !text(product.handle)
          || products.has(product.id) || product.metadata?.standard_n_snapshot_id !== manifest.snapshot_id
          || product.metadata?.standard_n_source_date !== manifest.source_date
          || Date.parse(product.metadata?.standard_n_valid_until) !== Date.parse(manifest.valid_until)
          || !Array.isArray(product.variants) || !product.variants.length || !Array.isArray(product.categories) || !Array.isArray(product.images)) throw new Error("medusa_product_identity_or_snapshot_invalid");
        // Unmapped legacy content may lack a ware UUID. It may remain visible,
        // but any offer referencing it must fail the identity comparison below.
        products.set(product.id, canonicalWareId(product.metadata.ware_id));
        productOrdinals.set(product.id, productOrdinals.size);
        for (const variant of product.variants) {
          if (!idPattern.variant.test(variant?.id || "") || variants.has(variant.id)) throw new Error("medusa_variant_identity_invalid");
          variants.set(variant.id, product.id);
          variantOrdinals.set(variant.id, variantOrdinals.size);
          // The local legacy integer-price view must not reintroduce rounded prices or old sale badges.
          variant.calculated_price = null;
        }
      }
      normalizePage(data.products); // Validate the complete existing content mapping even during a dry run.
      await stageJson(client, "stage_medusa_products", data.products);
      offset += data.products.length;
      console.log(JSON.stringify({ event: "content_staged", products: offset, expected }));
    } while (offset < expected);
    if (offset !== expected || products.size !== expected) throw new Error("medusa_product_count_mismatch");

    let pharmacyBatch = [];
    for await (const raw of mappedRows(directory, manifest.files.pharmacies)) {
      const row = normalizePharmacy(raw);
      if (pharmacies.has(row.id)) throw new Error("duplicate_pharmacy");
      pharmacies.set(row.id, row.external_id);
      locationOrdinals.set(row.id, locationOrdinals.size);
      pharmacyBatch.push(row);
      if (pharmacyBatch.length >= 500) { await stageJson(client, "stage_medusa_pharmacies", pharmacyBatch); pharmacyBatch = []; }
    }
    await stageJson(client, "stage_medusa_pharmacies", pharmacyBatch);
    if (pharmacies.size !== manifest.counts.pharmacies) throw new Error("mapped_pharmacy_count_mismatch");
    let offerBatch = [];
    const flushOffers = async () => {
      if (client && offerBatch.length) await client.query(`INSERT INTO stage_medusa_offers SELECT * FROM jsonb_populate_recordset(NULL::stage_medusa_offers,$1::jsonb)`, [JSON.stringify(offerBatch)]);
      offerBatch = [];
    };
    for await (const raw of mappedRows(directory, manifest.files.offers)) {
      const row = normalizeMappedOffer(raw, manifest);
      if (!products.has(row.product_id) || variants.get(row.variant_id) !== row.product_id
        || products.get(row.product_id) !== row.ware_id || !pharmacies.has(row.location_id)
        || pharmacies.get(row.location_id) !== row.pharmacy_external_id) throw new Error("mapped_offer_identity_or_duplicate");
      const productKey = compactPairKey(productOrdinals.get(row.product_id), locationOrdinals.get(row.location_id), pharmacies.size);
      const variantKey = compactPairKey(variantOrdinals.get(row.variant_id), locationOrdinals.get(row.location_id), pharmacies.size);
      // Preserve the read-table's product/location PK as well as native
      // variant/location identity; different variants must not silently merge.
      if (productOfferKeys.has(productKey) || variantOfferKeys.has(variantKey)) throw new Error("mapped_offer_identity_or_duplicate");
      productOfferKeys.add(productKey); variantOfferKeys.add(variantKey); offerCount++; offerBatch.push(row);
      if (offerBatch.length >= 1000) await flushOffers();
      if (client && offerCount % publishBatchSize === 0) {
        await assertStorageHeadroom(storagePaths, "staging");
        console.log(JSON.stringify({ event: "offers_staged", offers: offerCount, expected: manifest.counts.offers }));
      }
    }
    await flushOffers();
    if (offerCount !== manifest.counts.offers) throw new Error("mapped_offer_count_mismatch");
    validateMappedManifest(manifest);
    const summary = { complete: true, start_offset: 0, started_offset: 0, limit: null, snapshot_id: manifest.snapshot_id,
      source_date: manifest.source_date, valid_until: manifest.valid_until, manifest_sha256: manifestHash,
      expected_products: expected, processed_products: products.size, offers: offerCount, pharmacies: pharmacies.size };
    if (!client) { console.log(JSON.stringify({ event: "validated_dry_run", ...summary })); return summary; }

    productOfferKeys.clear(); variantOfferKeys.clear();
    await assertStorageHeadroom(storagePaths, "publish");
    await client.query("BEGIN"); transaction = true;
    await client.query("INSERT INTO catalog_import_runs(id,source,status,expected_products,metrics) VALUES($1,'medusa_standardn','running',$2,$3::jsonb)", [runId, expected, JSON.stringify(summary)]);
    for (let start = 0; start < expected; start += 500) {
      await assertStorageHeadroom(storagePaths, "publish");
      const page = await client.query("SELECT doc FROM stage_medusa_products ORDER BY id LIMIT 500 OFFSET $1", [start]);
      await syncPage(client, runId, normalizePage(page.rows.map((row) => row.doc)), { manageTransaction: false });
    }
    await client.query(`INSERT INTO catalog_pharmacies(id,external_id,name,city,address,latitude,longitude,metadata,active,updated_at)
      SELECT id,external_id,name,city,address,latitude,longitude,metadata,true,now() FROM jsonb_to_recordset((SELECT jsonb_agg(doc) FROM stage_medusa_pharmacies))
      AS x(id text,external_id text,name text,city text,address text,latitude numeric,longitude numeric,metadata jsonb)
      ON CONFLICT(id) DO UPDATE SET external_id=excluded.external_id,name=excluded.name,city=excluded.city,address=excluded.address,
      latitude=excluded.latitude,longitude=excluded.longitude,metadata=catalog_pharmacies.metadata||excluded.metadata,active=true,updated_at=now()`);
    // No deletion of old/off-source offers. Exact snapshot guards make absent old pairs unorderable.
    await publishOfferBatches(client, offerCount,
      () => assertStorageHeadroom(storagePaths, "publish"), (progress) => console.log(JSON.stringify(progress)));
    // Retain historical rows for recovery, but only the verified full Medusa list is active.
    await client.query("UPDATE catalog_products SET active=false,updated_at=now() WHERE active AND source_run_id IS DISTINCT FROM $1", [runId]);
    await client.query("UPDATE catalog_variants v SET active=false,updated_at=now() WHERE active AND NOT EXISTS(SELECT 1 FROM catalog_products p WHERE p.id=v.product_id AND p.active)");
    const active = Number((await client.query("SELECT count(*) n FROM catalog_products WHERE active")).rows[0].n);
    if (active !== expected) throw new Error("published_product_count_mismatch");
    validateMappedManifest(manifest);
    const completed = await client.query("UPDATE catalog_import_runs SET status='completed',finished_at=now(),metrics=metrics||$2::jsonb WHERE id=$1 AND processed_products=$3", [runId, JSON.stringify(summary), expected]);
    if (completed.rowCount !== 1) throw new Error("published_run_count_mismatch");
    await client.query("COMMIT"); transaction = false;
    console.log(JSON.stringify({ event: "read_model_published", run_id: runId, ...summary }));
    return summary;
  } catch (error) {
    if (transaction && client) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (client) { if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lockId]).catch(() => undefined); await client.end(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), manifestIndex = args.indexOf("--manifest");
  const manifestPath = manifestIndex >= 0 ? args[manifestIndex + 1] : null;
  if (!manifestPath || args.some((arg, index) => !["--apply", "--force", "--manifest"].includes(arg) && index !== manifestIndex + 1)) {
    console.error("Usage: node scripts/refresh-standardn-read-model.mjs --manifest /absolute/mapped-manifest.json [--apply] [--force]"); process.exitCode = 1;
  } else refreshReadModel({ manifestPath, apply: args.includes("--apply"), force: args.includes("--force") }).catch((error) => { console.error(error instanceof Error ? error.message : "read_model_refresh_failed"); process.exitCode = 1; });
}
