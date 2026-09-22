import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { canonicalWareId, normalizeMappedOffer, validateMappedManifest, refreshReadModel,
  compactPairKey, publishOfferBatches, databaseStoragePaths, assertStorageHeadroom } from "../scripts/refresh-standardn-read-model.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const wareId = "a1234567-b89c-4def-8a01-23456789abcd";
function manifest() {
  const now = Date.now(), midnight = (Math.floor((now + 5 * 3600000) / 86400000) + 1) * 86400000 - 5 * 3600000;
  return { complete: true, snapshot_id: "a".repeat(64), source_date: new Date().toISOString().slice(0, 10),
    observed_at: new Date().toISOString(), valid_until: new Date(Math.min(midnight, now + 3_600_000)).toISOString(),
    counts: { offers: 1, pharmacies: 1 }, files: {
      offers: { file: "offers.ndjson.gz", sha256: "b".repeat(64), uncompressed_sha256: "c".repeat(64) },
      pharmacies: { file: "pharmacies.ndjson.gz", sha256: "d".repeat(64), uncompressed_sha256: "e".repeat(64) },
    } };
}
function offer(m) {
  return { product_id: "prod_1", variant_id: "variant_1", location_id: "sloc_1", ware_id: wareId,
    pharmacy_id: "123", available_quantity: 2.5, quantity: 3.5, reserved_quantity: 1, retail_amount: 187.53,
    currency: "KZT", snapshot_id: m.snapshot_id, source_date: m.source_date };
}
test("Mapped export validation requires complete immutable hashes, freshness and safe file names", () => {
  const m = manifest();
  assert.equal(validateMappedManifest(m), m);
  assert.throws(() => validateMappedManifest({ ...m, complete: false }));
  assert.throws(() => validateMappedManifest({ ...m, valid_until: new Date(0).toISOString() }));
  assert.throws(() => validateMappedManifest({ ...m, observed_at: new Date(Date.now() - 49 * 3600000).toISOString() }));
  assert.throws(() => validateMappedManifest({ ...m, valid_until: new Date(Date.now() + 49 * 3600000).toISOString() }));
  assert.throws(() => validateMappedManifest({ ...m, files: { ...m.files, offers: { ...m.files.offers, file: "../secret" } } }));
  assert.throws(() => validateMappedManifest({ ...m, counts: { offers: 0, pharmacies: 1 } }));
});
test("Mapped offers preserve tiyn and reservations, never round partial packs or fractional tiyn", () => {
  const m = manifest(), row = offer(m);
  assert.equal(normalizeMappedOffer(row, m).price_decimal, 187.53);
  assert.equal(normalizeMappedOffer(row, m).source_quantity, "2.5");
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: "20.666666666666668" }, m).source_quantity, "20.666666666666668");
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: "1.33333333333333" }, m).source_quantity, "1.33333333333333");
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: "0.99999999999999999999" }, m).in_stock, false);
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: "1e-7" }, m).in_stock, false);
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: 0.5 }, m).in_stock, false);
  assert.equal(normalizeMappedOffer({ ...row, available_quantity: 0 }, m).in_stock, false);
  assert.equal(normalizeMappedOffer({ ...row, retail_amount: null }, m).in_stock, false);
  assert.throws(() => normalizeMappedOffer({ ...row, retail_amount: 187.531 }, m));
  assert.throws(() => normalizeMappedOffer({ ...row, snapshot_id: "wrong" }, m));
  assert.throws(() => normalizeMappedOffer({ ...row, product_id: "daribar_1" }, m));
});

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "medusa-read-refresh-"));
  await mkdir(join(directory, "pg_wal"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const m = manifest();
  const rows = { offers: [offer(m)], pharmacies: [{ id: "sloc_1", pharmacy_id: "123", name: "Аптека 1", city: "Алматы", address: "Абая 10" }] };
  for (const kind of ["offers", "pharmacies"]) {
    const plain = Buffer.from(rows[kind].map((row) => JSON.stringify(row)).join("\n") + "\n"), zipped = gzipSync(plain);
    m.files[kind].sha256 = sha(zipped); m.files[kind].uncompressed_sha256 = sha(plain);
    await writeFile(join(directory, m.files[kind].file), zipped);
  }
  Object.assign(m, overrides);
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(m));
  const product = { id: "prod_1", handle: "paracetamol", title: "Парацетамол", metadata: {
    ware_id: wareId, standard_n_snapshot_id: m.snapshot_id, standard_n_source_date: m.source_date,
    standard_n_valid_until: m.valid_until, standard_n_min_price: 187.53, standard_n_in_stock: true,
  }, variants: [{ id: "variant_1", sku: "sku-1" }], images: [], categories: [] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 1, products: [product] }));
  return { manifestPath, directory, m, product, environment: { MEDUSA_URL: "https://medusa.example.test", MEDUSA_PUBLISHABLE_KEY: "test", DATABASE_URL: "postgresql://unused" } };
}

