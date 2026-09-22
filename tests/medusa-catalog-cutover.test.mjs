import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { guardMedusaProductStock, medusaKnownPriceSql, medusaStockMetadata, medusaStockPriceSql } from "../src/lib/medusa-stock.ts";
import { matchMedusaTitles } from "../src/lib/medusa-search.ts";

const now = Date.parse("2026-09-07T15:00:00Z");
const stock = { standard_n_source_date: "2026-09-06", standard_n_snapshot_id: "verified", standard_n_min_price: 180, standard_n_in_stock: true, standard_n_pharmacy_count: 3 };
test("Medusa stock requires a complete dated import, not a legacy positive price", () => {
  assert.deepEqual(medusaStockMetadata(stock, now), { price: 180, inStock: true, stockPharmacies: 3, sourceDate: "2026-09-06", snapshotId: "verified", stale: false });
  for (const metadata of [{}, { ...stock, standard_n_snapshot_id: "" }]) {
    assert.equal(medusaStockMetadata(metadata, now).inStock, false);
    assert.equal(medusaStockMetadata(metadata, now).price, null);
  }
  const stale = medusaStockMetadata({ ...stock, standard_n_source_date: "2026-08-10" }, now);
  assert.equal(stale.inStock, false);
  assert.equal(stale.price, 180, "a dated historical price remains available for catalogue display");
  assert.equal(medusaStockMetadata({ ...stock, standard_n_in_stock: false }, now).inStock, false);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_min_price: 0 }, now).inStock, false);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_valid_until: "2026-09-07T14:59:59Z" }, now).inStock, false);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_valid_until: "2026-09-07T19:00:00Z" }, now).inStock, true);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_valid_until: "invalid" }, now).inStock, false);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_min_price: 187.53 }, now).price, 187.53);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_min_price: 187.531 }, now).price, null);
  assert.equal(medusaStockMetadata({ ...stock, standard_n_valid_until: "2026-09-07T19:30:00+05:00" }, now).inStock, false);
  assert.match(medusaStockPriceSql(), /standard_n_snapshot_id/);
  assert.match(medusaKnownPriceSql(), /standard_n_min_price/);
  assert.match(medusaKnownPriceSql(), /medusa_price_export_min/);
  assert.doesNotMatch(medusaKnownPriceSql(), /72 hours/);
  assert.throws(() => medusaStockPriceSql("product; DROP TABLE"));
  assert.throws(() => medusaKnownPriceSql("product; DROP TABLE"));
});

test("a complete Medusa price export refreshes catalogue price without asserting stock", () => {
  const exported = medusaStockMetadata({
    ...stock,
    standard_n_source_date: "2026-08-10",
    medusa_price_export_id: "export-20260920",
    medusa_price_export_min: 175.25,
    medusa_price_exported_at: "2026-09-07T14:59:00Z",
  }, now);
  assert.equal(exported.price, 175.25);
  assert.equal(exported.sourceDate, "2026-09-07");
  assert.equal(exported.inStock, false, "price export is display-only; Daribar still confirms stock");
  assert.equal(medusaStockMetadata({
    medusa_price_export_id: "export",
    medusa_price_export_min: 175.251,
    medusa_price_exported_at: "2026-09-07T14:59:00Z",
  }, now).price, null);
  assert.equal(medusaStockMetadata({
    medusa_price_export_id: "export",
    medusa_price_export_min: 175,
    medusa_price_exported_at: "2099-09-07T14:59:00Z",
  }, now).price, null);
});

