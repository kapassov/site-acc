import assert from "node:assert/strict";
import test from "node:test";
import { ordersAcceptingNow } from "../src/lib/checkout/order-hours.ts";

test("orders open at 09:00 and stop 30 minutes before the 21:00 pharmacy close", () => {
  const cases = [
    ["2026-09-26T03:59:00Z", false], // 08:59 in Kazakhstan
    ["2026-09-26T04:00:00Z", true],
    ["2026-09-26T15:29:59Z", true],
    ["2026-09-26T15:30:00Z", false],
    ["2026-09-26T22:00:00Z", false],
    ["2026-09-27T04:00:00Z", true],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(ordersAcceptingNow(new Date(instant)), expected, instant);
  }
});
