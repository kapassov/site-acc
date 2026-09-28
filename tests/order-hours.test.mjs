import assert from "node:assert/strict";
import test from "node:test";
import { ordersAcceptingNow } from "../src/lib/checkout/order-hours.ts";

test("orders open at 08:00 and close at 21:45 Kazakhstan time", () => {
  const cases = [
    ["2026-09-26T02:59:00Z", false], // 07:59 in Kazakhstan
    ["2026-09-26T03:00:00Z", true],
    ["2026-09-26T16:44:59Z", true],
    ["2026-09-26T16:45:00Z", false],
    ["2026-09-26T22:00:00Z", false],
    ["2026-09-27T03:00:00Z", true],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(ordersAcceptingNow(new Date(instant)), expected, instant);
  }
});
