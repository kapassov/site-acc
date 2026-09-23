import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrder, isPickupCashOrder, signature, stableJson, validateFeed, validateOrigin,
} from "../scripts/lib/epharm-contract.mjs";
import { readFile } from "node:fs/promises";

const event = () => ({
  id: "77777777-7777-4777-8777-777777777777",
  payload: {
    order_id: "order-1",
    order_number: 123456,
    status_code: "submitted",
    pickup_code: "123456",
    delivery_method: "pickup",
    created_at: "2026-09-21T10:00:00Z",
    total_amount: 300,
    currency_code: "kzt",
    payment_method: "cash",
    payment_status: "pending",
    is_demo: false,
    pharmacy_external_id: "local-pharmacy",
    line_items: [{ variant_id: "v1", product_id: "p1", sku: "sku1", quantity: 2, unit_price: 150 }],
    metadata: { phone: "private-phone", delivery_address: "private-address" },
  },
});

test("explicit non-demo pickup and cash becomes cashier fulfillment without customer PII", () => {
  const order = buildOrder(event(), [{ variant_id: "v1", product_id: "p1", title: "Препарат", sku: "sku1" }], "source-8857");
  assert.equal(order.eventId, "77777777-7777-4777-8777-777777777777");
  assert.equal(order.delivery, "pickup");
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.pharmacyExternalId, "source-8857");
  assert.equal(JSON.stringify(order).includes("private"), false);
});

test("courier, online payment, missing selection and no-charge demos never enter cashier fulfillment", () => {
  for (const change of [
    { delivery_method: "courier" }, { delivery_method: "pharmacy" },
    { delivery_method: undefined }, { payment_method: undefined },
    { payment_method: "card" }, { payment_method: "kaspi" },
    { payment_method: "halyk" }, { is_demo: true },
    { payment_status: "demo_no_charge" },
  ]) {
    const candidate = event();
    Object.assign(candidate.payload, change);
    assert.equal(isPickupCashOrder(candidate.payload), false, JSON.stringify(change));
    assert.throws(() => buildOrder(candidate, [], "ch:84"), /unsupported_fulfillment_or_payment/);
  }
  assert.equal(isPickupCashOrder(event().payload), true);
});

test("outbox creation and dispatch both enforce pickup plus cash", async () => {
  const [store, worker, checkout] = await Promise.all([
    readFile(new URL("../src/lib/orders/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync-epharm-orders.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /payload\.delivery_method === "pickup" && payload\.payment_method === "cash"/);
  assert.match(worker, /s\.delivery_method = 'pickup' AND s\.metadata->>'payment' = 'cash'/);
  assert.match(worker, /status='skipped'/);
  assert.match(checkout, /typeof body\.payment === "string" \? body\.payment : ""/);
});

test("signature is bound to method, path and exact stable body", () => {
  const body = stableJson({ z: [{ b: 1, a: 2 }], a: 1 });
  assert.equal(body, stableJson({ a: 1, z: [{ a: 2, b: 1 }] }));
  assert.notEqual(signature("test", "1", "POST", "/a", body), signature("test", "1", "POST", "/b", body));
});

test("only HTTPS origins and monotonic update feeds are accepted", () => {
  assert.equal(validateOrigin("https://epharm.example/"), "https://epharm.example");
  assert.throws(() => validateOrigin("http://epharm.example"));
  assert.throws(() => validateOrigin("https://user:password@epharm.example"));
  assert.throws(() => validateFeed({ updates: [], nextCursor: 11, hasMore: false }, 10));
  const feed = validateFeed({
    updates: [{ cursor: 11, version: 2, status: "ready", orderId: "order-1" }],
    nextCursor: 11,
    hasMore: false,
  }, 10);
  assert.equal(feed.nextCursor, 11);
});
