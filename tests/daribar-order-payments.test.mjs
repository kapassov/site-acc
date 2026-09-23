import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseDaribarOrderPayments,
  summarizeDaribarOrderPayments,
} from "../src/lib/daribar/order-payments.ts";

const orderId = "384666";

function payment(overrides = {}) {
  return {
    uuid: "6f1c2c1e-4b7a-4a55-9d6b-1a2b3c4d5e6f",
    order_id: orderId,
    pharmacy_code: "ph_001",
    payment_method: "interpay",
    status: "ready_to_invoice",
    amount: 5400,
    items_amount: 4500,
    delivery_amount: 900,
    payment_type: "order",
    payment_url: "https://secure.kassa.com/private-token",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:01:00Z",
    paid_at: null,
    num_in_order: 1,
    ...overrides,
  };
}

test("Daribar payment response is sorted and private payment data is reduced to safe metadata", () => {
  const parsed = parseDaribarOrderPayments({
    status: "success",
    result: [
      payment(),
      payment({
        uuid: "7f1c2c1e-4b7a-4a55-9d6b-1a2b3c4d5e6f",
        status: "paid",
        paid_at: "2026-09-01T10:05:00Z",
        updated_at: "2026-09-01T10:05:00Z",
        num_in_order: 2,
        refunds: [{
          uuid: "0a9b8c7d-6e5f-4a3b-2c1d-0e9f8a7b6c5d",
          payment_uuid: "7f1c2c1e-4b7a-4a55-9d6b-1a2b3c4d5e6f",
          amount: 300,
          status: "refund_ready",
          refund_type: "items",
          comment: "sensitive provider note",
          created_at: "2026-09-01T12:00:00Z",
          updated_at: "2026-09-01T12:01:00Z",
        }],
      }),
    ],
  }, orderId);

  assert.equal(parsed[0].numInOrder, 2);
  assert.equal(parsed[0].hasPaymentUrl, true);
  assert.doesNotMatch(JSON.stringify(parsed), /private-token|sensitive provider note/);
  const summary = summarizeDaribarOrderPayments(parsed);
  assert.deepEqual(summary, {
    status: "paid",
    paid: true,
    authorized: false,
    method: "interpay",
    type: "order",
    paidAt: "2026-09-01T10:05:00Z",
    updatedAt: "2026-09-01T10:05:00Z",
    numInOrder: 2,
    hasPaymentUrl: true,
    refundAmount: 300,
    refundStatus: "refund_ready",
  });
});

test("a paid whole-order attempt remains authoritative over a later failed retry", () => {
  const parsed = parseDaribarOrderPayments({
    status: "success",
    result: [
      payment({ status: "paid", paid_at: "2026-09-01T10:05:00Z" }),
      payment({
        uuid: "8f1c2c1e-4b7a-4a55-9d6b-1a2b3c4d5e6f",
        status: "failed",
        num_in_order: 2,
        updated_at: "2026-09-01T10:06:00Z",
      }),
    ],
  }, orderId);
  assert.equal(summarizeDaribarOrderPayments(parsed)?.status, "paid");
});

test("empty payments are valid while malformed or cross-order responses fail closed", () => {
  assert.deepEqual(parseDaribarOrderPayments({ status: "success", result: [] }, orderId), []);
  assert.throws(
    () => parseDaribarOrderPayments({ status: "success", result: [payment({ order_id: "other" })] }, orderId),
    /daribar_payments_order_mismatch/,
  );
  assert.throws(
    () => parseDaribarOrderPayments({ status: "success", result: [{}] }, orderId),
    /daribar_payments_invalid_response/,
  );
});

test("customer order detail polls the documented payment endpoint with the customer token", async () => {
  const client = await readFile(new URL("../src/lib/daribar/order-payments.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/customer/orders/[id]/route.ts", import.meta.url), "utf8");
  const listRoute = await readFile(new URL("../src/app/api/customer/orders/route.ts", import.meta.url), "utf8");
  assert.match(client, /`\/api\/v1\/orders\/\$\{encodeURIComponent\(normalizedId\)\}\/payments`/);
  assert.match(client, /authorization: `Bearer \$\{credential\}`/);
  assert.match(client, /origin: "order"/);
  assert.match(route, /getDaribarCustomerOrderPayment\(session\.accessToken, order\.sourceOrderId\)/);
  assert.match(route, /providerMetadataPatch\(snapshot, payment\)/);
  assert.doesNotMatch(route, /paymentUrl|payment_url/);
  assert.match(listRoute, /paymentCandidates[\s\S]*?\.slice\(0, 5\)/);
  assert.match(listRoute, /getDaribarCustomerOrderPayment\([\s\S]*?daribarSession\.accessToken/);
  assert.match(listRoute, /customerOrderSummary\([\s\S]*?paymentFeed\.get\(order\.sourceOrderId\)/);
});
