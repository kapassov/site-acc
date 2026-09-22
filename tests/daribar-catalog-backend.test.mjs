import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCatalogQuery } from "../src/lib/catalog-query.ts";
import {
  daribarCategoryIds,
  dedupeDaribarProducts,
  mapDaribarProduct,
  projectDaribarCatalog,
} from "../src/lib/daribar/catalog-data.ts";
import { collectDaribarPages, DaribarCatalogError } from "../src/lib/daribar/catalog.ts";

function raw(sku, overrides = {}) {
  return {
    sku,
    name: `Товар ${sku}`,
    manufacturer: "Alpha Pharma",
    categories_ids: ["9", "145", "2"],
    min_customer_price: 1_000,
    quantity: 5,
    in_stock: true,
    recipe_needed: "0",
    ...overrides,
  };
}

test("built-in Daribar taxonomy covers public and hidden category handles", () => {
  assert.deepEqual(daribarCategoryIds("lekarstva-i-bady"), ["9"]);
  assert.deepEqual(daribarCategoryIds("mama-i-malysh"), ["22"]);
  assert.deepEqual(daribarCategoryIds("sport-i-fitnes"), ["18", "203"]);
  assert.deepEqual(daribarCategoryIds("zagar-i-zashita-ot-solnca"), ["92"]);
  assert.deepEqual(daribarCategoryIds("not-mapped"), []);
});

test("Daribar product mapping keeps supplier identity, price, image and canonical categories", () => {
  const product = mapDaribarProduct(raw("SKU-ONE", {
    name: "Avene Sun SPF50 крем",
    manufacturer: "Pierre Fabre",
    categories_ids: ["92", "5", "145", "2"],
    min_customer_price: 7_250,
  }));
  assert.ok(product);
  assert.equal(product.source, "daribar");
  assert.equal(product.sku, "SKU-ONE");
  assert.equal(product.price, 7_250);
  assert.equal(product.categorySlug, "zagar-i-zashita-ot-solnca");
  assert.ok(product.categoryHandles.includes("kosmetika"));
  assert.equal(product.image, "/api/media/daribar?sku=SKU-ONE");
  assert.match(product.id, /^prod_Daribar/);
  assert.match(product.variantId, /^variant_Daribar/);
});

test("Peptide Bio uses one Cyrillic display name and one stable legacy filter key", () => {
  const product = mapDaribarProduct(raw("PEPTIDE", { manufacturer: "ТД Пептид Био" }));
  assert.equal(product?.brand, "Пептид Био");
  const query = parseCatalogQuery(new URLSearchParams("brand=peptid-bio&limit=24"));
  assert.deepEqual(projectDaribarCatalog([product].filter(Boolean), query).products.map((item) => item.sku), ["PEPTIDE"]);
});

test("stable Daribar dedupe keeps the first authoritative occurrence of each SKU", () => {
  const first = mapDaribarProduct(raw("SKU-A", { min_customer_price: 500 }));
  const duplicate = mapDaribarProduct(raw("SKU-A", { min_customer_price: 900 }));
  const second = mapDaribarProduct(raw("SKU-B"));
  const deduped = dedupeDaribarProducts([first, duplicate, second].filter(Boolean));
  assert.deepEqual(deduped.map((product) => product.sku), ["SKU-A", "SKU-B"]);
  assert.equal(deduped[0].price, 500);
});

test("global filters, facets and sorting are applied before Daribar pagination", () => {
  const products = [
    mapDaribarProduct(raw("A", { manufacturer: "Alpha Pharma", min_customer_price: 900, categories_ids: ["7"] })),
    mapDaribarProduct(raw("B", { manufacturer: "Beta Labs", min_customer_price: 1_200, categories_ids: ["7"], recipe_needed: "1" })),
    mapDaribarProduct(raw("C", { manufacturer: "Alpha Pharma", min_customer_price: 1_100, categories_ids: ["7"] })),
    mapDaribarProduct(raw("D", { manufacturer: "Alpha Pharma", min_customer_price: 800, categories_ids: ["9"] })),
  ].filter(Boolean);
  const query = parseCatalogQuery(new URLSearchParams(
    "category=bady&brand=alpha-pharma&minPrice=850&maxPrice=1200&prescription=otc&sort=price_desc&limit=1&offset=1",
  ));
  const page = projectDaribarCatalog(products, query);
  assert.deepEqual(page.matched.map((product) => product.sku), ["C", "A"]);
  assert.deepEqual(page.products.map((product) => product.sku), ["A"]);
  assert.equal(page.facets.price.min, 900);
  assert.equal(page.facets.price.max, 1_100);
  assert.equal(page.facets.categories.find((category) => category.slug === "bady")?.count, 2);
  assert.deepEqual(page.brands.map((brand) => brand.name), ["Alpha Pharma"]);
});

