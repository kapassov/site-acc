import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrder, signature, stableJson, validateFeed, validateOrigin,
} from "../scripts/lib/epharm-contract.mjs";

const event = () => ({
  id: "77777777-7777-4777-8777-777777777777",
  payload: {
    order_id: "order-1",
    order_number: 123456,
    status_code: "submitted",
    pickup_code: "123456",
    delivery_method: "courier",
    created_at: "2026-09-21T10:00:00Z",
    total_amount: 300,
    currency_code: "kzt",
    payment_method: "card",
    payment_status: "pending",
    is_demo: false,
    pharmacy_external_id: "local-pharmacy",
    line_items: [{ variant_id: "v1", product_id: "p1", sku: "sku1", quantity: 2, unit_price: 150 }],
    metadata: { phone: "private-phone", delivery_address: "private-address" },
  },
});

test("Daribar courier order becomes pharmacy fulfillment without customer PII", () => {
  const order = buildOrder(event(), [{ variant_id: "v1", product_id: "p1", title: "Препарат", sku: "sku1" }], "source-8857");
  assert.equal(order.eventId, "77777777-7777-4777-8777-777777777777");
  assert.equal(order.delivery, "pharmacy");
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.pharmacyExternalId, "source-8857");
  assert.equal(JSON.stringify(order).includes("private"), false);
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
