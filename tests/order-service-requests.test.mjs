import assert from "node:assert/strict";
import test from "node:test";
import { availableServiceActions, CANCELLATION_WINDOW_MS, storedServiceRequest } from "../src/lib/orders/service-request.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const order = (age = 60_000, metadata = {}) => ({
  sourceSystem: "daribar", createdAt: new Date(NOW - age).toISOString(), metadata,
});
const snapshot = (status = "created", paid = false) => ({ status, paid });

test("recent provider-confirmed orders allow only a cancellation request", () => {
  assert.deepEqual(availableServiceActions(order(), snapshot(), null, NOW), { canCancel: true, canReturn: false });
  assert.equal(availableServiceActions(order(CANCELLATION_WINDOW_MS + 1), snapshot(), null, NOW).canCancel, false);
  assert.equal(availableServiceActions(order(), undefined, null, NOW).canCancel, false);
  assert.equal(availableServiceActions(order(), snapshot("in_the_way"), null, NOW).canCancel, false);
  assert.equal(availableServiceActions(order(), snapshot("assembling"), null, NOW).canCancel, false);
  assert.equal(availableServiceActions(order(), snapshot("accepted"), null, NOW).canCancel, false,
    "accepted/processing does not prove the pharmacy has not started assembly");
  assert.equal(availableServiceActions(order(), snapshot("completed"), null, NOW).canCancel, false);
  assert.equal(availableServiceActions({ ...order(), status: "cancelled" }, snapshot(), null, NOW).canCancel, false);
});

test("paid or completed orders may request a return but are not automatically refunded", () => {
  assert.equal(availableServiceActions(order(30 * 60_000), snapshot("accepted", true), null, NOW).canReturn, true);
  assert.equal(availableServiceActions(order(30 * 60_000), snapshot("completed"), null, NOW).canReturn, true);
  assert.equal(availableServiceActions(order(), snapshot("canceled", true), null, NOW).canReturn, false);
  assert.equal(availableServiceActions(order(), snapshot("accepted"), null, NOW).canReturn, false);
});

test("pending customer requests are idempotent and disable competing actions", () => {
  const request = { kind: "cancel", status: "pending", requestedAt: new Date(NOW).toISOString() };
  const stored = order(60_000, { customer_cancel_request: request });
  assert.deepEqual(storedServiceRequest(stored, "cancel"), request);
  assert.deepEqual(availableServiceActions(stored, snapshot("created", true), null, NOW), { canCancel: false, canReturn: false });
});
