import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { atomicWriteSnapshot, buildSnapshotDocument } from "../scripts/sync-daribar-catalog.mjs";
import { parseCatalogQuery } from "../src/lib/catalog-query.ts";
import { getDaribarCatalogPage, searchDaribarProductsWithMetadata } from "../src/lib/daribar/catalog.ts";

const raw = (sku, name, extra = {}) => ({
  sku, name, min_customer_price: 100, quantity: 2,
  manufacturer: "Test Pharma", categories_ids: ["9", "145"], recipe_needed: "0", ...extra,
});
const names = [
  raw("PARA-200", "Парацетамол 200 мг таблетки №10"),
  raw("PARA-500", "Парацетамол 500 мг таблетки №10"),
  raw("PARA-CAPS", "Парацетамол 200 мг капсулы №10"),
  raw("IBU-200", "Ибупрофен 200 мг таблетки №10"),
];
const clearRuntime = () => {
  for (const key of ["__daribarSnapshots", "__daribarSnapshotInflight", "__daribarProductCache", "__daribarSnapshotFiles"]) {
    globalThis[key]?.clear();
  }
};

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "inkar-search-fallback-test-"));
  const path = join(directory, "snapshot.json");
  const sourceProducts = options.sourceProducts || names;
  const liveProducts = options.liveProducts || names.map(item => ({ ...item, min_customer_price: 987, quantity: 7 }));
  if (!options.missingSnapshot) {
    atomicWriteSnapshot(path, buildSnapshotDocument({
      products: sourceProducts, totalCount: sourceProducts.length, totalPages: 1, pagesFetched: 1,
      rawCount: sourceProducts.length, duplicateCount: 0, invalidSkuCount: 0,
    }, { city: "Алматы", pageSize: 500, generatedAt: new Date(Date.now() - 1000).toISOString() }));
  }
  const settings = {
    DARIBAR_ENABLED: "true", DARIBAR_CATALOG_ENABLED: "true",
    DARIBAR_API_URL: "https://backoffice.daribar.com", DARIBAR_DEFAULT_CITY: "Алматы",
    DARIBAR_CATALOG_SNAPSHOT_PATH: path, DARIBAR_CATALOG_SNAPSHOT_FRESH_SECONDS: "5400",
    DARIBAR_CATALOG_SNAPSHOT_MAX_AGE_SECONDS: "86400",
    TYPESENSE_URL: "http://127.0.0.1:8108", TYPESENSE_SEARCH_API_KEY: "test-search-only-key",
    TYPESENSE_COLLECTION: "test-daribar-products", TYPESENSE_TIMEOUT_MS: "100",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  clearRuntime();
  const calls = [];
  const unexpected = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "http://127.0.0.1:8108") {
      calls.push({ engine: "typesense", path: url.pathname });
      return Response.json({ message: "Service Unavailable" }, { status: 503 });
    }
    if (url.origin === "https://backoffice.daribar.com" && url.pathname === "/api/v1/search/keyword") {
      const body = JSON.parse(init.body);
      calls.push({ engine: "daribar", ...body });
      const products = body.keyword === "парацетамол" ? liveProducts : options.originalProducts || [];
      return Response.json({ products, total_count: products.length, total_pages: products.length ? 1 : 0, current_page: 1 });
    }
    unexpected.push({ origin: url.origin, path: url.pathname });
    throw new Error("Unexpected network request in isolated fallback fixture");
  });
  t.after(async () => {
    clearRuntime();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes("inkar-search-fallback-test-"));
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual(unexpected, []);
  });
  return { calls, keywords: () => calls.filter(call => call.engine === "daribar").map(call => call.keyword) };
}

