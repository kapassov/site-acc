import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  checkoutDistance,
  checkoutExtra,
  checkoutText,
} from "../src/lib/i18n/checkout-extra.ts";

const PAGE = new URL("../src/app/checkout/page.tsx", import.meta.url);
const MAP = new URL("../src/components/checkout/PharmacyMapPicker.tsx", import.meta.url);

function flatten(value, prefix = "", result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") result.set(path, item);
    else flatten(item, path, result);
  }
  return result;
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test("checkout extra copy has complete non-empty RU/KZ/EN parity", () => {
  const reference = flatten(checkoutExtra.ru);
  assert.ok(reference.size >= 70, "checkout copy unexpectedly lost coverage");

  for (const language of ["ru", "kz", "en"]) {
    const locale = flatten(checkoutExtra[language]);
    assert.deepEqual([...locale.keys()].sort(), [...reference.keys()].sort(), `${language} checkout keys drifted`);
    for (const [key, value] of locale) {
      assert.ok(value.trim(), `${language}.${key} must not be empty`);
      assert.deepEqual(placeholders(value), placeholders(reference.get(key)), `${language}.${key} placeholders drifted`);
    }
  }
});

test("checkout copy covers progress, validation, geolocation, map and order-summary states", () => {
  for (const language of ["ru", "kz", "en"]) {
    const copy = checkoutExtra[language];
    for (const value of [
      copy.progress.aria,
      copy.validation.name,
      copy.validation.houseNumber,
      copy.formError.authRequired,
      copy.quoteError.selectedPharmacyUnavailable,
      copy.nearest.permissionDenied,
      copy.nearest.chooseOnMap,
      copy.map.loadError,
      copy.map.pickHere,
      copy.availability.confirmed,
      copy.orderLine.inCart,
      copy.action.submitting,
    ]) assert.ok(value.trim());
  }

  assert.notEqual(checkoutExtra.kz.action.submitting, checkoutExtra.ru.action.submitting);
  assert.notEqual(checkoutExtra.en.map.title, checkoutExtra.ru.map.title);
});

test("checkout interpolation and distance copy are locale-safe", () => {
  assert.equal(checkoutText(checkoutExtra.en.map.pickHere, { address: "Abay 24" }), "Pick up here · Abay 24");
  assert.equal(checkoutText(checkoutExtra.kz.orderLine.inCart, { quantity: 2 }), "Себетте: 2");
  assert.match(checkoutDistance(0.235, "en"), /^240 m$/);
  assert.match(checkoutDistance(1.25, "en"), /^1\.3 km$/);
  assert.match(checkoutDistance(1.25, "ru"), /км$/);
  assert.match(checkoutDistance(1.25, "kz"), /км$/);
});

test("checkout derives visible errors and CTA copy reactively from the active language", async () => {
  const source = await readFile(PAGE, "utf8");

  assert.match(source, /const \{ t, plural, lang \} = useLang\(\)/);
  assert.match(source, /const copy = checkoutExtra\[lang\]/);
  assert.match(source, /useState<FormErrorCode \| null>\(null\)/);
  assert.match(source, /useState<NearestErrorCode \| null>\(null\)/);
  assert.match(source, /const formErrorText = formError \? copy\.formError\[formError\] : ""/);
  assert.match(source, /const nearestErrorText = nearestError \? copy\.nearest\[nearestError\] : ""/);
  assert.match(source, /return copy\.validation\[field\]/);
  assert.match(source, /copy\.action\.submitting/);
  assert.match(source, /copy\.quoteError\.selectedPharmacyUnavailable/);
  assert.match(source, /copy\.availability\.preparedBy/);
  assert.doesNotMatch(source, /geolocationErrorMessage\(/);
});

test("pharmacy map picker uses the same reactive locale source", async () => {
  const source = await readFile(MAP, "utf8");

  assert.match(source, /const \{ lang \} = useLang\(\)/);
  assert.match(source, /const copy = checkoutExtra\[lang\]\.map/);
  assert.match(source, /aria-label=\{copy\.close\}/);
  assert.match(source, /\{copy\.loadError\}/);
  assert.match(source, /\{copy\.route\}/);
  assert.match(source, /checkoutText\(copy\.pickHere/);
});
