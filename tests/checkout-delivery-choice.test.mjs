import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compareDeliveryOffersByDistance } from "../src/lib/daribar/delivery.ts";

function offer(code, distance, price, eta) {
  return {
    pharmacy: { code },
    bestDelivery: { distance, price, eta },
  };
}

test("city delivery ranks the nearest fulfilment pharmacy before price", () => {
  const values = [
    offer("cheap-far", 9_000, 500, 25),
    offer("near-expensive", 1_200, 1_500, 20),
    offer("nearest", 800, 2_000, 35),
  ].sort(compareDeliveryOffersByDistance);
  assert.deepEqual(values.map((value) => value.pharmacy.code), ["nearest", "near-expensive", "cheap-far"]);
});

test("equal-distance pharmacies use price, ETA and stable code as tie-breakers", () => {
  const values = [
    offer("z", 1_000, 900, 30),
    offer("b", 1_000, 800, 30),
    offer("a", 1_000, 800, 30),
    offer("slow", 1_000, 800, 40),
  ].sort(compareDeliveryOffersByDistance);
  assert.deepEqual(values.map((value) => value.pharmacy.code), ["a", "b", "slow", "z"]);
});

test("courier checkout keeps the explicitly selected pharmacy while quoting delivery", async () => {
  const page = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const courierMode = "pharmacy" as const/);
  assert.match(page, /deliveryRequest:\s*\{[\s\S]*?mode:\s*courierMode/);
  assert.match(page, /pharmacyId: selectedPharmacy\?\.sourceCode/);
  assert.match(page, /preferredPharmacy: selectedPharmacy \? \{/);
  assert.doesNotMatch(page, /setCourierMode/);
  assert.doesNotMatch(page, /\/api\/checkout\/courier-anchor|findBetterCityDelivery|applyCityDelivery/);
  assert.doesNotMatch(page, /Найти выгоднее|Find a better option/);
  assert.match(page, /<CourierPriceChoice[\s\S]*?quote=\{quote\}/);
});
