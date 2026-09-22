import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildFullCatalogFacetsSql,
  catalogQueryNeedsPrice,
  localCatalogFacetsFromRow,
  verifiedSnapshotExpected,
} from "../src/lib/catalog-local-read.ts";
import { parseCatalogQuery } from "../src/lib/catalog-query.ts";
import {
  categoriesWithFullFacetCounts,
  postgresCatalogMeta,
} from "../src/lib/catalog-api-response.ts";

test("Postgres facet SQL aggregates before pagination and expands category descendants", () => {
  const sql = buildFullCatalogFacetsSql(
    "",
    "",
    "NULL::bigint",
    "NULL::bigint",
    "product.active",
  );

  assert.match(sql, /filtered_products AS MATERIALIZED/);
  assert.match(sql, /category_descendants\(ancestor_id, descendant_id\)/);
  assert.match(sql, /count\(DISTINCT filtered\.id\)::integer/);
  assert.match(sql, /JOIN catalog_categories child ON child\.parent_id = tree\.descendant_id/);
  assert.doesNotMatch(sql, /\bLIMIT\b|\bOFFSET\b/);
});

test("snapshot verification keeps the last completed full run while newer runs are in progress", async () => {
  const metrics = { complete: true, start_offset: 0, started_offset: 0, limit: null };
  assert.equal(verifiedSnapshotExpected({
    status: "completed",
    expected_products: 27_975,
    processed_products: 27_975,
    metrics,
  }), 27_975);
  assert.equal(verifiedSnapshotExpected({
    status: "running",
    expected_products: 27_975,
    processed_products: 100,
    metrics: { ...metrics, complete: false },
  }), null);

  const source = await readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8");
  assert.match(source, /FROM catalog_import_runs\s+WHERE status = 'completed'/);
  assert.match(source, /expected_products = processed_products/);
  assert.match(source, /metrics @> '\{"complete":true,"start_offset":0,"started_offset":0,"limit":null\}'::jsonb/);
});

test("catalog search has a ranked typo-tolerant fallback", async () => {
  const source = await readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8");
  assert.match(source, /word_similarity\(\$\{plain\}, product\.title\) >= 0\.62/);
  assert.match(source, /word_similarity\(\$\{plain\}, product\.title\) DESC/);
  assert.match(source, /query\.q\.trim\(\)\.length >= 4/);
  assert.match(source, /FROM catalog_product_read_model/);
  assert.match(source, /normalizeProductIdentity/);
});

test("public SQL catalogue keeps dated prices but never treats them as confirmed stock", async () => {
  const source = await readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8");
  assert.match(source, /where\.push\(`\$\{catalogPrice\} IS NOT NULL`\)/);
  assert.match(source, /JOIN daribar_delivery_product_mappings storefront_product_mapping[\s\S]*storefront_product_mapping\.enabled/);
  assert.match(source, /const availabilityPrice = selected \? "selected_offer\.min_price" : medusaStockPriceSql\(\)/);
  assert.equal((source.match(/where\.push\(`\$\{availabilityPrice\} IS NOT NULL`\)/g) || []).length, 1);
  assert.match(source, /if \(query\.inStock\) where\.push\(`\$\{availabilityPrice\} IS NOT NULL`\)/);
  assert.match(source, /\(\$\{availabilityPrice\} IS NOT NULL\) AS availability_confirmed/);
  assert.match(source, /product\.inStock = availabilityConfirmed/);
  assert.doesNotMatch(source, /product\.inStock = selectedPrice !== null/);
});

test("Postgres Medusa pages expose stale availability in API metadata", async () => {
  const source = await readFile(new URL("../src/lib/medusa-catalog.ts", import.meta.url), "utf8");
  assert.match(source, /const stale = page\.products\.some\(\(product\) => product\.stockStale === true\)/);
  assert.match(source, /sourceMode: "medusa_postgres", complete: true, stale,/);
  assert.doesNotMatch(source, /sourceMode: "medusa_postgres", complete: true, stale: false/);
});

test("database aggregate becomes complete-catalog brand, price and availability facets", () => {
  const { count, facets } = localCatalogFacetsFromRow({
    count: 27_975,
    brands: [
      { name: "Alpha Pharma", count: 120 },
      { name: "alpha pharma", count: 3 },
      { name: "Beta", count: 20 },
    ],
    categories: [
      { id: "cat-health", slug: "health", name: "Health", count: 12_000 },
      { id: "cat-beauty", slug: "beauty", name: "Beauty", count: 4_500 },
    ],
    min_price: "150",
    max_price: "9990",
    known_price_count: 15_595,
    in_stock_count: 15_595,
    sale_count: 200,
    rx_count: 3_046,
    otc_count: 15_322,
  });

  assert.equal(count, 27_975);
  assert.deepEqual(facets.brands.map(({ key, count: brandCount }) => [key, brandCount]), [
    ["alpha-pharma", 123],
    ["beta", 20],
  ]);
  assert.deepEqual(facets.price, { min: 150, max: 9990, unknown: 12_380 });
  assert.deepEqual(facets.availability, { inStock: 15_595, outOfStock: 0, unknown: 12_380 });
  assert.deepEqual(facets.sale, { onSale: 200, regular: 27_775 });
  assert.deepEqual(facets.prescription, { rx: 3_046, otc: 15_322 });
  assert.equal(facets.categories[0].count, 12_000);
});

