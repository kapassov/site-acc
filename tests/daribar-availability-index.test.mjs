import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDaribarAvailability } from "../src/lib/daribar/availability-index.ts";
import { applyDaribarIndexedAvailability } from "../src/lib/daribar/catalog-db.ts";

const product = {
  id: "prod_1", variantId: "variant_1", sku: "SKU-1", slug: "sku-1", source: "daribar",
  name: "Товар", brand: "Test", categorySlug: "lekarstva", price: 900,
  rating: 0, reviews: 0, badges: [], art: { icon: "pill", from: "#fff", to: "#eee" },
  inStock: false, stockPharmacies: 0,
};

test("background availability keeps exact SKUs only from mapped reservable pharmacies", () => {
  const checkedAt = "2026-09-30T05:00:00.000Z";
  const result = aggregateDaribarAvailability(["SKU-1", "SKU-2"], [
    { sourceCode: "mapped", withReserve: true, paymentByCard: true, products: [
      { sku: "SKU-1", quantity: 4, price: 1200 },
      { sku: "ANALOG", quantity: 9, price: 100 },
    ] },
    { sourceCode: "outside", withReserve: true, paymentByCard: true, products: [
      { sku: "SKU-1", quantity: 10, price: 500 },
    ] },
  ], new Set(["mapped"]), checkedAt);
  assert.deepEqual(result.products, [
    { sku: "SKU-1", inStock: true, minPrice: 1200, pharmacyCount: 1, totalQuantity: 4, checkedAt },
    { sku: "SKU-2", inStock: false, minPrice: null, pharmacyCount: 0, totalQuantity: 0, checkedAt },
  ]);
  assert.equal(result.offers.length, 1);
});

test("catalogue cards use PostgreSQL indexed price, stock and validity", () => {
  const value = applyDaribarIndexedAvailability(product, {
    availability_in_stock: true,
    availability_min_price: "1250.00",
    availability_pharmacy_count: 3,
    availability_checked_at: "2026-09-30T05:00:00.000Z",
  }, "2026-09-30T07:00:00.000Z", Date.parse("2026-09-30T06:00:00.000Z"));
  assert.equal(value.price, 1250);
  assert.equal(value.inStock, true);
  assert.equal(value.stockPharmacies, 3);
  assert.equal(value.stockStale, false);
});

test("missing availability fails closed while preserving the catalogue card", () => {
  const value = applyDaribarIndexedAvailability(product, {
    availability_in_stock: null, availability_min_price: null,
    availability_pharmacy_count: null, availability_checked_at: null,
  });
  assert.equal(value.inStock, false);
  assert.equal(value.stockPharmacies, 0);
  assert.equal(value.stockStale, true);
});
