import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_SEARCH_MODEL_VERSION,
  createProductSearchDocument,
  matchesProductSearchConstraints,
  normalizeProductSearchText,
  parseProductSearchQuery,
  resolveSourceVowelCorrection,
} from "../src/lib/search/product-search-model.ts";

function product(name, extra = {}) {
  return {
    id: "daribar_123", sku: "123", source: "daribar", slug: "test", name,
    brand: "Тест", categorySlug: "lekarstva", price: 1500, rating: 0, reviews: 0,
    badges: [], art: { kind: "box", hue: 140 }, inStock: true, stockPharmacies: 4,
    ...extra,
  };
}

test("three confused vowels resolve a unique long source name without stored typo aliases", () => {
  const source = [product("Парацетамол 200 мг таблетки №10"), product("Парацетамол 500 мг таблетки №20")];
  assert.equal(resolveSourceVowelCorrection("пороцетомол", source), "парацетамол");
  assert.equal(resolveSourceVowelCorrection("пороцитамол", source), "парацетамол");
  assert.equal(resolveSourceVowelCorrection("парацетамол", source), null);
  assert.equal(resolveSourceVowelCorrection("парацитомол", source), null, "normal two-edit search owns closer spellings");
});

test("vowel recovery preserves consonants, length, number tokens and explicit name qualifiers", () => {
  const source = [product("Парацетамол 500 мг таблетки №10")];
  for (const query of ["пороцетонол", "пороцетомо", "пороцитомол", "пороцетомол форте", "пороцетомол500", "пор", "porocetomol"]) {
    assert.equal(resolveSourceVowelCorrection(query, source), null, query);
  }
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [product("Другой препарат с парацетамолом")]), null);
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [product("Парацетамол 500 мг", { source: "legacy" })]), null);
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [product("Парацетамол 500 мг", { sku: "" })]), null);
});

test("vowel correction refuses multiple source names and prefers neither price nor stock", () => {
  const intended = product("Парацетамол 500 мг таблетки №10");
  const alternative = product("Парацитомол 200 мг таблетки №10", { inStock: false, price: 0 });
  for (const source of [[intended, alternative], [alternative, intended]]) {
    assert.equal(resolveSourceVowelCorrection("пороцетомол", source), null);
  }
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [intended, product("Порацетомол 10 мг")]), null,
    "closer source spelling must be handled by ordinary search");
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [intended, product("Тест пороцетомол 10 мг")]), null,
    "a literal existing name wins even outside the leading word");
});

test("source vowel cache follows renamed source products", () => {
  const item = product("Парацетамол 500 мг таблетки №10");
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [item]), "парацетамол");
  item.name = "Ибупрофен 400 мг таблетки №10";
  assert.equal(resolveSourceVowelCorrection("пороцетомол", [item]), null);
});

test("a long query cannot degrade into single-letter search terms after keyboard conversion", () => {
  for (const query of ["ыъыъыъыъыъ", "ыъыъ", "ыъыъыъыъыъ 500 мг таблетки"]) {
    const parsed = parseProductSearchQuery(query);
    assert.ok(parsed.variants.every(variant => /[\p{L}\p{N}]{2,}/u.test(variant.value)), query);
    assert.ok(!parsed.variants.some(variant => /^(?:s\s*)+$/u.test(variant.value)), query);
    assert.equal(parsed.variants[0].value, parsed.nameQuery);
  }
  const constrained = parseProductSearchQuery("ыъыъыъыъыъ 500 мг таблетки");
  assert.deepEqual(constrained.numbers, ["mg:500"]);
  assert.deepEqual(constrained.forms, ["tablet"]);
});

