import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(source, /"no-store"/);
  assert.doesNotMatch(source, /DARIBAR_(?:TOKEN|SERVICE_TOKEN)|authorization/i);
});

test("product page renders responsive pharmacy stock states and exact quantities", async () => {
  const [ui, detail, city] = await Promise.all([
    readFile(UI, "utf8"),
    readFile(DETAIL, "utf8"),
    readFile(CITY, "utf8"),
  ]);

  assert.match(detail, /product\.source === "medusa" && <PharmacyAvailability productId=\{product\.id\}/);
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
