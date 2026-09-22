import assert from "node:assert/strict";
import test from "node:test";

import { basePricesForFulfillment, priceCheckoutLines } from "../src/lib/checkoutPricing.ts";

test("warehouse and pharmacy use the minimum base price while pickup uses the selected pharmacy", () => {
  const minimum = [4_955];
  const selected = [4_965];

  assert.deepEqual(basePricesForFulfillment(minimum, selected, "warehouse"), [4_955]);
  assert.deepEqual(basePricesForFulfillment(minimum, selected, "pharmacy"), [4_955]);
  assert.deepEqual(basePricesForFulfillment(minimum, selected, "pickup"), [4_965]);
  assert.equal(priceCheckoutLines([{ unitPrice: 4_955, quantity: 1 }], "pharmacy").total, 5_550);
});

test("warehouse keeps the base minimum-price subtotal", () => {
  const quote = priceCheckoutLines([
    { unitPrice: 1_005, quantity: 1 },
    { unitPrice: 250, quantity: 2 },
  ], "warehouse");

  assert.deepEqual(quote, {
    subtotal: 1_505,
    total: 1_505,
    lineTotals: [1_005, 500],
    adjustments: [],
  });
});

test("pharmacy applies 12% once to the basket subtotal with exact rounding", () => {
  const quote = priceCheckoutLines([{ unitPrice: 104, quantity: 3 }], "pharmacy");

  assert.equal(quote.subtotal, 312);
  assert.equal(quote.total, 349);
  assert.deepEqual(quote.lineTotals, [312]);
  assert.deepEqual(quote.adjustments, [
    { type: "pharmacy_markup", rateBps: 1_200, amount: 37 },
  ]);
  assert.notEqual(quote.total, Math.round(104 * 1.12) * 3);

  for (let subtotal = 1; subtotal <= 10_000; subtotal += 1) {
    assert.equal(
      priceCheckoutLines([{ unitPrice: subtotal, quantity: 1 }], "pharmacy").total,
      Math.round(subtotal * 1.12),
    );
  }
});

test("pickup uses the selected pharmacy prices without the courier markup", () => {
  const quote = priceCheckoutLines([{ unitPrice: 1_005, quantity: 1 }], "pickup");

  assert.equal(quote.subtotal, 1_005);
  assert.equal(quote.total, 1_005);
  assert.deepEqual(quote.adjustments, []);
});
