import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prescriptionCheckoutAllowed } from "../src/lib/checkout/prescription-policy.ts";
import { readDaribarCatalogPrescriptionFlags } from "../src/lib/daribar/catalog-db.ts";

test("prescription baskets require pickup and cash, including mixed baskets", () => {
  for (const fulfillment of ["pickup", "pharmacy"]) {
    for (const payment of ["cash", "card"]) {
      assert.equal(prescriptionCheckoutAllowed(false, fulfillment, payment), true);
      assert.equal(prescriptionCheckoutAllowed(true, fulfillment, payment), fulfillment === "pickup" && payment === "cash");
    }
  }
});

test("server reads prescription flags only from the active published catalogue", async () => {
  let query = "", params;
  const database = { query: async (sql, values) => {
    query = sql; params = values;
    return { rows: [{ sku: "RX-1", prescription: true }, { sku: "OTC-1", prescription: false }] };
  } };
  const flags = await readDaribarCatalogPrescriptionFlags(["RX-1", "OTC-1"], database);
  assert.deepEqual([...flags], [["RX-1", true], ["OTC-1", false]]);
  assert.deepEqual(params, [["RX-1", "OTC-1"]]);
  assert.match(query, /state\.active_run_id/);
  assert.match(query, /run\.status = 'published'/);
});

test("quote and order routes independently enforce the prescription restriction", async () => {
  for (const path of ["../src/app/api/checkout/quote/route.ts", "../src/app/api/checkout/route.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /checkoutHasPrescription\(items\)/);
    assert.match(source, /prescriptionCheckoutAllowed/);
    assert.match(source, /prescription_pickup_cash_only/);
  }
  const checkout = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(checkout, /selectedItems\.some\(\(item\) => item\.product\.prescription\)/);
  assert.match(checkout, /hasPrescription \? "pickup" : selectedDelivery/);
  assert.match(checkout, /hasPrescription \? "cash" : selectedPayment/);
  const cart = await readFile(new URL("../src/app/cart/page.tsx", import.meta.url), "utf8");
  assert.match(cart, /hasPrescription \? "pickup" : selectedFulfillment/);
  assert.match(cart, /!hasPrescription && <FulfillmentCard/);
});