test("initials and vitamin letter/number names survive the query-only variant guard", () => {
  for (const [query, original, expectedVariant] of [
    ["витамин D", "витамин d", "vitamin d"],
    ["витамин Д3", "витамин d3", "vitamin d3"],
    ["S-фактор", "s фактор", "s faktor"],
    ["[kjhutrcblby", "kjhutrcblby", "хлоргексидин"],
  ]) {
    const parsed = parseProductSearchQuery(query);
    assert.equal(parsed.nameQuery, original);
    assert.ok(parsed.variants.some(variant => variant.value === expectedVariant), query);
  }
  for (const query of ["D", "Д3", "B12", "S"]) {
    const parsed = parseProductSearchQuery(query);
    assert.ok(parsed.variants.some(variant => variant.kind === "original" && variant.value === parsed.nameQuery), query);
  }
  assert.deepEqual(parseProductSearchQuery("витамин Д3").numbers, ["alnum:d3"]);
  const document = createProductSearchDocument(product("Ыъыъыъыъыъ"));
  assert.deepEqual(document.aliases, ["yyyyy"], "source index aliases do not change for the query-only guard");
  assert.equal(PRODUCT_SEARCH_MODEL_VERSION, "2026-08-27.2");
});

const normalizationCases = [
  ["  НУРОФЕН   ", "нурофен"],
  ["Зелёнка", "зеленка"],
  ["Нурофен®", "нурофен"],
  ["нурoфен", "нурофен"],
  ["нуpoфен", "нурофен"],
  ["Нyрофен", "нурофен"],
  ["парацетaмол", "парацетамол"],
  ["Нуроfен", "нурофен"],
  ["Ivаtherm", "ivatherm"],
  ["ПептидБио", "пептид био"],
  ["PEPTIDEBIO", "peptide bio"],
  ["0,5 мг", "0.5 мг"],
  ["Ｎｕｒｏｆｅｎ", "nurofen"],
  ["СПФ 50", "spf50"],
  ["витамин В12", "витамин b12"],
  ["витамин Д3", "витамин d3"],
];
for (const [input, expected] of normalizationCases) {
  test(`product search normalization: ${input}`, () => {
    assert.equal(normalizeProductSearchText(input), expected);
  });
}

const aliasCases = [
  ["paracetamol", "парацетамол"],
  ["nurofen", "нурофен"],
  ["ibuprofen", "ибупрофен"],
  ["aspirin", "аспирин"],
  ["amoxicillin", "амоксициллин"],
  ["smecta", "смекта"],
  ["theraflu", "терафлю"],
  ["ivatherm", "иватерм"],
  ["peptidebio", "пептид био"],
  ["Парацетамол", "paracetamol"],
];
for (const [input, expected] of aliasCases) {
  test(`same-label alias: ${input} -> ${expected}`, () => {
    assert.ok(parseProductSearchQuery(input).variants.some((variant) => variant.kind === "alias" && variant.value === expected));
  });
}

test("aliases never replace a brand with its ingredient or a therapeutic alternative", () => {
  const variants = parseProductSearchQuery("Нурофен").variants;
  assert.ok(!variants.some(({ value }) => /ибупрофен|ibuprofen|парацетамол|paracetamol|панадол|panadol/.test(value)));
  const indexed = createProductSearchDocument(product("Нурофен таблетки 200 мг", { mnn: "Ибупрофен", description: "Парацетамол" }));
  assert.ok(!indexed.aliases.some((value) => /ибупрофен|ibuprofen|парацетамол|paracetamol/.test(value)));
});

const layoutCases = [
  ["yehjaty", "нурофен"],
  ["gfhfwtnfvjk", "парацетамол"],
  ["b,eghjaty", "ибупрофен"],
  ["b,eghjaty 50 mg tablets", "ибупрофен"],
  ["yehjaty 50 мг", "нурофен"],
  ["шмферукь", "ivatherm"],
];
for (const [input, expected] of layoutCases) {
  test(`keyboard-layout name variant: ${input}`, () => {
    assert.ok(parseProductSearchQuery(input).variants.some((variant) => variant.kind === "layout" && variant.value === expected));
  });
}

test("layout cannot silently reinterpret mistyped quantity units", () => {
  const parsed = parseProductSearchQuery("yehjaty 50 vu");
  assert.ok(!parsed.variants.some((variant) => variant.kind === "layout"));
  assert.deepEqual(parsed.numbers, ["n:50"]);
});