test("catalog API helpers expose full facet counts and explicit response scope", () => {
  const categories = [
    { id: "cat-health", slug: "health", name: "Health", icon: "Pill", from: "#000", to: "#fff", count: 0 },
    { id: "cat-beauty", slug: "beauty", name: "Beauty", icon: "Sparkles", from: "#000", to: "#fff", count: 0 },
  ];
  const fullFacets = categoriesWithFullFacetCounts(categories, {
    categories: [
      { id: "cat-health", slug: "health", name: "Health", count: 12_000 },
      { id: "cat-beauty", slug: "beauty", name: "Beauty", count: 4_500 },
    ],
    brands: [],
    price: { min: 150, max: 9990, unknown: 12_380 },
    availability: { inStock: 15_595, outOfStock: 0, unknown: 12_380 },
    sale: { onSale: 0, regular: 27_975 },
    prescription: { rx: 0, otc: 27_975 },
  });
  const meta = postgresCatalogMeta({
    catalogTotal: 27_975,
    facetProductCount: 27_975,
    loadedCount: 24,
    generatedAt: "2026-07-22T00:00:00.000Z",
  });

  assert.deepEqual(fullFacets.categories.map(({ slug, count }) => [slug, count]), [
    ["health", 12_000],
    ["beauty", 4_500],
  ]);
  assert.deepEqual(fullFacets.facets.categories, [
    { id: "cat-health", slug: "health", name: "Health", count: 12_000 },
    { id: "cat-beauty", slug: "beauty", name: "Beauty", count: 4_500 },
  ]);
  assert.equal(meta.responseScope, "bounded_page");
  assert.equal(meta.facetScope, "filtered_catalog");
  assert.equal(meta.facetProductCount, 27_975);
  assert.equal(meta.facetCategoryScope, "top_level_with_descendants");
  assert.equal(meta.loadedCount, 24);

  const leanMeta = postgresCatalogMeta({
    catalogTotal: 27_975,
    loadedCount: 24,
    generatedAt: "2026-07-22T00:00:00.000Z",
    includeFacets: false,
  });
  assert.equal(leanMeta.facetScope, "omitted");
  assert.equal("facetProductCount" in leanMeta, false);
});

test("facet-free load-more also skips price aggregation unless a price dimension needs it", () => {
  assert.equal(catalogQueryNeedsPrice(parseCatalogQuery(new URLSearchParams("offset=24&facets=0"))), false);
  assert.equal(catalogQueryNeedsPrice(parseCatalogQuery(new URLSearchParams("offset=24&facets=0&sort=price_asc"))), true);
  assert.equal(catalogQueryNeedsPrice(parseCatalogQuery(new URLSearchParams("offset=24&facets=0&in_stock=1"))), true);
  assert.equal(catalogQueryNeedsPrice(parseCatalogQuery(new URLSearchParams())), true);
});

test("CatalogView load-more opts out while API/local reads retain the default facet path", async () => {
  const [view, route, localRead] = await Promise.all([
    readFile(new URL("../src/components/catalog/CatalogView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/catalog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8"),
  ]);

  assert.match(view, /params\.set\("facets", "0"\)/);
  assert.match(route, /query\.includeFacets \? \{ categories: page\.categories, brands: page\.brands, facets: page\.facets \} : \{\}/);
  assert.match(localRead, /if \(query\.includeFacets\) \{[\s\S]*?buildFullCatalogFacetsSql/);
  assert.match(localRead, /count\(\*\) OVER\(\)::integer AS filtered_count/);
});

test("facet indexes cover price, sale, stock and exact-brand access paths idempotently", async () => {
  const migration = await readFile(
    new URL("../db/migrations/007_catalog_facet_indexes.sql", import.meta.url),
    "utf8",
  );

  assert.equal((migration.match(/CREATE INDEX IF NOT EXISTS/g) || []).length, 4);
  assert.match(migration, /catalog_variants \(product_id, price_amount\)[\s\S]*WHERE active AND price_amount > 0/);
  assert.match(migration, /catalog_variants \(product_id\)[\s\S]*original_price_amount > price_amount/);
  assert.match(migration, /catalog_pharmacy_offers \(product_id, price_amount, pharmacy_id\)[\s\S]*WHERE in_stock AND price_amount > 0/);
  assert.match(migration, /catalog_products \(brand, id\)[\s\S]*WHERE active AND brand IS NOT NULL/);
  assert.doesNotMatch(migration, /CREATE INDEX[^;]+catalog_product_categories/);
});
