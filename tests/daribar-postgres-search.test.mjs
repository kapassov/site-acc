import assert from "node:assert/strict";
import test from "node:test";
import { searchDaribarPostgresProducts } from "../src/lib/daribar/postgres-search.ts";

function product(sku, name, mnn = "") {
  return {
    id: `prod_${sku}`, variantId: `variant_${sku}`, sku, slug: sku.toLowerCase(),
    source: "daribar", name, mnn, brand: "Test", categorySlug: "lekarstva",
    price: 1000, rating: 0, reviews: 0, badges: [], art: { icon: "pill", from: "#fff", to: "#eee" },
    inStock: true, stockPharmacies: 1,
  };
}

const products = [
  product("ASP", "Аспирин таблетки 500 мг №20", "Ацетилсалициловая кислота"),
  product("TIR", "Тирзетта раствор 5 мг", "Тирзепатид"),
  product("CREON", "Креон капсулы 10000 ЕД №20", "Панкреатин"),
  product("PAN", "Панкреатин таблетки 25 ЕД №60", "Панкреатин"),
  product("DIC", "Диклофенак раствор для инъекций 25 мг/мл ампулы №5", "Диклофенак"),
  product("SYR", "Шприц одноразовый 5 мл №10", ""),
  product("WIPE", "Салфетки спиртовые №10", ""),
];

test("PostgreSQL search fixes a one-letter medicine typo without an external service", () => {
  const result = searchDaribarPostgresProducts({ query: "оспирин", products });
  assert.deepEqual(result.products.map((value) => value.sku), ["ASP"]);
  assert.equal(result.search.matchType, "typo");
  assert.equal(result.search.degraded, false);
});

test("PostgreSQL search supports an exact last-word prefix", () => {
  const result = searchDaribarPostgresProducts({ query: "тирз", products });
  assert.deepEqual(result.products.map((value) => value.sku), ["TIR"]);
  assert.equal(result.search.matchType, "exact");
});

test("PostgreSQL search includes brands found by active ingredient/MNN", () => {
  const result = searchDaribarPostgresProducts({ query: "панкреатин", products });
  assert.deepEqual(new Set(result.products.map((value) => value.sku)), new Set(["PAN", "CREON"]));
  assert.equal(result.products[0].sku, "PAN");
});

test("PostgreSQL search preserves dose constraints for name and MNN matches", () => {
  assert.deepEqual(searchDaribarPostgresProducts({ query: "аспирин 500 мг", products }).products.map((value) => value.sku), ["ASP"]);
  assert.deepEqual(searchDaribarPostgresProducts({ query: "панкреатин 500 мг", products }).products, []);
});

test("test-purchase wording finds diclofenac ampoules, ten syringes and ten alcohol wipes", () => {
  assert.deepEqual(searchDaribarPostgresProducts({ query: "деклофенак ампулы", products }).products.map((value) => value.sku), ["DIC"]);
  assert.deepEqual(searchDaribarPostgresProducts({ query: "шприцы 10шт", products }).products.map((value) => value.sku), ["SYR"]);
  assert.deepEqual(searchDaribarPostgresProducts({ query: "спритовые салфетки 10шт", products }).products.map((value) => value.sku), ["WIPE"]);
});

test("large PostgreSQL snapshots reuse one normalized search index", () => {
  const large = Array.from({ length: 29_303 }, (_, index) => (
    index === 19_777 ? product("TARGET", "Аспирин таблетки 500 мг №20", "Ацетилсалициловая кислота")
      : product(`SKU${index}`, `Тестовый товар ${index} капсулы №20`, "")
  ));
  const started = performance.now();
  assert.deepEqual(searchDaribarPostgresProducts({ query: "оспирин", products: large }).products.map((value) => value.sku), ["TARGET"]);
  const first = performance.now() - started;
  const repeated = performance.now();
  assert.deepEqual(searchDaribarPostgresProducts({ query: "аспирин 500 мг", products: large }).products.map((value) => value.sku), ["TARGET"]);
  assert.ok(performance.now() - repeated < first, "second search should reuse the normalized index");
});