test("browse prioritizes orderable OTC but an already-ranked search keeps medical relevance", () => {
  const exactRx = mapDaribarProduct(raw("EXACT-RX", { name: "Нурофен", recipe_needed: "1" }));
  const similarOtc = mapDaribarProduct(raw("SIMILAR-OTC", { name: "Нурофен Форте", recipe_needed: "0" }));
  const products = [exactRx, similarOtc].filter(Boolean);

  const browse = projectDaribarCatalog(products, parseCatalogQuery(new URLSearchParams("limit=24")));
  assert.deepEqual(browse.products.map((product) => product.sku), ["SIMILAR-OTC", "EXACT-RX"]);

  const rankedSearch = projectDaribarCatalog(
    products,
    parseCatalogQuery(new URLSearchParams("q=%D0%BD%D1%83%D1%80%D0%BE%D1%84%D0%B5%D0%BD&limit=24")),
    true,
  );
  assert.deepEqual(rankedSearch.products.map((product) => product.sku), ["EXACT-RX", "SIMILAR-OTC"]);
});

test("page collector continues through short/overlapping pages and stops only at authority completion", async () => {
  const calls = [];
  const result = await collectDaribarPages(async (page, limit) => {
    calls.push([page, limit]);
    if (page === 1) return { products: [raw("A"), raw("B")], total_count: 0, total_pages: 0, current_page: 1 };
    if (page === 2) return { products: [raw("B"), raw("C")], total_count: 0, total_pages: 0, current_page: 2 };
    return { products: [], total_count: 0, total_pages: 0, current_page: page };
  }, 5);
  assert.deepEqual(calls, [[1, 500], [2, 500], [3, 500]]);
  assert.equal(result.rawCount, 4);
  assert.equal(result.pages, 2);
  assert.deepEqual(dedupeDaribarProducts(result.rawProducts.map(mapDaribarProduct).filter(Boolean)).map((product) => product.sku), ["A", "B", "C"]);
});

test("page collector fails closed on a stalled or truncated provider", async () => {
  await assert.rejects(
    collectDaribarPages(async () => ({ products: [raw("SAME")], total_pages: 0 }), 3),
    (error) => error instanceof DaribarCatalogError && error.code === "daribar_catalog_pagination_stalled",
  );
  let sequence = 0;
  await assert.rejects(
    collectDaribarPages(async () => ({ products: [raw(`SKU-${sequence++}`)], total_pages: 0 }), 2),
    (error) => error instanceof DaribarCatalogError && error.code === "daribar_catalog_snapshot_incomplete",
  );
});

test("legacy Daribar snapshots remain isolated from the public Medusa catalog", async () => {
  const route = await readFile(new URL("../src/app/api/catalog/route.ts", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../src/lib/daribar/catalog.ts", import.meta.url), "utf8");
  assert.match(route, /getMedusaCatalogPage/);
  assert.match(route, /full_filtered_medusa_catalog/);
  assert.match(route, /coverage: "full_catalog"/);
  assert.doesNotMatch(route, /getDaribar|daribar\/catalog/);
  assert.match(catalog, /daribar_snapshot_file_missing/);
  assert.match(catalog, /daribar_snapshot_expired/);
  assert.match(catalog, /\/api\/v1\/search\/category\/all/);
  assert.match(catalog, /"priced_subset"/);
  assert.doesNotMatch(route, /getCatalogReadPage|getMedusaCatalogSnapshot|getRemoteCatalogPayload|postgresCatalogMeta/);
});