test("unavailable Typesense and empty misspelled keyword recover through source-canonical Daribar lookup", async t => {
  const state = await fixture(t);
  const result = await searchDaribarProductsWithMetadata("пороцетомол", 48, "Алматы");
  assert.deepEqual(result.products.map(item => item.sku), ["PARA-200", "PARA-500", "PARA-CAPS"]);
  assert.ok(result.products.every(item => item.source === "daribar" && item.price === 987));
  assert.equal(result.engine, "daribar");
  assert.equal(result.stale, false);
  assert.deepEqual(result.search, { query: "пороцетомол", matchedQuery: "Парацетамол", matchType: "typo", degraded: true });
  assert.ok(state.calls.some(call => call.engine === "typesense"));
  assert.deepEqual(state.keywords(), ["пороцетомол", "парацетамол"]);
  assert.ok(state.calls.filter(call => call.engine === "daribar").every(call => call.city === "almaty"));

  const page = await getDaribarCatalogPage(parseCatalogQuery(new URLSearchParams({ q: "пороцетомол", limit: "1" })), "Алматы");
  assert.equal(page.count, 3);
  assert.equal(page.products.length, 1);
  assert.equal(page.totalPages, 3);
  assert.equal(page.hasMore, true);
  assert.equal(page.complete, true);
  assert.deepEqual(page.search, result.search);
  assert.equal(page.searchEngine, "daribar");
});

test("native retry keeps original dose, unit, form and package despite broad canonical response", async t => {
  const state = await fixture(t);
  const result = await searchDaribarProductsWithMetadata("пороцетомол 200 мг таблетки №10", 48, "Алматы");
  assert.deepEqual(result.products.map(item => item.sku), ["PARA-200"]);
  assert.equal(result.search.query, "пороцетомол 200 мг таблетки №10");
  assert.equal(result.search.matchType, "typo");
  assert.equal(result.search.matchedQuery, null, "feedback must not drop the entered numeric/form constraints");
  assert.equal(result.search.degraded, true);
  for (const query of ["пороцетомол 5000 мг", "пороцетомол 200 мл", "пороцетомол мазь", "пороцетомол №30"]) {
    const empty = await searchDaribarProductsWithMetadata(query, 48, "Алматы");
    assert.deepEqual(empty.products, [], query);
    assert.equal(empty.search.matchType, "none");
    assert.equal(empty.search.matchedQuery, null);
  }
  assert.ok(state.keywords().includes("парацетамол"));
});

test("native retry is disabled in explicit literal mode", async t => {
  const state = await fixture(t);
  const result = await searchDaribarProductsWithMetadata("пороцетомол", 48, "Алматы", { exact: true });
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchType, "none");
  assert.deepEqual(state.keywords(), ["пороцетомол"]);
});

test("native retry never picks an ambiguous source name by requested dose or availability", async t => {
  const state = await fixture(t, {
    sourceProducts: [...names, raw("ALTERNATIVE", "Парацитомол 100 мг таблетки №10", { quantity: 0, min_customer_price: 0 })],
  });
  const result = await searchDaribarProductsWithMetadata("пороцетомол 500 мг", 48, "Алматы");
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchedQuery, null);
  assert.deepEqual(state.keywords(), ["пороцетомол 500 мг"]);
});

test("native retry requires a validated complete snapshot rather than inventing names", async t => {
  const state = await fixture(t, { missingSnapshot: true });
  const result = await searchDaribarProductsWithMetadata("пороцетомол", 48, "Алматы");
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchType, "none");
  assert.equal(result.search.degraded, true);
  assert.deepEqual(state.keywords(), ["пороцетомол"]);
});

test("an existing literal native name remains authoritative instead of invoking a corrected spelling", async t => {
  const literal = raw("LITERAL", "Пороцетомол 200 мг таблетки №10");
  const state = await fixture(t, { sourceProducts: [...names, literal], originalProducts: [literal] });
  const result = await searchDaribarProductsWithMetadata("пороцетомол", 48, "Алматы");
  assert.deepEqual(result.products.map(item => item.sku), ["LITERAL"]);
  assert.equal(result.search.matchType, "exact");
  assert.equal(result.search.matchedQuery, null);
  assert.deepEqual(state.keywords(), ["пороцетомол"]);
});
