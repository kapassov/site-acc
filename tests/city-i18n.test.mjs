import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { langs } from "../src/lib/i18n/dict.ts";
import { canonicalCityName, CITY_LABELS, cityDisplayName } from "../src/lib/i18n/cities.ts";
import { CITIES } from "../src/lib/location/cities.ts";

const SELECTOR = new URL("../src/components/layout/CitySelector.tsx", import.meta.url);
const PHARMACIES = new URL("../src/app/pharmacies/page.tsx", import.meta.url);
const CHECKOUT = new URL("../src/app/checkout/page.tsx", import.meta.url);

test("every canonical API city has a non-empty RU, KZ and EN display label", () => {
  assert.ok(CITIES.length > 0);
  for (const city of CITIES) {
    assert.ok(Object.hasOwn(CITY_LABELS, city), `missing city labels for ${city}`);
    for (const { code } of langs) {
      assert.equal(typeof CITY_LABELS[city][code], "string");
      assert.ok(CITY_LABELS[city][code].trim(), `${city}.${code} is empty`);
    }
  }
});

test("translated city labels round-trip to API-safe canonical values", () => {
  for (const city of CITIES) {
    for (const { code } of langs) {
      assert.equal(canonicalCityName(cityDisplayName(city, code)), city);
    }
  }
  assert.equal(cityDisplayName("Алматы", "en"), "Almaty");
  assert.equal(cityDisplayName("Караганда", "kz"), "Қарағанды");
  assert.equal(canonicalCityName("Oskemen"), "Усть-Каменогорск");
  assert.equal(canonicalCityName("New city draft"), "New city draft");
});

test("city UI localizes labels while retaining canonical values for selection and API requests", async () => {
  const [selector, pharmacies, checkout] = await Promise.all([
    readFile(SELECTOR, "utf8"),
    readFile(PHARMACIES, "utf8"),
    readFile(CHECKOUT, "utf8"),
  ]);

  assert.match(selector, /cityDisplayName\(city, lang\)/);
  assert.match(selector, /cityDisplayName\(c, lang\)/);
  assert.match(selector, /onClick=\{\(\) => pick\(c\)\}/);

  assert.match(pharmacies, /cityDisplayName\(c, lang\)/);
  assert.match(pharmacies, /cityDisplayName\(city, lang\)/);
  assert.match(pharmacies, /setCity\(c\)/);

  assert.match(checkout, /value=\{cityDisplayName\(city, lang\)\}/);
  assert.match(checkout, /setCity\(canonicalCityName\(e\.target\.value\)\)/);
  assert.match(checkout, /city: preferredPharmacyCity/);
  assert.match(checkout, /city,\s*\n\s*quoteId:/);
});
