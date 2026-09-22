import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedProductNameDistance,
  matchesSourceSearchName,
  rankProductSearchCandidates,
} from "../src/lib/search/search-ranking.ts";
import { parseProductSearchQuery } from "../src/lib/search/product-search-model.ts";

function product(id, name, extra = {}) {
  return {
    id, sku: id, source: "daribar", slug: id, name, brand: "Test", categorySlug: "lekarstva",
    price: 1000, rating: 0, reviews: 0, badges: [], art: { kind: "box", hue: 140 },
    inStock: true, stockPharmacies: 3, ...extra,
  };
}

for (const [left, right, maximum, expected] of [
  ["линекс", "линекс", 2, 0],
  ["линкес", "линекс", 2, 1],
  ["линкес", "линкас", 2, 1],
  ["линкс", "линекс", 2, 1],
  ["нурофен", "нурофн", 2, 1],
  ["нурафн", "нурофен", 2, 2],
  ["вольторин", "вольтарен", 2, 2],
  ["вольторин", "оторин", 2, 3],
  ["вольторин", "вольтарен", 1, 2],
  ["линкес", "линекс", 0, 1],
  ["", "ab", 2, 2],
  ["", "abcd", 2, 3],
  ["абвгде", "фхцчшщ", 2, 3],
]) {
  test(`bounded source spelling distance: ${left}/${right} at ${maximum}`, () => {
    assert.equal(boundedProductNameDistance(left, right, maximum), expected);
    assert.equal(boundedProductNameDistance(right, left, maximum), expected);
  });
}

const guardCases = [
  ["Нурофен таблетки 200мг", "нурофен", 0, true, true],
  ["Нурофен таблетки 200мг", "нуроф", 0, true, true],
  ["Нурофен таблетки 200мг", "нуроф", 0, false, false],
  ["Нурофен таблетки 200мг", "нурофн", 0, true, false],
  ["Нурофен таблетки 200мг", "нурофн", 1, true, true],
  ["Нурофен таблетки 200мг", "нурафн", 2, true, false],
  ["Вольтарен гель 50г", "вольторин", 2, true, true],
  ["Оторин капли 10мл", "вольторин", 2, true, false],
  ["Вольтарен гель 50г", "вольторин", 1, true, false],
  ["Парацетамол таблетки 500мг", "парацитомол", 1, true, false],
  ["Парацетамол таблетки 500мг", "парацитомол", 2, true, true],
  ["Парацетамол таблетки 500мг", "парацета", 0, true, true],
  ["Парацетамол таблетки 500мг", "парацита", 1, true, false],
  ["Парацетамол Форте таблетки 500мг", "парац форте", 0, true, false],
  ["Парацетамол Форте таблетки 500мг", "парацетамол фор", 0, true, true],
  ["Парацетамол таблетки 500мг", "парацетамол форте", 2, true, false],
  ["Парацетамол Форте таблетки 500мг", "парацитомол фрте", 2, true, false],
  ["Парацетамол Форте таблетки 500мг", "парацитомол форте", 2, true, true],
  ["Но-шпа таблетки 40мг", "ношпа", 0, true, true],
  ["Но-шпа таблетки 40мг", "ношпо", 1, true, false],
  ["Но-шпа таблетки 40мг", "но шпа", 0, true, true],
  ["Йод раствор 5%", "еод", 2, false, false],
  ["Линекс капсулы №16", "линкс", 1, false, true],
  ["Линекс капсулы №16", "линк", 2, false, false],
  ["Нурофен таблетки 200мг №10", "нурофн 200мг таблетки №10", 1, true, true],
  ["Нурофен таблетки 400мг №10", "нурофн 200мг таблетки №10", 1, true, false],
  ["Нурофен сироп 200мл", "нурофн 200мг таблетки", 1, true, false],
  ["Нурофен таблетки 200мг №20", "нурофн 200мг таблетки №10", 1, true, false],
  ["Витамин B12 капсулы №30", "витамин b12", 2, true, true],
  ["Витамин B1 капсулы №12", "витамин b12", 2, true, false],
  ["Крем SPF50 50мл", "spf50", 2, true, true],
  ["Крем SPF500 50мл", "spf50", 2, true, false],
  ["MicroTech Medical LinX CGM sensor", "линкс", 1, true, false],
  ["MicroTech Medical LinX CGM sensor", "linx", 0, true, true],
  ["Парацетамол таблетки 500мг", "paracetamol", 0, true, false],
];
for (const [name, query, typos, prefix, expected] of guardCases) {
  test(`source guard ${query}/${name}, typos=${typos}, prefix=${prefix}`, () => {
    assert.equal(matchesSourceSearchName(product("A", name), query, typos, prefix), expected);
  });
}