test("Ware identity matches the backend strict UUID rule, normalizing only case and surrounding whitespace", () => {
  assert.equal(canonicalWareId(wareId), wareId);
  assert.equal(canonicalWareId(` \t${wareId.toUpperCase()}\n`), wareId);
  for (const value of [null, undefined, "", " ", 123, {}, "ware-verified", wareId.replace(/-/g, ""), `${wareId};`, wareId.replace("b89c", "b89g"), wareId.replace("b89c", "b 9c")]) {
    assert.equal(canonicalWareId(value), null);
    assert.throws(() => normalizeMappedOffer({ ...offer(manifest()), ware_id: value }, manifest()), /mapped_offer_invalid/);
  }
  const m = manifest(), row = { ...offer(m), ware_id: ` ${wareId.toUpperCase()} ` };
  assert.equal(normalizeMappedOffer(row, m).ware_id, wareId);
  assert.equal(row.ware_id, ` ${wareId.toUpperCase()} `, "Normalization must not mutate the supplied row");
});
test("Dry-run accepts old uppercase/padded metadata UUID and preserves the original product metadata", async (t) => {
  const input = await fixture(t), original = ` \t${wareId.toUpperCase()}\n`;
  input.product.metadata.ware_id = original;
  const before = JSON.stringify(input.product.metadata);
  const result = await refreshReadModel(input, input.environment);
  assert.equal(result.complete, true);
  assert.equal(result.offers, 1);
  assert.equal(JSON.stringify(input.product.metadata), before);
});
test("Missing or malformed referenced ware UUID fails closed instead of matching by SKU or product title", async (t) => {
  const input = await fixture(t);
  input.product.variants[0].sku = wareId;
  for (const value of [undefined, null, "", "not-a-uuid", `${wareId};`]) {
    input.product.metadata.ware_id = value;
    await assert.rejects(refreshReadModel(input, input.environment), /mapped_offer_identity_or_duplicate/);
  }
});
test("Unmapped legacy content with no offer remains in the complete catalog without inventing a ware identity", async (t) => {
  const input = await fixture(t), legacy = { ...input.product, id: "prod_2", handle: "unmapped-legacy",
    metadata: { ...input.product.metadata, ware_id: null }, variants: [{ id: "variant_2", sku: "legacy-sku" }] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ count: 2, products: [input.product, legacy] }));
  const result = await refreshReadModel(input, input.environment);
  assert.equal(result.processed_products, 2);
  assert.equal(result.offers, 1);
  assert.equal(legacy.metadata.ware_id, null);
});

test("Compact numeric pair keys are exact across distinct variant/location ordinals", () => {
  const seen = new Set();
  for (let variant = 0; variant < 100; variant++) for (let location = 0; location < 521; location++) {
    const key = compactPairKey(variant, location, 521);
    assert.ok(!seen.has(key)); seen.add(key);
  }
  assert.equal(seen.size, 52_100);
  assert.notEqual(compactPairKey(1, 0, 521), compactPairKey(0, 520, 521));
  assert.equal(compactPairKey(28_381, 520, 521), 28_382 * 521 - 1);
  for (const args of [[0, 0, 0], [-1, 0, 1], [0.1, 0, 1], [0, 2, 2], [Number.MAX_SAFE_INTEGER, 0, 2]]) {
    assert.throws(() => compactPairKey(...args), /pair_ordinal/);
  }
});

