import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isMedusaPickupPoint, hasPickupCoordinates } from "../src/lib/checkout/pickup-points.ts";

const pharmacy = { sourceCode: "sloc_123ABC", address: "Абая 10", city: "Алматы", hours: "" };
test("A verified Medusa pickup is selectable without GPS coordinates", () => {
  assert.equal(isMedusaPickupPoint(pharmacy), true);
  assert.equal(hasPickupCoordinates(pharmacy), false);
  assert.equal(hasPickupCoordinates({ ...pharmacy, lat: 43.24, lon: 76.92 }), true);
  assert.equal(hasPickupCoordinates({ ...pharmacy, lat: 0, lon: 0 }), false);
  assert.equal(hasPickupCoordinates({ ...pharmacy, lat: 91, lon: 0 }), false);
  assert.equal(isMedusaPickupPoint({ ...pharmacy, sourceCode: "daribar_123" }), false);
  assert.equal(isMedusaPickupPoint({ ...pharmacy, address: "" }), false);
});
test("Checkout never submits unsupported promo codes or uses a static pickup fallback", async () => {
  const source = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /promoCode:|copy\.promo|pharmaciesForCity/);
  assert.match(source, /filter\(isPickupOption\)/);
  assert.match(source, /fetch\("\/api\/checkout\/pickup-options"/);
});
