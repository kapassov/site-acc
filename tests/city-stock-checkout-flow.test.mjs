import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkoutStockStillMatches } from "../src/lib/checkout-stock-recheck.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a first-time visitor must choose a supported city before live stock requests", async () => {
  const [context, modal, layout, availability] = await Promise.all([
    read("../src/lib/location/CityContext.tsx"),
    read("../src/components/layout/CityWelcomeModal.tsx"),
    read("../src/app/layout.tsx"),
    read("../src/components/product/PharmacyAvailability.tsx"),
  ]);
  assert.match(context, /localStorage\.getItem\(KEY\)/);
  assert.match(context, /CITIES\.includes\(s/);
  assert.match(context, /setNeedsSelection\(true\)/);
  assert.match(context, /localStorage\.setItem\(KEY, c\)/);
  assert.match(layout, /<CityWelcomeModal \/>/);
  assert.match(modal, /CITIES\.map/);
  assert.match(modal, /setCity\(city\)/);
  assert.match(availability, /if \(!cityReady\) return/);
  assert.match(availability, /\?city=\$\{encodeURIComponent\(city\)\}/);
});

test("checkout uses the chosen city and shows the complete eligible pickup list in the map dialog", async () => {
  const [page, route, map] = await Promise.all([
    read("../src/app/checkout/page.tsx"),
    read("../src/app/api/checkout/pickup-options/route.ts"),
    read("../src/components/checkout/PharmacyMapPicker.tsx"),
  ]);
  assert.match(page, /const \{ city, setCity, ready: citySelectionReady, needsSelection \} = useCity\(\)/);
  assert.match(page, /points=\{cityPharmacies\}/);
  assert.match(route, /requestDaribarStockQuotes\(\{ items, city, paymentMethod, limit: 1_000 \}\)/);
  assert.doesNotMatch(route, /city \|\| "Алматы"/);
  assert.match(map, /mappedPoints\.map/);
  assert.match(map, /pts\.map/);
});

test("fresh full-basket stock permits increased quantity but rejects a changed pharmacy, SKU, price or shortage", () => {
  const line = { productId: "prod_a", variantId: "variant_a", wareId: "SKU-1", quantity: 2,
    availableQuantity: 4, unitPrice: 1200, total: 2400 };
  const signed = { currency: "KZT", total: 2400, pharmacy: { id: "sloc_1" }, lines: [line] };
  const live = { ...signed, lines: [{ ...line, availableQuantity: 10 }] };
  assert.equal(checkoutStockStillMatches(signed, live), true);
  assert.equal(checkoutStockStillMatches(signed, { ...live, pharmacy: { id: "sloc_2" } }), false);
  assert.equal(checkoutStockStillMatches(signed, { ...live, lines: [{ ...line, wareId: "SKU-2" }] }), false);
  assert.equal(checkoutStockStillMatches(signed, { ...live, lines: [{ ...line, availableQuantity: 1 }] }), false);
  assert.equal(checkoutStockStillMatches(signed, { ...live, lines: [{ ...line, unitPrice: 1300 }] }), false);
});