test("transliteration indexes full label variants, not only the drug fragment", () => {
  const document = createProductSearchDocument(product("Парацетамол Экстра таблетки 500 мг №10"));
  assert.ok(document.aliases.includes("paratsetamol ekstra tabletki 500 mg # 10"));
  assert.ok(document.aliases.includes("paracetamol ekstra tabletki 500 mg # 10"));
  assert.ok(document.aliases.every((alias) => alias.includes("500") && alias.includes("10")));
});

test("name and exact constraints are separated without dropping modifiers", () => {
  const parsed = parseProductSearchQuery("  Нурофен Форте таблетки 400 мг №12  ");
  assert.equal(parsed.original, "Нурофен Форте таблетки 400 мг №12");
  assert.equal(parsed.nameQuery, "нурофен форте");
  assert.deepEqual(parsed.numbers, ["count:12", "mg:400"]);
  assert.deepEqual(parsed.forms, ["tablet"]);
  assert.equal(parsed.variants[0].value, "нурофен форте");
  assert.equal(parsed.variants[0].kind, "original");
  assert.ok(parsed.variants.every(({ value }) => !/400|12|таблетки/.test(value)));
});

test("misspelled medicine names stay untouched for Typesense typo matching", () => {
  assert.equal(parseProductSearchQuery("парацитомол").variants[0].value, "парацитомол");
  assert.equal(parseProductSearchQuery("нурофн").variants[0].value, "нурофн");
});

for (const input of ["ри", "нам", "no", "B12", "Д3", "", "  "]) {
  test(`short or empty names do not broaden: ${JSON.stringify(input)}`, () => {
    const parsed = parseProductSearchQuery(input);
    assert.ok(parsed.variants.length <= 1);
    if (parsed.variants.length) assert.equal(parsed.variants[0].kind, "original");
  });
}

const quantityCases = [
  ["Нурофен 50 мг", "Нурофен 50 мг №20", true],
  ["Нурофен 50 мг", "Нурофен 500 мг №20", false],
  ["Нурофен 50 мг", "Нурофен 500 мг №50", false],
  ["Нурофен 50 мл", "Нурофен 50 мг №20", false],
  ["Нурофен 50 мл", "Нурофен 100 мг/5 мл 50 мл", true],
  ["Нурофен 5 мл", "Нурофен 100 мг/5 мл 150 мл", false],
  ["Нурофен 100 мг/5 мл", "Нурофен 100mg / 5ml 150 мл", true],
  ["Нурофен 100 мг/5 мл", "Нурофен 100 мг/1 мл 150 мл", false],
  ["Нурофен 100 мг/мл", "Нурофен 100 мг/1 мл 150 мл", true],
  ["Нурофен 100 мг", "Нурофен 100 мг/5 мл 150 мл", false],
  ["Нурофен 100 мг/5 мл 50 мл", "Нурофен 100 мг/5 мл 150 мл", false],
  ["Парацетамол 0,5 г", "Парацетамол 0.500 г №10", true],
  ["Парацетамол .5 г", "Парацетамол 0,5 г №10", true],
  ["Парацетамол 0,5 г", "Парацетамол 500 мг №10", false],
  ["Парацетамол 00500.00 мг", "Парацетамол 500 мг №10", true],
  ["Нурофен 50", "Нурофен 500 мг №20", false],
  ["Нурофен 50", "Нурофен 50 мг №20", true],
  ["Нурофен50mg", "Нурофен 50 мг №20", true],
  ["Нурофен №50", "Нурофен 50 мг №20", false],
  ["Нурофен №20", "Нурофен 50 мг №20", true],
  ["Нурофен N20", "Нурофен 50 мг №20", true],
  ["Нурофен No. 20", "Нурофен 50 мг №20", true],
  ["Нурофен N°20", "Нурофен 50 мг №20", true],
  ["Нурофен номер20", "Нурофен 50 мг №20", true],
  ["Нурофен 20 шт", "Нурофен 50 мг №20", true],
  ["Нурофен 20 таблеток", "Нурофен таблетки 50 мг №20", true],
  ["Нурофен 20 таблеток", "Нурофен таблетки 20 мг №50", false],
  ["Назонекс 120 доз", "Назонекс спрей 120 доз №1", true],
  ["Назонекс 120 доз", "Назонекс спрей 60 доз №120", false],
  ["Амоксиклав 875 + 125 мг", "Амоксиклав таблетки 875мг+125мг №14", true],
  ["Амоксиклав 875 + 250 мг", "Амоксиклав таблетки 875мг+125мг №14", false],
  ["Амоксиклав 875 мг", "Амоксиклав таблетки 875+125 мг №14", true],
  ["Натрия хлорид 0,9%", "Натрия хлорид раствор 0.9% 100 мл", true],
  ["Натрия хлорид 9%", "Натрия хлорид раствор 0.9% 100 мл", false],
  ["Витамин 400 МЕ", "Витамин 400 IU №30", true],
  ["Витамин 400 МЕ", "Витамин 400 мкг №30", false],
  ["Витамин 50 мкг", "Витамин 50mcg №30", true],
  ["Витамин 50 мкг", "Витамин 50mg №30", false],
  ["Витамин B12", "Витамин В12 50 мкг", true],
  ["Витамин B12", "Витамин В-12 50 мкг", true],
  ["Витамин B12", "Витамин B1 50 мкг №12", false],
  ["Витамин Д3", "Витамин D3 №30", true],
  ["Витамин Д3", "Витамин D-3 №30", true],
  ["Витамин D3", "Витамин D30 №3", false],
  ["Ivatherm SPF50", "Ivatherm крем SPF 50 50 мл", true],
  ["Ivatherm SPF50", "Ivatherm крем SPF-50 50 мл", true],
  ["Ivatherm SPF50", "Ivatherm крем SPF5 50 мл", false],
  ["Ivatherm SPF50 50 мл", "Ivatherm крем SPF50 150 мл", false],
];
for (const [query, label, expected] of quantityCases) {
  test(`exact dose/volume/package: ${query} vs ${label} -> ${expected}`, () => {
    const parsed = parseProductSearchQuery(query);
    assert.equal(matchesProductSearchConstraints(product(label), parsed), expected);
    assert.equal(matchesProductSearchConstraints(createProductSearchDocument(product(label)), parsed), expected);
  });
}

