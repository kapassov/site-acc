import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guardNativeDaribarSearch } from "../src/lib/daribar/indexed-search.ts";
import { assessSearchCase } from "../scripts/evaluate-product-search.mjs";

function product(sku, name, extra = {}) {
  return {
    id: `daribar_${sku}`, sku, source: "daribar", slug: sku, name, brand: "Test", categorySlug: "lekarstva",
    price: 1000, rating: 0, reviews: 0, badges: [], art: { kind: "box", hue: 140 },
    inStock: true, stockPharmacies: 3, ...extra,
  };
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/daribar-search-acceptance.json", import.meta.url), "utf8"));
const families = new Map(fixture.families.map((family) => [family.id, family]));
const evidence = [...new Map(fixture.families.flatMap((family) => family.products.map((row) => product(row.sku, row.name)))
  .map((item) => [item.id, item])).values()];

// Feed the fallback every source medicine, as if the provider ignored the query entirely.
// Fixed manually-authored SKU expectations verify the whole result, not the shared parser.
for (const entry of fixture.cases.filter((item) => item.group === "safety")) {
  for (const withSource of [false, true]) {
    test(`native ${withSource ? "snapshot" : "response-only"} guard: ${entry.id}`, () => {
      const results = guardNativeDaribarSearch(evidence, entry.query, false, withSource ? { sourceProducts: evidence } : {});
      const assessed = assessSearchCase(entry, families.get(entry.familyId), results);
      assert.equal(assessed.unsafeMatchCount, 0, JSON.stringify(assessed.unsafeResults));
      assert.equal(assessed.pass, true, JSON.stringify(assessed));
    });
  }
}

test("native suggestions for other names are removed even when no dose was requested", () => {
  const nurofen = product("NURO", "Нурофен таблетки 200мг №10");
  const noofen = product("NOOFEN", "Ноофен капсулы 250мг №20");
  const norofen = product("NOROFEN", "Норофен таблетки 200мг №10");
  assert.deepEqual(guardNativeDaribarSearch([noofen, norofen, nurofen], "Нурофен"), [nurofen]);
});

test("an exact name in the complete source cannot turn into another provider candidate", () => {
  const known = product("NURO", "Нурофен таблетки 200мг №10");
  const other = product("NORO", "Норофен таблетки 200мг №10");
  assert.deepEqual(guardNativeDaribarSearch([other], "Нурофен", false, { sourceProducts: [known, other] }), []);
});

test("the full source selects literal identity before a dose missing from that identity", () => {
  const known = product("SUPRA", "Супрастин таблетки 25мг №20");
  const other = product("OTHER", "Другой препарат таблетки 250мг №20");
  assert.deepEqual(guardNativeDaribarSearch([other], "Супрастин 250мг", false, { sourceProducts: [known, other] }), []);
});

test("another brand mentioning an inflected ingredient cannot satisfy a missing form", () => {
  const known = product("LORA", "Лоратадин таблетки 10мг №10");
  const other = product("GRIPP", "Гриппферон с лоратадином мазь 5г");
  for (const context of [{}, { sourceProducts: [known, other] }]) {
    assert.deepEqual(guardNativeDaribarSearch([other], "Лоратадин мазь", false, context), []);
  }
});

test("an unresolved constrained typo fails closed instead of selecting a different medicine", () => {
  const wrong = product("LINKAS", "Линкас спрей 20мл");
  const intended = product("LINEX", "Линекс капсулы №16");
  for (const context of [{}, { sourceProducts: [intended, wrong] }]) {
    assert.deepEqual(guardNativeDaribarSearch([wrong], "линкс спрей", false, context), []);
  }
});

test("exact same-name Latin spelling is allowed with original dose/form constraints", () => {
  const safe = product("PARA", "Парацетамол таблетки 200мг №10");
  const wrong = product("OTHER", "Ибупрофен таблетки 200мг №10");
  assert.deepEqual(guardNativeDaribarSearch([wrong, safe], "paracetamol 200 mg tablets"), [safe]);
});

test("name-only provider typos remain bounded and source-backed", () => {
  const safe = product("VOLTAREN", "Вольтарен гель 50г");
  const other = product("OTORIN", "Оторин капли 10мл");
  assert.deepEqual(guardNativeDaribarSearch([other, safe], "вольторин"), [safe]);
});

test("native three-vowel recovery requires complete source evidence and preserves constraints", () => {
  const correct = product("PARA", "Парацетамол 200 мг таблетки №10");
  const wrong = product("DOSE", "Парацетамол 500 мг таблетки №10");
  const reference = [correct, wrong];
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол"), [], "provider results alone cannot prove uniqueness");
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол", false, { sourceProducts: reference }), reference);
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол 200 мг таблетки №10", false, { sourceProducts: reference }), [correct]);
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол 5000 мг", false, { sourceProducts: reference }), []);
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол мазь", false, { sourceProducts: reference }), []);
  assert.deepEqual(guardNativeDaribarSearch(reference, "пороцетомол", true, { sourceProducts: reference }), []);
});

test("native three-vowel ambiguity is decided on full source before dose or current stock", () => {
  const candidate = product("PARA", "Парацетамол 500 мг таблетки №10");
  const ambiguous = product("OTHER", "Парацитомол 200 мг таблетки №10", { inStock: false });
  const sourceProducts = [candidate, ambiguous];
  assert.deepEqual(guardNativeDaribarSearch([candidate], "пороцетомол", false, { sourceProducts }), []);
  assert.deepEqual(guardNativeDaribarSearch([candidate], "пороцетомол 500 мг", false, { sourceProducts }), []);
});

test("an incomplete name can complete in unbound mode but not invent a constrained identity", () => {
  const safe = product("NURO", "Нурофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([safe], "нуроф"), [safe]);
  assert.deepEqual(guardNativeDaribarSearch([safe], "нуроф 200мг"), []);
});

test("resolved identity preserves typo plus dose during another-city hydration", () => {
  const reference = product("PARA", "Парацетамол таблетки 200мг №10", { price: 0, priceTBD: true });
  const live = product("PARA", "Парацетамол табл. 200 мг №10", { price: 1234, stockPharmacies: 7 });
  const other = product("OTHER", "Ибупрофен таблетки 200мг №10");
  const results = guardNativeDaribarSearch([other, live], "парацитомол 200мг таблетки", false, { resolvedProducts: [reference] });
  assert.deepEqual(results, [live]);
  assert.equal(results[0].price, 1234);
  assert.equal(results[0].stockPharmacies, 7);
});

test("resolved pharmacy identity still rejects changed current dose and form", () => {
  const reference = product("NURO", "Нурофен таблетки 200мг №10");
  for (const name of ["Нурофен таблетки 400мг №10", "Нурофен капсулы 200мг №10", "Нурофен таблетки 200мг №20"]) {
    const live = product("NURO", name);
    assert.deepEqual(guardNativeDaribarSearch([live], "нурофн 200мг таблетки №10", false, { resolvedProducts: [reference] }), []);
  }
});

test("same resolved ID cannot hide a changed drug name or supplier SKU", () => {
  const reference = product("NURO", "Нурофен таблетки 200мг");
  const renamed = product("NURO", "Норофен таблетки 200мг");
  const reusedId = { ...product("OTHER", "Нурофен таблетки 200мг"), id: reference.id };
  assert.deepEqual(guardNativeDaribarSearch([renamed, reusedId], "нурофн 200мг", false, { resolvedProducts: [reference] }), []);
});

test("resolved empty list remains empty and is not a request to broaden search", () => {
  const other = product("OTHER", "Норофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([other], "нурофн", false, { resolvedProducts: [] }), []);
});

test("explicit literal mode does not accept a resolved correction", () => {
  const safe = product("NURO", "Нурофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([safe], "нурофн", true, { resolvedProducts: [safe] }), []);
  assert.deepEqual(guardNativeDaribarSearch([safe], "нуроф", true), [safe]);
});

test("new exact native name is recognized without inventing data from the reference snapshot", () => {
  const old = product("OLD", "Нурофен таблетки 200мг");
  const live = product("NEW", "Нурофен таблетки 400мг", { price: 2300 });
  assert.deepEqual(guardNativeDaribarSearch([live], "Нурофен 400мг", false, { sourceProducts: [old] }), [live]);
});

test("changed native name cannot erase the original source identity evidence", () => {
  const old = product("SAME", "Нурофен таблетки 200мг");
  const live = product("SAME", "Норофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([live], "Нурофен", false, { sourceProducts: [old] }), []);
});

test("retired-source and missing-SKU records never survive native guarding", () => {
  const safe = product("SAFE", "Нурофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([
    { ...safe, source: "medusa" }, { ...safe, sku: undefined }, safe,
  ], "Нурофен"), [safe]);
});

test("numeric/form-only filters are enforced without pretending to identify a drug", () => {
  const safe = product("SAFE", "Нурофен таблетки 200мг");
  const wrong = product("OTHER", "Нурофен таблетки 400мг");
  assert.deepEqual(guardNativeDaribarSearch([wrong, safe], "200мг таблетки"), [safe]);
  for (const query of ["", " ", "!!!", "***"]) assert.deepEqual(guardNativeDaribarSearch([safe], query), []);
});

test("native results remain unique and retain live source data", () => {
  const safe = product("SAFE", "Нурофен таблетки 200мг");
  const live = { ...safe, price: 777 };
  assert.deepEqual(guardNativeDaribarSearch([safe, live], "Нурофен"), [live]);
});

test("reference whole-word cache invalidates when its source title changes", () => {
  const reference = product("REF", "Нурофен таблетки 200мг");
  const live = product("LIVE", "Норофен таблетки 200мг");
  assert.deepEqual(guardNativeDaribarSearch([live], "Нурофен", false, { sourceProducts: [reference] }), []);
  reference.name = "Норофен таблетки 200мг";
  assert.deepEqual(guardNativeDaribarSearch([live], "Норофен", false, { sourceProducts: [reference] }), [live]);
});
