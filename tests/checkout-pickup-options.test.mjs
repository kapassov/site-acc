import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("pickup options route accepts canonical Medusa identities and reads live Daribar stock", async () => {
  const route = await read("../src/app/api/checkout/pickup-options/route.ts");
  assert.match(route, /readBoundedJson[^\n]+64 \* 1024/);
  assert.match(route, /canonicalizeCheckoutItems/);
  assert.match(route, /rateLimit\(`pickup-options:/);
  assert.match(route, /requestDaribarStockQuotes\(\{ items, city: city \|\| "Алматы"/);
  assert.match(route, /source: "daribar_v3", degraded: false/);
  assert.match(route, /error instanceof DaribarStockQuoteError \? error\.status : 503/);
  const mapping = await read("../src/lib/daribar/delivery-mapping.ts");
  assert.match(mapping, /return withRegistryCoordinates\(\{ id: row\.id, sourceCode: row\.source_code/);
  assert.match(mapping, /row\.latitude == null \? undefined : Number\(row\.latitude\)/);
});

test("pickup query requires every exact variant, quantity and current verified snapshot", async () => {
  const source = await read("../src/lib/catalog-local-read.ts");
  const start = source.indexOf("export async function findLocalPickupOptions");
  const end = source.indexOf("export function catalogQueryNeedsPrice", start);
  const query = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(query, /offer\.variant_id = requested\.variant_id/);
  assert.match(query, /offer\.source_quantity >= requested\.quantity/);
  assert.match(query, /offer\.source_snapshot_id = product\.metadata->>'standard_n_snapshot_id'/);
  assert.match(query, /HAVING count\(\*\) = \$5::integer/);
  assert.match(query, /withRegistryCoordinates/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
});

test("checkout offers only full-cart pharmacies and never silently picks the first directory entry", async () => {
  const page = await read("../src/app/checkout/page.tsx");
  assert.match(page, /fetch\("\/api\/checkout\/pickup-options"/);
  assert.match(page, /JSON\.stringify\(\{ items: pickupItems, city: normalizedCity \}\)/);
  assert.match(page, /const selectedPharmacy = pharmacyIndex >= 0 \? cityPharmacies\[pharmacyIndex\] : null/);
  assert.match(page, /copy\.pickupOptions\.title/);
  assert.match(page, /tenge\(point\.total\)/);
  assert.match(page, /points=\{cityPharmacies\}/);
  assert.doesNotMatch(page, /fetch\(`\/api\/pharmacies\?city=/);
});

test("nearest lookup uses full-cart options while GPS stays client-side", async () => {
  const source = await read("../src/lib/checkout/nearest-pickup.ts");
  assert.match(source, /request\("\/api\/checkout\/pickup-options"/);
  assert.match(source, /body: JSON\.stringify\(\{ items, city: pickupCity \}\)/);
  assert.match(source, /nearestCity\(location\.lat, location\.lon\)/);
  assert.match(source, /items\?\.length \? "daribar_v3" : "medusa"/);
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*(?:lat|lon)/);
});
