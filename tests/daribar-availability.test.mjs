import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { daribarProductAvailabilityRows } from "../src/lib/daribar/product-availability.ts";

const AVAILABILITY = new URL("../src/lib/daribar/availability.ts", import.meta.url);
const ROUTE = new URL("../src/app/api/availability/[id]/route.ts", import.meta.url);
const UI = new URL("../src/components/product/PharmacyAvailability.tsx", import.meta.url);
const DETAIL = new URL("../src/components/product/ProductDetail.tsx", import.meta.url);
const CITY = new URL("../src/lib/location/CityContext.tsx", import.meta.url);

test("pharmacy availability uses Daribar v3 basket search for exact stock", async () => {
  const source = await readFile(AVAILABILITY, "utf8");

  assert.match(source, /searchDaribarProductsV3/);
  assert.match(source, /sourceCode/);
  assert.match(source, /countDesired: item\.quantity/);
  assert.match(source, /exact\.quantity < item\.quantity/);
  assert.doesNotMatch(source, /getDaribarExactPharmacyStock[\s\S]*\/api\/v1\/search\/in_pharmacy/);
});

test("availability fails partial requests safely and only caches complete responses", async () => {
  const source = await readFile(AVAILABILITY, "utf8");

  assert.match(source, /PHARMACY_CONCURRENCY = 4/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /checkedPharmacies === 0/);
  assert.match(source, /partial: checkedPharmacies !== allowedPharmacies\.length/);
  assert.match(source, /if \(!value\.partial\) remember\(key, value\)/);
  assert.match(source, /STALE_MS = 60_000/);
});

test("public availability route intersects live Daribar stock with own Medusa prices", async () => {
  const source = await readFile(ROUTE, "utf8");

  assert.match(source, /rateLimit\(`availability:\$\{clientIp\(request\)\}`, 30, 60_000/);
  assert.match(source, /getPharmacyPrices\(id\)/);
  assert.match(source, /getMedusaProductsByIds\(\[id\]\)/);
  assert.match(source, /info && !info\.stale && info\.complete/);
  assert.match(source, /daribarSkuForMedusaProduct\(id\)/);
  assert.match(source, /mappedDaribarPharmacies\(city\)/);
  assert.match(source, /searchDaribarProductsV3/);
  assert.match(source, /Math\.min\(exact\.quantity, medusaQuantity\)/);
  assert.match(source, /Math\.min\(exact\.quantity, medusaQuantity\) : exact\.quantity/);
  assert.match(source, /medusa_last_known_price\+daribar_v3_stock/);
  assert.match(source, /if \(servesDaribarCatalog\(\)\)/);
  assert.match(source, /daribarSkuFromProductId\(id\)/);
  assert.match(source, /daribarProductAvailabilityRows\(live, mapped, sku\)/);
  assert.match(source, /source: "daribar_v3_price_and_stock"/);
  assert.match(source, /"no-store"/);
  assert.doesNotMatch(source, /DARIBAR_(?:TOKEN|SERVICE_TOKEN)|authorization/i);
});

test("native Daribar availability keeps only exact, priced stock at mapped pharmacies", () => {
  const mapped = new Map([["ass-001", {
    id: "sloc_A1", sourceCode: "ass-001", name: "АСС", city: "Алматы", address: "Абая 34",
  }]]);
  const rows = [
    { sourceCode: "ass-001", name: "АСС", city: "Алматы", address: "Абая 34", products: [
      { sku: "ANALOG", quantity: 30, price: 100, analogs: [] },
      { sku: "SKU-1", quantity: 4, price: 1250, analogs: [] },
    ] },
    { sourceCode: "outside", name: "Сторонняя", city: "Алматы", address: "Адрес", products: [
      { sku: "SKU-1", quantity: 8, price: 900, analogs: [] },
    ] },
    { sourceCode: "ass-001", name: "АСС", city: "Алматы", address: "Абая 34", products: [
      { sku: "SKU-1", quantity: 1, price: 0, analogs: [] },
    ] },
  ];
  assert.deepEqual(daribarProductAvailabilityRows(rows, mapped, "SKU-1"), [{
    sourceCode: "sloc_A1", name: "АСС", city: "Алматы", address: "Абая 34",
    lat: undefined, lon: undefined, hours: undefined, quantity: 4, price: 1250,
  }]);
});

test("product page renders responsive pharmacy stock states and exact quantities", async () => {
  const [ui, detail, city] = await Promise.all([
    readFile(UI, "utf8"),
    readFile(DETAIL, "utf8"),
    readFile(CITY, "utf8"),
  ]);

  assert.match(detail, /product\.source === "medusa" \|\| product\.source === "daribar"/);
  assert.match(detail, /<PharmacyAvailability productId=\{product\.id\}/);
  assert.match(ui, /\/api\/availability\/\$\{encodeURIComponent\(productId\)\}/);
  assert.match(ui, /pharmacy\.quantity/);
  assert.match(ui, /tenge\(pharmacy\.price\)/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /aria-busy=\{loading\}/);
  assert.match(ui, /Не удалось загрузить остатки/);
  assert.match(ui, /товар сейчас не найден в наличии/);
  assert.match(ui, /Показать ещё/);
  assert.match(ui, /CitySelector full/);
  assert.match(city, /ready: boolean/);
  assert.match(ui, /if \(!cityReady\) return/);
});
