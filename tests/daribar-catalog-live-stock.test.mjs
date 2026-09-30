import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDaribarLiveCatalogStock,
  hydrateDaribarCatalogPageStock,
} from "../src/lib/daribar/catalog-live-stock.ts";
import { daribarProductId, daribarVariantId } from "../src/lib/daribar/ids.ts";
import { daribarUuid } from "./daribar-uuid-fixture.mjs";

const SKU_1 = daribarUuid("SKU-1");
const SKU_2 = daribarUuid("SKU-2");

function product(sku, price = 999) {
  return {
    id: daribarProductId(sku), source: "daribar", sku, slug: sku.toLowerCase(), name: sku,
    brand: "Brand", categorySlug: "drugoe", price, rating: 0, reviews: 0,
    badges: [], art: { kind: "box", hue: 1 }, inStock: true, stockPharmacies: 1,
    variantId: daribarVariantId(sku), variants: [{ id: daribarVariantId(sku), title: sku, sku, price }],
  };
}

test("catalog cards use only exact live stock from mapped ASS pharmacies", () => {
  const mapped = new Map([["ass-1", {
    id: "sloc_A1", sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A",
  }]]);
  const live = [
    { sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A", products: [
      { sourceCode: "ass-1", sku: SKU_1, name: "One", basePrice: 1300, price: 1200,
        quantity: 4, quantityDesired: 1, analogs: [] },
    ] },
    { sourceCode: "outside", name: "Other", city: "Алматы", address: "B", products: [
      { sourceCode: "outside", sku: SKU_2, name: "Two", basePrice: 100, price: 100,
        quantity: 8, quantityDesired: 1, analogs: [] },
    ] },
  ];
  const result = applyDaribarLiveCatalogStock([product(SKU_1), product(SKU_2)], live, mapped,
    "2026-09-26T12:00:00.000Z");
  assert.equal(result[0].inStock, true);
  assert.equal(result[0].price, 1200);
  assert.equal(result[0].stockPharmacies, 1);
  assert.equal(result[0].variants[0].price, 1200);
  assert.equal(result[1].inStock, false);
  assert.equal(result[1].stockPharmacies, 0);
  assert.equal(result[1].stockStale, false);
});

test("catalog stock ignores zero quantity, zero price and non-reservable pharmacies", () => {
  const mapped = new Map([["ass-1", {
    id: "sloc_A1", sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A",
  }]]);
  const exact = (quantity, price) => ({ sourceCode: "ass-1", sku: SKU_1, name: "One",
    basePrice: price, price, quantity, quantityDesired: 1, analogs: [] });
  for (const live of [
    [{ sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A", products: [exact(0, 100)] }],
    [{ sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A", products: [exact(1, 0)] }],
    [{ sourceCode: "ass-1", name: "ASS", city: "Алматы", address: "A", withReserve: false, products: [exact(1, 100)] }],
  ]) {
    assert.equal(applyDaribarLiveCatalogStock([product(SKU_1)], live, mapped)[0].inStock, false);
  }
});

test("offline catalogue projection is explicitly non-authoritative", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await hydrateDaribarCatalogPageStock([product(SKU_1)], "Алматы");
    assert.equal(result.complete, true);
    assert.equal(result.authoritative, false);
    assert.equal(result.products.length, 1);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
