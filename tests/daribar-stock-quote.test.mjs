import assert from "node:assert/strict";
import test from "node:test";
import { buildDaribarStockQuote } from "../src/lib/daribar/stock-quote-builder.ts";
import { daribarProductId, daribarVariantId } from "../src/lib/daribar/ids.ts";

const pharmacy = {
  id: "sloc_01TESTPHARMACY",
  sourceCode: "ass-001",
  name: "Аптека АСС",
  city: "Алматы",
  address: "Абая 1",
};
const mappings = [
  {
    productId: "prod_01TESTPRODUCTA",
    variantId: "variant_01TESTVARIANTA",
    quantity: 2,
    sku: "SKU-1",
    wareId: "11111111-1111-4111-8111-111111111111",
    unitPrice: 1000,
  },
  {
    productId: "prod_01TESTPRODUCTB",
    variantId: "variant_01TESTVARIANTB",
    quantity: 1,
    sku: "SKU-2",
    wareId: "22222222-2222-4222-8222-222222222222",
    unitPrice: 700,
  },
];

function row(products) {
  return {
    sourceCode: "ass-001",
    pharmacy: { id: "ass-001", name: "Аптека АСС", city: "Алматы", address: "Абая 1" },
    products,
    distance: 1,
  };
}

test("Daribar stock quote combines live quantities with Medusa prices for the whole cart", () => {
  const now = Date.UTC(2026, 8, 20, 10, 0, 0);
  const quote = buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", wareId: "unused", name: "A", quantity: 2, quantityDesired: 2, price: 1200, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", wareId: "unused", name: "B", quantity: 3, quantityDesired: 1, price: 850, analogs: [] },
  ]), pharmacy, mappings, now);

  assert.ok(quote);
  assert.equal(quote.subtotal, 2700);
  assert.equal(quote.total, 2700);
  assert.equal(quote.lines.length, 2);
  assert.deepEqual(quote.lines.map(({ unitPrice, availableQuantity, total }) => ({ unitPrice, availableQuantity, total })), [
    { unitPrice: 1000, availableQuantity: 2, total: 2000 },
    { unitPrice: 700, availableQuantity: 3, total: 700 },
  ]);
  assert.equal(quote.pharmacy.id, pharmacy.id);
  assert.match(quote.snapshotId, /^daribar-v3-[0-9a-f]{64}$/);
  assert.equal(quote.expiresAt, new Date(now + 180_000).toISOString());
});

test("Daribar stock quote rejects partial, insufficient or missing Medusa-price baskets", () => {
  assert.equal(buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", wareId: "unused", name: "A", quantity: 2, quantityDesired: 2, price: 1200, analogs: [] },
  ]), pharmacy, mappings), null);
  assert.equal(buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", wareId: "unused", name: "A", quantity: 1, quantityDesired: 2, price: 1200, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", wareId: "unused", name: "B", quantity: 1, quantityDesired: 1, price: 850, analogs: [] },
  ]), pharmacy, mappings), null);
  const zeroDaribarPrice = buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", wareId: "unused", name: "A", quantity: 2, quantityDesired: 2, price: 0, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", wareId: "unused", name: "B", quantity: 1, quantityDesired: 1, price: 0, analogs: [] },
  ]), pharmacy, mappings);
  assert.equal(zeroDaribarPrice?.subtotal, 2700);
  const missingMedusaPrice = mappings.map((mapping, index) => index === 1 ? { ...mapping, unitPrice: 0 } : mapping);
  assert.equal(buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", wareId: "unused", name: "A", quantity: 2, quantityDesired: 2, price: 1200, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", wareId: "unused", name: "B", quantity: 1, quantityDesired: 1, price: 0, analogs: [] },
  ]), pharmacy, missingMedusaPrice), null);
});

test("native Daribar cart is quoted using current Daribar pharmacy prices, not its catalogue minimum", () => {
  const native = mappings.map((mapping, index) => ({
    ...mapping,
    productId: daribarProductId(mapping.sku),
    variantId: daribarVariantId(mapping.sku),
    unitPrice: index === 0 ? 900 : 600,
  }));
  const quote = buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", name: "A", quantity: 2, quantityDesired: 2, basePrice: 1300, price: 1200, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", name: "B", quantity: 3, quantityDesired: 1, basePrice: 950, price: 850, analogs: [] },
  ]), pharmacy, native);
  assert.ok(quote);
  assert.equal(quote.total, 3250);
  assert.deepEqual(quote.lines.map((line) => line.unitPrice), [1200, 850]);
  assert.equal(buildDaribarStockQuote(row([
    { sourceCode: "ass-001", sku: "SKU-1", name: "A", quantity: 2, quantityDesired: 2, price: 1200, analogs: [] },
    { sourceCode: "ass-001", sku: "SKU-2", name: "B", quantity: 3, quantityDesired: 1, price: 0, analogs: [] },
  ]), pharmacy, native), null);
});
