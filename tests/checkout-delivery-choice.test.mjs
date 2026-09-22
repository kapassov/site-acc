import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compareDeliveryChoices } from "../src/lib/checkout/delivery-choice.ts";

test("city comparison exposes savings without changing the active quote", () => {
  const current = { subtotal: 4100, total: 5300, pharmacy: { id: "sloc_current" }, delivery: { price: 1200, eta: 40, provider: "yandex" } };
  const candidate = { subtotal: 4250, total: 4950, pharmacy: { id: "sloc_city" }, delivery: { price: 700, eta: 45, provider: "wolt" } };
  assert.deepEqual(compareDeliveryChoices(current, candidate), {
    savings: 350,
    isCheaper: true,
    changesPharmacy: true,
  });
});

test("a more expensive city result is never presented as savings", () => {
  const current = { subtotal: 4100, total: 5000, pharmacy: { id: "sloc_current" } };
  const candidate = { subtotal: 4000, total: 5100, pharmacy: { id: "sloc_other" } };
  assert.deepEqual(compareDeliveryChoices(current, candidate), {
    savings: 0,
    isCheaper: false,
    changesPharmacy: true,
  });
});

test("courier checkout anchors pharmacy pricing and runs city optimization only on demand", async () => {
  const [page, anchorRoute, quote] = await Promise.all([
    readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/checkout/courier-anchor/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/checkoutQuote.ts", import.meta.url), "utf8"),
  ]);
  assert.match(anchorRoute, /createCourierAnchorQuote/);
  const anchor = quote.slice(quote.indexOf("export async function createCourierAnchorQuote"));
  assert.match(anchor, /fulfillment:\s*"pickup"/);
  assert.match(anchor, /preferredPharmacy:\s*\{\s*city\s*\}/);
  assert.doesNotMatch(anchor, /rankMappedPharmaciesForItems|mapLocalPharmacyToDaribar/);
  assert.match(page, /deliveryRequest:\s*\{[\s\S]*?mode:\s*"pharmacy"/);
  assert.match(page, /deliveryRequest:\s*\{[\s\S]*?mode:\s*"city"/);
  assert.match(page, /findBetterCityDelivery/);
  assert.match(page, /applyCityDelivery/);
});