test("daily Medusa content refresh preserves the separately verified price export", async () => {
  const script = await readFile(new URL("../scripts/sync-medusa-catalog.mjs", import.meta.url), "utf8");
  for (const field of [
    "medusa_price_export_id",
    "medusa_price_export_min",
    "medusa_price_exported_at",
    "medusa_price_export_pharmacy_count",
  ]) {
    assert.match(script, new RegExp(`'${field}', catalog_products\\.metadata->'${field}'`));
  }
  assert.match(script, /metadata = excluded\.metadata \|\| jsonb_strip_nulls\(jsonb_build_object\(/);
});

test("Cached content never extends stock sellability past midnight or source max age", () => {
  const cached = { id: "prod_cached", source: "medusa", name: "Парацетамол", stockSourceDate: "2026-09-06", stockValidUntil: "2026-09-07T20:00:00+05:00", price: 187.53, inStock: true, stockPharmacies: 2, variants: [{ id: "variant_cached", price: 187.53 }] };
  assert.equal(guardMedusaProductStock(cached, now - 1), cached);
  const expired = guardMedusaProductStock(cached, now);
  assert.equal(expired.inStock, false);
  assert.equal(expired.stockStale, true);
  assert.equal(expired.priceTBD, false);
  assert.equal(expired.price, 187.53);
  assert.equal(expired.variants[0].price, 187.53);
  assert.equal(expired.name, cached.name);
  assert.equal(cached.inStock, true, "A cached immutable snapshot is not mutated");
  assert.equal(guardMedusaProductStock({ ...cached, stockValidUntil: undefined }, now + 4 * 86_400_000).inStock, false);
  assert.equal(guardMedusaProductStock({ ...cached, stockValidUntil: "invalid" }, now - 1).inStock, false);
});

const titles = [
  { id: "prod_para500", title: "Парацетамол таблетки 500 мг №10" },
  { id: "prod_para200", title: "Парацетамол таблетки 200 мг №10" },
  { id: "prod_syrup", title: "Парацетамол сироп 120 мг/5 мл 100 мл" },
  { id: "prod_ibuprofen", title: "Ибупрофен таблетки 200 мг №20" },
  { id: "prod_ivatherm", title: "Ivatherm термальная вода 100 мл" },
];
for (const query of ["парацетамол", "пороцетомол", "парацетмоал", "paracetamol", "gfhfwtnfvjk"]) {
  test(`Medusa name search finds source products for ${query}`, () => {
    const result = matchMedusaTitles(titles, query);
    assert.ok(result.ids.includes("prod_para500"));
    assert.ok(!result.ids.includes("prod_ibuprofen"));
    assert.equal(result.search.degraded, false);
  });
}
test("Medusa typo search does not change requested dosage, form or exact mode", () => {
  const result = matchMedusaTitles(titles, "пороцетомол таблетки 500 мг");
  assert.deepEqual(result.ids, ["prod_para500"]);
  assert.deepEqual(matchMedusaTitles(titles, "пороцетомол", true).ids, []);
  assert.deepEqual(matchMedusaTitles(titles, "товар которого нет").ids, []);
});
test("Medusa name search canonicalizes mixed scripts and attached numeric labels", () => {
  const edgeTitles = [
    { id: "prod_mixed", title: "ДЭТA EXTRIME Удалители клещей для людей и животных" },
    { id: "prod_attached", title: "On Line Le Petit Детский увлажняющий гель 3 в1 CREAM для волос, тела и лица 350 мл" },
    { id: "prod_crutches", title: "Костыли Life Cor FS923 L" },
  ];
  assert.deepEqual(matchMedusaTitles(edgeTitles, edgeTitles[0].title, true).ids, ["prod_mixed"]);
  assert.deepEqual(matchMedusaTitles(edgeTitles, edgeTitles[1].title, true).ids, ["prod_attached"]);
  assert.deepEqual(matchMedusaTitles(edgeTitles, "Кастыли Life Cor FS923 L").ids, ["prod_crutches"]);
});
test("All catalog identity, content and price entry points use Medusa, never Daribar or a remote storefront fallback", async () => {
  for (const path of ["src/lib/api.ts", "src/lib/medusa-catalog.ts", "src/lib/catalog-read.ts", "src/app/api/catalog/route.ts", "src/app/api/search/route.ts", "src/app/api/product/[slug]/route.ts", "src/app/api/prices/route.ts", "src/app/api/pharmacies/route.ts", "src/app/catalog/page.tsx", "src/app/catalog/[slug]/page.tsx"]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*(?:daribar\/|remote-catalog)/, path);
  }
});

test("The expensive Medusa title index is revision-aware and prewarmed at server startup", async () => {
  const catalog = await readFile(new URL("../src/lib/medusa-catalog.ts", import.meta.url), "utf8");
  const localRead = await readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../src/instrumentation.ts", import.meta.url), "utf8");
  assert.match(catalog, /getLocalCatalogTitleRevision/);
  assert.match(catalog, /revision !== index\.revision/);
  assert.doesNotMatch(catalog, /index\.expires\s*=\s*Date\.now\(\)\s*\+\s*60_000/);
  assert.match(localRead, /source = 'medusa_standardn' AND status = 'completed'/);
  assert.match(instrumentation, /await prewarmMedusaTitleIndex\(\)/);
});
