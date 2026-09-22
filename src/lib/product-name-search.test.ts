import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductName, productNameSearchScore, searchProductsByName, typoDistance } from "./product-name-search.ts";
import type { Product } from "./types.ts";

test("title search normalizes Russian text and punctuation", () => {
  assert.equal(normalizeProductName("Ёжик-Форте, капс. №30"), "ежик форте капс 30");
});

test("title search accepts common single-letter errors and transpositions", () => {
  assert.notEqual(productNameSearchScore("Везилют Пептид Био капс. №30", "Везилюд"), null);
  assert.notEqual(productNameSearchScore("Панкраген Пептид Био", "Панкрагин"), null);
  assert.notEqual(productNameSearchScore("Панкраген Пептид Био", "Панкроген"), null);
  assert.notEqual(productNameSearchScore("Нормофтал Пептид Био", "Нормафтал"), null);
  assert.equal(typoDistance("аспирин", "асприиин"), 2);
});

test("title search keeps every matching product variation", () => {
  const base: Omit<Product, "id" | "slug" | "name"> = {
    brand: "Пептид Био", categorySlug: "bady", price: 1, rating: 0, reviews: 0,
    badges: [], art: { kind: "box", hue: 120 }, inStock: true, stockPharmacies: 1,
  };
  const products: Product[] = [
    { ...base, id: "one", slug: "one", name: "Панкраген Пептид Био капс. 200 мг №60" },
    { ...base, id: "two", slug: "two", name: "Панкраген Пептид Био капс. 200 мг №30" },
  ];
  assert.deepEqual(searchProductsByName(products, "панкроген", 10).map((product) => product.id).sort(), ["one", "two"]);
});

test("title search treats joined and spaced Peptide Bio names as identical", () => {
  assert.notEqual(
    productNameSearchScore("Кардиоген Пептид Био капс. 200мг №30", "Крадиоген ПептидБио капс. 200мг №30"),
    null,
  );
  assert.equal(normalizeProductName("Peptide Bio"), normalizeProductName("PeptideBio"));
});

test("title-only search does not match unrelated metadata", () => {
  assert.equal(productNameSearchScore("Крем увлажняющий", "Пептид Био"), null);
});