test("unrequested combination follows a source plain-label product", () => {
  const combined = product("COMBO", "Амоксициллин+Клавулановая кислота таблетки 500мг+125мг №10");
  const mono = product("MONO", "Амоксициллин капсулы 500мг №16");
  assert.deepEqual(rankProductSearchCandidates([combined, mono], "Амоксициллин"), [mono, combined]);
});

test("an explicitly requested combination remains ahead of a mono product", () => {
  const combined = product("COMBO", "Амоксициллин+Клавулановая кислота таблетки 500мг+125мг №10");
  const mono = product("MONO", "Амоксициллин капсулы 500мг №16");
  assert.deepEqual(rankProductSearchCandidates([mono, combined], "Амоксициллин Клавулановая"), [combined, mono]);
});

test("exact source name wins even when a similar different medicine is available", () => {
  const exact = product("EXACT", "Нурофен таблетки 200мг", { inStock: false, priceTBD: true, price: 0 });
  const other = product("OTHER", "Норофен таблетки 200мг");
  assert.deepEqual(rankProductSearchCandidates([other, exact], "Нурофен"), [exact, other]);
});

test("an exact requested qualifier is not displaced by a buyable different qualifier", () => {
  const express = product("EXPRESS", "Нурофен Экспресс капсулы 200мг");
  const forte = product("FORTE", "Нурофен Форте таблетки 400мг", { inStock: false, price: 0, priceTBD: true });
  assert.deepEqual(rankProductSearchCandidates([express, forte], "Нурофен Форте"), [forte, express]);
});

test("transposition signal ranks a preserved-letter candidate first without losing other names", () => {
  const linkas = product("LINKAS", "Линкас сироп 120мл");
  const linex = product("LINEX", "Линекс капсулы №16");
  assert.deepEqual(rankProductSearchCandidates([linkas, linex], "линкес"), [linex, linkas]);
});

test("ambiguous typo shows distinct source families in the first three and retains all packages", () => {
  const linkas = Array.from({ length: 12 }, (_, index) => product(`LINKAS${index}`, `Линкас сироп ${100 + index}мл`));
  const linex = Array.from({ length: 12 }, (_, index) => product(`LINEX${index}`, `Линекс капсулы №${16 + index}`));
  const device = product("DEVICE", "MicroTech Medical LinX CGM sensor");
  const input = [...linkas, device, ...linex];
  const result = rankProductSearchCandidates(input, "линкс");
  assert.deepEqual(new Set(result.slice(0, 3).map((item) => item.id.replace(/\d+$/, ""))), new Set(["LINKAS", "LINEX", "DEVICE"]));
  assert.equal(result.length, input.length);
  assert.deepEqual(new Set(result), new Set(input));
  assert.deepEqual(result.filter((item) => item.id.startsWith("LINKAS")), linkas);
  assert.deepEqual(result.filter((item) => item.id.startsWith("LINEX")), linex);
});

test("literal device name retains its source intent above nearby Cyrillic medication names", () => {
  const device = product("DEVICE", "MicroTech Medical LinX CGM sensor");
  const linex = product("LINEX", "Линекс капсулы №16");
  const linkas = product("LINKAS", "Линкас сироп 120мл");
  assert.equal(rankProductSearchCandidates([linex, linkas, device], "LinX")[0], device);
});

test("same-score same-name packages preserve engine order", () => {
  const items = Array.from({ length: 345 }, (_, index) => product(String(index), "Парацетамол таблетки 500мг №10", { price: 500 + index }));
  const engine = items.toReversed();
  assert.deepEqual(rankProductSearchCandidates(engine, "парацитомол"), engine);
});

