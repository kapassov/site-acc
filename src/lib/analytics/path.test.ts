import assert from "node:assert/strict";
import test from "node:test";
import { analyticsPath } from "./path.ts";

test("analyticsPath redacts every payment-session path", () => {
  assert.equal(
    analyticsPath("/payment/6f49e53c-29c2-4b06-9578-2dc29a96b20a"),
    "/payment/[session]",
  );
  assert.equal(analyticsPath("/payment/arbitrary/private/value"), "/payment/[session]");
  assert.equal(analyticsPath("/PAYMENT/SECRET"), "/payment/[session]");
});

test("analyticsPath normalizes the payment root without changing other paths", () => {
  assert.equal(analyticsPath("/payment"), "/payment/[session]");
  assert.equal(analyticsPath("/payment/"), "/payment/[session]");
  assert.equal(analyticsPath("/payments/history"), "/payments/history");
  assert.equal(analyticsPath("/payment-methods"), "/payment-methods");
  assert.equal(analyticsPath("/catalog"), "/catalog");
  assert.equal(analyticsPath(null), "");
});