const formCases = [
  ["Нурофен таблетки", "Нурофен табл. 200 мг №10", true],
  ["Нурофен таблетки", "Нурофен сироп 200 мл", false],
  ["Нурофен таблетки", "Нурофен капсулы 200 мг №10", false],
  ["Нурофен таблетки", "Нурофен 200 мг №10", false],
  ["Нурофен capsules", "Нурофен капс. 200 мг №10", true],
  ["Нурофен tabl", "Нурофен таблетки 200 мг №10", true],
  ["Нурофен сироп", "Нурофен суспензия 100 мл", false],
  ["Нурофен суспензия", "Нурофен сусп. 100 мл", true],
  ["Нурофен капли", "Нурофен капл. 15 мл", true],
  ["Нурофен спрей", "Нурофен капли 15 мл", false],
  ["Нурофен раствор", "Нурофен р/р 15 мл", true],
  ["Нурофен свечи", "Нурофен супп. 60 мг №10", true],
  ["Нурофен крем", "Нурофен мазь 20 г", false],
  ["Нурофен гель", "Нурофен крем 20 г", false],
  ["Нурофен таблетки капсулы", "Нурофен таблетки 200 мг", false],
  ["Тест капли глазные", "Тест капли глазн. 15 мл", true],
  ["Тест капли глазные", "Тест капли глз. 15 мл", false],
  ["Тест капли глазные", "Тест глазные капли 15 мл", true],
  ["Тест капли глазные", "Тест ушные капли 15 мл", false],
  ["Тест спрей назальный", "Тест спрей наз. 15 мл", true],
  ["Тест свечи ректальные", "Тест супп. вагинальные №10", false],
];
for (const [query, label, expected] of formCases) {
  test(`explicit medicine form: ${query} vs ${label} -> ${expected}`, () => {
    assert.equal(matchesProductSearchConstraints(product(label), parseProductSearchQuery(query)), expected);
  });
}

test("unknown/misspelled forms are not silently removed or interpreted", () => {
  const parsed = parseProductSearchQuery("Нурофен сирп");
  assert.deepEqual(parsed.forms, []);
  assert.equal(parsed.nameQuery, "нурофен сирп");
});