test("buyable source item precedes unavailable items of the same matched label", () => {
  const unavailable = product("UNAVAILABLE", "Парацетамол таблетки 500мг №10", { inStock: false });
  const unknownPrice = product("PRICE_TBD", "Парацетамол таблетки 500мг №10", { priceTBD: true, price: 0 });
  const buyable = product("BUYABLE", "Парацетамол таблетки 500мг №10");
  assert.deepEqual(rankProductSearchCandidates([unavailable, unknownPrice, buyable], "Парацетамол"), [buyable, unavailable, unknownPrice]);
});

test("price magnitude is not a relevance signal among equally buyable source items", () => {
  const expensive = product("EXPENSIVE", "Парацетамол таблетки 500мг №10", { price: 20000 });
  const cheap = product("CHEAP", "Парацетамол таблетки 500мг №10", { price: 200 });
  assert.deepEqual(rankProductSearchCandidates([expensive, cheap], "Парацетамол"), [expensive, cheap]);
});

test("zero/nonfinite prices and priceTBD are not treated as buyable", () => {
  const bad = [0, -1, NaN, Infinity].map((price, index) => product(`BAD${index}`, "Парацетамол 500мг", { price }));
  const good = product("GOOD", "Парацетамол 500мг");
  assert.equal(rankProductSearchCandidates([...bad, good], "Парацетамол")[0], good);
});

test("variant-aware ranking uses the supplied spelling but preserves original literal intent", () => {
  const original = product("LATIN", "Paracetamol таблетки 500мг");
  const alias = product("RUSSIAN", "Парацетамол таблетки 500мг");
  const parsed = parseProductSearchQuery("paracetamol");
  const variant = parsed.variants.find((item) => item.value === "парацетамол");
  assert.ok(variant);
  assert.equal(rankProductSearchCandidates([alias, original], parsed, variant)[0], original);
});

test("ranker repeats the exact dosage/form guard even when passed invalid engine candidates", () => {
  const wrongDose = product("DOSE", "Нурофен таблетки 400мг");
  const wrongForm = product("FORM", "Нурофен капсулы 200мг");
  const safe = product("SAFE", "Нурофен таблетки 200мг", { inStock: false });
  assert.deepEqual(rankProductSearchCandidates([wrongDose, wrongForm, safe], "нурофн 200мг таблетки"), [safe]);
});

test("ranker does not mutate input, source names or create IDs", () => {
  const linkas = Object.freeze(product("LINKAS", "Линкас сироп 120мл"));
  const linex = Object.freeze(product("LINEX", "Линекс капсулы №16"));
  const input = Object.freeze([linkas, linex]);
  const result = rankProductSearchCandidates(input, "линкес");
  assert.notEqual(result, input);
  assert.deepEqual(input, [linkas, linex]);
  assert.deepEqual(result, [linex, linkas]);
});

test("cached source views are invalidated when a source title changes", () => {
  const item = product("ITEM", "Нурофен таблетки 200мг");
  assert.equal(matchesSourceSearchName(item, "нурофн 200мг таблетки", 1), true);
  item.name = "Нурофен капсулы 400мг";
  assert.equal(matchesSourceSearchName(item, "нурофн 200мг таблетки", 1), false);
});

test("availability changes are observed without rebuilding cached names", () => {
  const first = product("FIRST", "Парацетамол 500мг");
  const second = product("SECOND", "Парацетамол 500мг");
  assert.equal(rankProductSearchCandidates([first, second], "Парацетамол")[0], first);
  first.inStock = false;
  assert.equal(rankProductSearchCandidates([first, second], "Парацетамол")[0], second);
});

test("empty constrained name does not reorder or invent name matching", () => {
  const safe = product("SAFE", "Нурофен таблетки 200мг");
  const wrong = product("WRONG", "Нурофен таблетки 400мг");
  assert.deepEqual(rankProductSearchCandidates([wrong, safe], "200мг таблетки"), [safe]);
  assert.deepEqual(rankProductSearchCandidates([wrong, safe], ""), [wrong, safe]);
  assert.deepEqual(rankProductSearchCandidates([], "нурофен"), []);
});
