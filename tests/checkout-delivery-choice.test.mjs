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

test("courier checkout automatically requests the nearest city option after address entry", async () => {
  const page = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(page, /deliveryRequest:\s*\{[\s\S]*?mode:\s*"city"/);
  assert.doesNotMatch(page, /\/api\/checkout\/courier-anchor|findBetterCityDelivery|applyCityDelivery/);
  assert.doesNotMatch(page, /Найти выгоднее|Find a better option/);
  assert.match(page, /<CourierPriceChoice[\s\S]*?quote=\{quote\}/);
});