test("absent source dosage/form is not invented from metadata", () => {
  const item = product("Нурофен", { volume: "50 мг", description: "таблетки 50 мг", mnn: "Ибупрофен 50 мг" });
  assert.equal(matchesProductSearchConstraints(item, parseProductSearchQuery("Нурофен таблетки 50 мг")), false);
});

test("unconstrained names permit all forms; matcher is a guard, not a name search", () => {
  assert.equal(matchesProductSearchConstraints(product("Нурофен сироп 100 мл"), parseProductSearchQuery("Нурофен")), true);
});

test("hydration guard rejects a changed source dosage even if old index matched", () => {
  const parsed = parseProductSearchQuery("Нурофен таблетки 50 мг");
  const before = createProductSearchDocument(product("Нурофен таблетки 50 мг"));
  const after = product("Нурофен таблетки 500 мг");
  assert.equal(matchesProductSearchConstraints(before, parsed), true);
  assert.equal(matchesProductSearchConstraints(after, parsed), false);
});

test("index is deterministic, versioned, immutable and has no price/stock/description data", () => {
  assert.match(PRODUCT_SEARCH_MODEL_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  const item = Object.freeze(product("Парацетамол 500 мг №10", { description: "Описание", image: "https://example.test/image.jpg" }));
  const document = createProductSearchDocument(item);
  assert.deepEqual(document, createProductSearchDocument(item));
  assert.deepEqual(Object.keys(document).sort(), ["id", "sku", "name", "normalized_name", "aliases", "numbers", "forms"].sort());
  assert.equal(document.id, item.id);
  assert.equal(document.sku, item.sku);
  assert.equal(document.name, item.name);
  assert.equal(new Set(document.aliases).size, document.aliases.length);
  assert.equal(new Set(document.numbers).size, document.numbers.length);
});

test("all digits/form only input never creates a wildcard name variant", () => {
  const parsed = parseProductSearchQuery("таблетки 50 мг №20");
  assert.equal(parsed.nameQuery, "");
  assert.deepEqual(parsed.variants, []);
  assert.deepEqual(parsed.numbers, ["count:20", "mg:50"]);
  assert.deepEqual(parsed.forms, ["tablet"]);
});

for (const [label, expectedName, expectedKey, inventedCount, form] of [
  ["Витамин B12 капсулы №30", "витамин b12", "alnum:b12", "count:12", "capsule"],
  ["Витамин B12капсулы №30", "витамин b12", "alnum:b12", "count:12", "capsule"],
  ["Витамин Д3 таблетки №30", "витамин d3", "alnum:d3", "count:3", "tablet"],
  ["Витамин Д3таблетки №30", "витамин d3", "alnum:d3", "count:3", "tablet"],
]) {
  test(`a number in the product label is not converted into pack count: ${label}`, () => {
    const item = product(label);
    const document = createProductSearchDocument(item);
    assert.ok(document.numbers.includes(expectedKey));
    assert.ok(!document.numbers.includes(inventedCount));
    assert.ok(document.numbers.includes("count:30"));
    assert.ok(document.forms.includes(form));
    assert.equal(parseProductSearchQuery(label).nameQuery, expectedName);
    assert.equal(matchesProductSearchConstraints(item, parseProductSearchQuery(expectedName)), true);
  });
}

test("explicit standalone numbers before forms still mean pack count", () => {
  const capsules = createProductSearchDocument(product("Витамин B12 12 капсул"));
  assert.ok(capsules.numbers.includes("alnum:b12"));
  assert.ok(capsules.numbers.includes("count:12"));
  const tablets = createProductSearchDocument(product("Витамин Д3 3таблетки"));
  assert.ok(tablets.numbers.includes("alnum:d3"));
  assert.ok(tablets.numbers.includes("count:3"));
});

test("untrusted query punctuation cannot become Typesense filter expressions", () => {
  const parsed = parseProductSearchQuery("Нурофен 50 мг && in_stock:=true || id:*");
  assert.deepEqual(parsed.numbers, ["mg:50"]);
  assert.ok(parsed.variants.every(({ value }) => !/[&|:=*]/.test(value)));
});