for (const differentVariant of [false, true]) test(`Dry-run rejects duplicate product/location${differentVariant ? " across variants" : " and variant/location"}`, async (t) => {
  const input = await fixture(t);
  if (differentVariant) input.product.variants.push({ id: "variant_2", sku: "sku-2" });
  const second = { ...offer(input.m), variant_id: differentVariant ? "variant_2" : "variant_1" };
  const plain = Buffer.from([offer(input.m), second].map(JSON.stringify).join("\n") + "\n"), zipped = gzipSync(plain);
  input.m.counts.offers = 2;
  Object.assign(input.m.files.offers, { sha256: sha(zipped), uncompressed_sha256: sha(plain) });
  await writeFile(join(input.directory, input.m.files.offers.file), zipped);
  await writeFile(input.manifestPath, JSON.stringify(input.m));
  await assert.rejects(refreshReadModel(input, input.environment), /mapped_offer_identity_or_duplicate/);
});

test("Offer publish uses bounded keyset statements and never commits a partial batch", async () => {
  const calls = [], progress = []; let checks = 0;
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ published: calls.length === 1 ? "10000" : "7", last_product: `prod_${calls.length}`, last_location: "sloc_1" }] };
  } };
  assert.equal(await publishOfferBatches(client, 10_007, async () => { checks++; }, row => progress.push(row)), 10_007);
  assert.equal(checks, 2);
  assert.deepEqual(calls.map(x => x.params), [["", "", 10000], ["prod_1", "sloc_1", 10000]]);
  assert.ok(calls.every(x => x.sql.includes("WHERE (product_id,location_id)>") && x.sql.includes("LIMIT $3")
    && !/\b(?:BEGIN|COMMIT|OFFSET)\b/.test(x.sql)));
  assert.deepEqual(progress.map(x => [x.event, x.offers]), [["offers_written_uncommitted", 10000], ["offers_written_uncommitted", 10007]]);
  await assert.rejects(publishOfferBatches({ query: async () => ({ rows: [{ published: 0 }] }) }, 1), /published_offer_batch_mismatch/);
});

test("Storage guard checks database, external tablespaces and resolved WAL, not just downloads", async () => {
  const root = tmpdir(), data = join(root, "pg-data"), tablespace = join(root, "external-pg"), wal = join(root, "external-wal");
  const paths = await databaseStoragePaths({ query: async () => ({ rows: [{ data_directory: data, tablespaces: [tablespace] }] }) }, root,
    async path => path === join(data, "pg_wal") ? wal : path);
  assert.deepEqual(paths, [root, data, wal, tablespace]);
  const checked = [];
  await assert.rejects(assertStorageHeadroom(paths, "publish", async path => {
    checked.push(path); return { bavail: path === wal ? 1 : 10_000_000, bsize: 4096 };
  }), /insufficient_catalog_publish_headroom/);
  assert.ok(checked.includes(wal));
  await assert.rejects(databaseStoragePaths({ query: async () => ({ rows: [] }) }, root), /postgres_storage_paths_unavailable/);
});

test("Trusted absolute database path works without privileged settings and still discovers tablespaces", async () => {
  const root = tmpdir(), data = join(root, "verified-pg"), external = join(root, "tablespace"), resolved = [];
  const client = { query: async (sql, params) => {
    assert.ok(!sql.includes("current_setting"));
    assert.ok(sql.includes("pg_tablespace_location"));
    assert.deepEqual(params, [data]);
    return { rows: [{ data_directory: params[0], tablespaces: [external] }] };
  } };
  const result = await databaseStoragePaths(client, root, async path => { resolved.push(path); return path; }, data);
  assert.deepEqual(result, [root, data, join(data, "pg_wal"), external]);
  assert.deepEqual(resolved, result);
  for (const invalid of ["relative/path", "", "../postgres"])
    await assert.rejects(databaseStoragePaths(client, root, async path => path, invalid), /invalid_postgres_data_directory_override/);
});
test("Default refresh fully validates mapped gzip/content hashes and identities without any DB writes", async (t) => {
  const input = await fixture(t);
  const result = await refreshReadModel(input, input.environment);
  assert.equal(result.complete, true);
  assert.equal(result.processed_products, 1);
  assert.equal(result.offers, 1);
});
test("A mismatched complete-file count cannot publish", async (t) => {
  const input = await fixture(t, { counts: { offers: 2, pharmacies: 1 } });
  await assert.rejects(refreshReadModel(input, input.environment), /mapped_offer_count_mismatch/);
});
test("A corrupt mapped archive hash fails validation rather than trusting a complete flag", async (t) => {
  const input = await fixture(t);
  input.m.files.offers.sha256 = "f".repeat(64);
  await writeFile(input.manifestPath, JSON.stringify(input.m));
  await assert.rejects(refreshReadModel(input, input.environment), /mapped_hash_mismatch/);
});
test("Unchanged apply verifies gzip hashes then skips heavy HTTP scans without a write transaction", async (t) => {
  const input = await fixture(t), calls = [];
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unchanged import must not call Medusa"); });
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("current_setting('data_directory')")) return { rows: [{ data_directory: input.directory, tablespaces: [] }] };
      if (sql.startsWith("SELECT r.id,r.expected_products")) return { rows: [{ id: "run-verified", expected_products: 1, metrics: { complete: true } }] };
      return { rows: [], rowCount: 1 };
    }
  }
  t.mock.property(pg, "Client", FakeClient);
  const result = await refreshReadModel({ ...input, apply: true }, input.environment);
  assert.equal(result.skipped, true);
  assert.ok(!calls.includes("BEGIN"));
  assert.ok(!calls.some((sql) => sql.includes("INSERT INTO")));
});
for (const fail of [false, true]) test(`Atomic publish ${fail ? "rolls back all content if offers fail" : "commits content, precise offers and verification marker together"}`, async (t) => {
  const input = await fixture(t), calls = [], staged = [], storedProducts = [];
  const originalWareId = ` ${wareId.toUpperCase()} `;
  input.product.metadata.ware_id = originalWareId;
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("current_setting('data_directory')")) return { rows: [{ data_directory: input.directory, tablespaces: [] }] };
      if (sql.startsWith("INSERT INTO stage_medusa_products")) staged.push(...JSON.parse(values[0]));
      if (sql.includes("INSERT INTO catalog_products")) storedProducts.push(...JSON.parse(values[1]));
      if (sql.startsWith("SELECT doc FROM stage_medusa_products")) return { rows: staged.map((doc) => ({ doc })) };
      if (sql.startsWith("SELECT count(*) n FROM catalog_products")) return { rows: [{ n: staged.length }] };
      if (sql.includes("INSERT INTO catalog_pharmacy_offers")) {
        if (fail) throw new Error("simulated_offer_write_failure");
        return { rows: [{ published: 1, last_product: "prod_1", last_location: "sloc_1" }] };
      }
      return { rows: [], rowCount: 1 };
    }
  }
  t.mock.property(pg, "Client", FakeClient);
  const run = refreshReadModel({ ...input, apply: true }, input.environment);
  if (fail) { await assert.rejects(run, /simulated_offer_write_failure/); assert.ok(calls.includes("ROLLBACK")); assert.ok(!calls.includes("COMMIT")); }
  else { await run; assert.equal(calls.filter((sql) => sql === "BEGIN").length, 1); assert.equal(calls.filter((sql) => sql === "COMMIT").length, 1); }
  const begin = calls.indexOf("BEGIN");
  assert.ok(calls.findIndex((sql) => sql.startsWith("INSERT INTO stage_medusa_products")) < begin);
  assert.ok(calls.findIndex((sql) => sql.includes("INSERT INTO catalog_products")) > begin);
  assert.ok(calls.find((sql) => sql.includes("INSERT INTO catalog_pharmacy_offers"))?.includes("price_decimal"));
  assert.ok(!calls.some((sql) => sql.includes("DELETE FROM catalog_pharmacy_offers")));
  assert.equal(staged[0].metadata.ware_id, originalWareId);
  assert.equal(storedProducts[0].metadata.ware_id, originalWareId, "Only the comparison map is canonicalized, never stored metadata");
});
