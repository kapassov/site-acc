import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogQuery } from "../src/lib/catalog-query.ts";
import { mapDaribarProduct, projectDaribarCatalog } from "../src/lib/daribar/catalog-data.ts";
import {
  directlyMatchesProductName,
  guardNativeDaribarSearch,
  searchDaribarSnapshot,
} from "../src/lib/daribar/indexed-search.ts";
import { parseProductSearchQuery } from "../src/lib/search/product-search-model.ts";

const GENERATED_AT = new Date().toISOString();
function product(sku, name, overrides = {}) {
  const mapped = mapDaribarProduct({
    sku, name, manufacturer: "Alpha Pharma", categories_ids: ["9", "145"],
    min_customer_price: 1250, quantity: 8, ...overrides,
  });
  assert.ok(mapped);
  return mapped;
}
function source(query, products, options = {}) {
  return { query, products, city: "Алматы", generatedAt: GENERATED_AT, ...options };
}
function indexReply(ids, options = {}) {
  return { ids, total: ids.length, stale: false, collection: "test-version", metadata: {}, ...options };
}

test("an exact original name wins without requesting any typo level", async () => {
  const exact = product("EXACT", "Нурофен 200 мг таблетки №10");
  const similar = product("SIMILAR", "Норофен 200 мг таблетки №10");
  const calls = [];
  const result = await searchDaribarSnapshot(source("Нурофен", [similar, exact]), async (request) => {
    calls.push(request);
    assert.equal(request.typos, 0);
    assert.equal(request.query, "нурофен");
    return indexReply([exact.id]);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.products.map((item) => item.sku), ["EXACT"]);
  assert.equal(result.search.matchType, "exact");
  assert.equal(result.search.matchedQuery, null);
});

test("every exact spelling/layout variant is exhausted before fuzzy matches", async () => {
  const item = product("PARA", "Парацетамол 500 мг таблетки №10");
  const q = "парацитамол";
  const parsed = parseProductSearchQuery(q);
  const variants = [parsed.nameQuery, ...parsed.variants.map((variant) => variant.value).filter((value) => value !== parsed.nameQuery)].slice(0, 6);
  const calls = [];
  const result = await searchDaribarSnapshot(source(q, [item]), async (request) => {
    calls.push(request);
    return indexReply(request.typos === 1 && request.query === parsed.nameQuery ? [item.id] : []);
  });
  assert.deepEqual(calls.slice(0, variants.length).map((call) => call.query), variants);
  assert.ok(calls.slice(0, variants.length).every((call) => call.typos === 0));
  assert.equal(calls[variants.length].typos, 0);
  assert.equal(calls[variants.length].useAliases, true);
  assert.equal(calls[variants.length].prefix, false);
  assert.equal(calls[variants.length + 1].typos, 1);
  assert.equal(calls[variants.length + 1].query, parsed.nameQuery);
  assert.equal(calls.some((call) => call.typos === 2), false);
  assert.equal(result.search.matchType, "typo");
  assert.equal(result.search.matchedQuery, "Парацетамол");
});

test("three-vowel recovery retrieves only the unique literal source name after normal search", async () => {
  const item = product("PARA", "Парацетамол 500 мг таблетки №10");
  const prefixOnly = product("DIFFERENT", "Парацетамолекс 500 мг таблетки №10");
  const calls = [];
  const result = await searchDaribarSnapshot(source("пороцетомол", [item, prefixOnly]), async (request) => {
    calls.push(request);
    return indexReply(request.query === "парацетамол" ? [item.id, prefixOnly.id] : []);
  });
  assert.deepEqual(result.products, [item]);
  assert.equal(result.search.matchType, "typo");
  assert.equal(result.search.matchedQuery, "Парацетамол");
  assert.equal(calls.at(-1).query, "парацетамол");
  assert.equal(calls.at(-1).typos, 0, "the engine edit-distance limit is not increased");
  assert.ok(calls.slice(0, -1).some(call => call.typos === 2));
});

test("three-vowel recovery retains exact dosage, unit, pack and form constraints", async () => {
  const correct = product("RIGHT", "Парацетамол 200 мг таблетки №10");
  const wrongDose = product("DOSE", "Парацетамол 500 мг таблетки №10");
  const wrongForm = product("FORM", "Парацетамол 200 мг капсулы №10");
  const wrongPack = product("PACK", "Парацетамол 200 мг таблетки №20");
  const sourceItems = [correct, wrongDose, wrongForm, wrongPack];
  const engine = async request => indexReply(request.query === "парацетамол" ? sourceItems.map(item => item.id) : []);
  assert.deepEqual((await searchDaribarSnapshot(source("пороцетомол 200 мг таблетки №10", sourceItems), engine)).products, [correct]);
  for (const query of ["пороцетомол 5000 мг", "пороцетомол 200 мл", "пороцетомол мазь", "пороцетомол №30"]) {
    const result = await searchDaribarSnapshot(source(query, sourceItems), engine);
    assert.deepEqual(result.products, [], query);
    assert.equal(result.search.matchType, "none");
    assert.equal(result.search.matchedQuery, null);
  }
});

test("three-vowel recovery cannot replace an existing exact name or an ambiguous source identity", async () => {
  const intended = product("PARA", "Парацетамол 500 мг таблетки №10");
  const literal = product("EXACT", "Пороцетомол 200 мг таблетки №10");
  const exact = await searchDaribarSnapshot(source("пороцетомол 500 мг", [literal, intended]), async request => {
    assert.equal(request.query, "пороцетомол");
    assert.equal(request.typos, 0);
    return indexReply([literal.id]);
  });
  assert.deepEqual(exact.products, []);
  const ambiguous = product("OTHER", "Парацитомол 200 мг таблетки №10");
  const result = await searchDaribarSnapshot(source("пороцетомол 500 мг", [intended, ambiguous]), async request => {
    assert.notEqual(request.query, "парацетамол");
    return indexReply([]);
  });
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchedQuery, null);
});

test("literal mode never enables the three-vowel recovery", async () => {
  const item = product("PARA", "Парацетамол 500 мг таблетки №10");
  let calls = 0;
  const result = await searchDaribarSnapshot(source("пороцетомол", [item], { exact: true }), async request => {
    calls += 1;
    assert.equal(request.query, "пороцетомол");
    return indexReply([]);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.products, []);
});

test("a verified zero from all passes remains zero and never becomes an exception/fallback", async () => {
  const item = product("ONE", "Парацетамол 500 мг таблетки №10");
  let calls = 0;
  const result = await searchDaribarSnapshot(source("несуществующийпрепарат", [item]), async () => {
    calls += 1;
    return indexReply([], { stale: true });
  });
  assert.ok(calls > 0 && calls <= 19);
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchType, "none");
  assert.equal(result.search.degraded, false);
  assert.equal(result.stale, true);
});

test("a name resolves before dose/form filtering while city and snapshot always reach the engine", async () => {
  const item = product("SAFE", "Нурофен 200 мг таблетки №10");
  const q = "нурофн 200 мг таблетки №10";
  await searchDaribarSnapshot(source(q, [item]), async (request) => {
    assert.equal(request.expectedCity, "Алматы");
    assert.equal(request.expectedGeneratedAt, GENERATED_AT);
    assert.deepEqual(request.numbers, []);
    assert.deepEqual(request.forms, []);
    assert.ok(!request.query.includes("200"));
    assert.ok(!request.query.includes("таблет"));
    return indexReply(request.typos > 0 ? [item.id] : []);
  });
});

test("an existing exact name with unavailable dose must stop before another medicine can satisfy it", async () => {
  const named = product("NURO", "Нурофен 200 мг таблетки №10");
  const other = product("NORO", "Норофен 400 мг таблетки №10");
  let calls = 0;
  const result = await searchDaribarSnapshot(source("нурофен 400 мг таблетки №10", [named, other]), async (request) => {
    calls += 1;
    assert.equal(calls, 1, "a known name must not advance to aliases, another layout or typos just to satisfy dose");
    assert.equal(request.useAliases, false);
    assert.deepEqual(request.numbers, []);
    return indexReply([named.id]);
  });
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchType, "none");
  assert.equal(result.search.matchedQuery, null);
  assert.equal(result.search.degraded, false);
});

test("whole-name identity precedes prefix completions and cannot change to satisfy a requested form", async () => {
  const named = product("LOR", "Лоратадин 10 мг таблетки №10");
  const related = product("GRIP", "Гриппферон с лоратадином мазь 5 г");
  let calls = 0;
  const result = await searchDaribarSnapshot(source("лоратадин мазь", [named, related]), async () => {
    calls += 1;
    return indexReply([related.id, named.id]);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.products, []);
  assert.equal(result.search.matchType, "none");
});

test("numeric/form-only queries retain their exact filters instead of querying the whole index", async () => {
  const named = product("NURO", "Нурофен 200 мг таблетки №10");
  const parsed = parseProductSearchQuery("200 мг таблетки");
  const result = await searchDaribarSnapshot(source("200 мг таблетки", [named]), async (request) => {
    assert.equal(request.query, "");
    assert.deepEqual(request.numbers, parsed.numbers);
    assert.deepEqual(request.forms, ["tablet"]);
    return indexReply([named.id]);
  });
  assert.deepEqual(result.products.map((item) => item.sku), ["NURO"]);
});

test("a transliterated label is kept alongside plausible literal-name typos, without auto-correcting ambiguity", async () => {
  const latin = product("LINX", "LinX капсулы №10");
  const russian = product("LINEX", "Линекс капсулы №10");
  const result = await searchDaribarSnapshot(source("линкс", [latin, russian]), async (request) => {
    if (request.useAliases) {
      assert.equal(request.typos, 0);
      assert.equal(request.prefix, false);
      return indexReply([latin.id]);
    }
    return indexReply(request.typos === 1 && request.query === "линкс" ? [russian.id] : []);
  });
  assert.deepEqual(result.products.map((item) => item.sku), ["LINEX", "LINX"]);
  assert.equal(result.search.matchedQuery, null);
});

test("alias-only candidates are an explicit possibility, never a confident automatic correction", async () => {
  const latin = product("UNIQUE", "UniqueBrand капсулы №10");
  const result = await searchDaribarSnapshot(source("уникальныйбренд", [latin]), async (request) =>
    indexReply(request.useAliases ? [latin.id] : []));
  assert.deepEqual(result.products.map((item) => item.sku), ["UNIQUE"]);
  assert.equal(result.search.matchType, "alias");
  assert.equal(result.search.matchedQuery, null);
});

test("hydration independently rejects wrong dose, unit, pack and form despite engine hits", async () => {
  const safe = product("SAFE", "Нурофен 200 мг таблетки №10");
  const wrongDose = product("DOSE", "Нурофен 400 мг таблетки №10");
  const wrongUnit = product("UNIT", "Нурофен 200 мкг таблетки №10");
  const wrongPack = product("PACK", "Нурофен 200 мг таблетки №20");
  const wrongForm = product("FORM", "Нурофен 200 мг капсулы №10");
  const candidates = [wrongDose, safe, wrongUnit, wrongPack, wrongForm];
  const result = await searchDaribarSnapshot(source("нурофн 200 мг таблетки №10", candidates), async (request) =>
    indexReply(request.typos > 0 ? candidates.map((item) => item.id) : []));
  assert.deepEqual(result.products.map((item) => item.sku), ["SAFE"]);
  assert.equal(result.search.matchedQuery, null, "never rewrite explicit dosage/form query text");
});

test("even a name-only query may only hydrate existing Daribar identities", async () => {
  const authoritative = product("SAFE", "Нурофен 200 мг таблетки №10", { min_customer_price: 3210, quantity: 2 });
  const foreignShadow = { ...authoritative, source: "medusa", price: 1, image: "https://untrusted.invalid/a.png" };
  const result = await searchDaribarSnapshot(source("Нурофен", [authoritative, foreignShadow]), async () => ({
    ...indexReply([authoritative.id]),
    products: [{ id: authoritative.id, price: 9, stock: 999, image: "https://untrusted.invalid/b.png" }],
  }));
  assert.equal(result.products[0], authoritative);
  assert.equal(result.products[0].price, 3210);
  assert.equal(result.products[0].image, "/api/media/daribar?sku=SAFE");
});

test("unknown, retired-source and missing-SKU identities fail rather than inventing cards", async () => {
  const authoritative = product("SAFE", "Нурофен 200 мг таблетки №10");
  for (const [products, hit] of [
    [[authoritative], "prod_unknown"],
    [[{ ...authoritative, source: "medusa" }], authoritative.id],
    [[{ ...authoritative, sku: undefined }], authoritative.id],
  ]) {
    await assert.rejects(() => searchDaribarSnapshot(source("Нурофен", products), async () => indexReply([hit])), /daribar_search_index_product_mismatch/);
  }
});

test("literal mode performs exactly one original request without aliases or typo expansion", async () => {
  const item = product("PARA", "Парацетамол 500 мг таблетки №10");
  const calls = [];
  const result = await searchDaribarSnapshot(source("paracetamol", [item], { exact: true }), async (request) => {
    calls.push(request);
    return indexReply([item.id]);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, "paracetamol");
  assert.equal(calls[0].typos, 0);
  assert.equal(calls[0].useAliases, false);
  assert.deepEqual(result.products, []);
});

test("literal mode rejects provider/index spelling correction but retains genuine name prefix", async () => {
  const item = product("NURO", "Нурофен 200 мг таблетки №10");
  assert.equal(directlyMatchesProductName(item, "нурофн"), false);
  assert.equal(directlyMatchesProductName(item, "нуроф"), true);
  assert.equal(directlyMatchesProductName(item, "нуроф 400 мг"), false);
  const result = await searchDaribarSnapshot(source("нурофн", [item], { exact: true }), async () => indexReply([item.id]));
  assert.deepEqual(result.products, []);
});

test("short medication labels are not fuzzily rewritten", async () => {
  const item = product("SHORT", "Но-шпа 40 мг таблетки №24");
  const calls = [];
  await searchDaribarSnapshot(source("йод", [item]), async (request) => { calls.push(request); return indexReply([]); });
  assert.equal(calls.length, 1);
  assert.ok(calls.every((request) => request.typos === 0));
});

test("empty or punctuation-only input does not issue an unfiltered wildcard query", async () => {
  for (const query of ["", " ", "***", "!!!"]) {
    const result = await searchDaribarSnapshot(source(query, []), async () => { assert.fail("engine should not be called"); });
    assert.deepEqual(result.products, []);
  }
});

test("ambiguous similar labels are not presented as one silently corrected name", async () => {
  const first = product("A", "Нурофен 200 мг таблетки №10");
  const second = product("B", "Норофен 200 мг таблетки №10");
  const result = await searchDaribarSnapshot(source("нарофен", [first, second]), async (request) =>
    indexReply(request.typos > 0 ? [first.id, second.id] : []));
  assert.equal(result.products.length, 2);
  assert.equal(result.search.matchType, "typo");
  assert.equal(result.search.matchedQuery, null);
});

test("Daribar native fallback enforces source and exact numeric/form guards too", () => {
  const safe = product("SAFE", "Нурофен 200 мг таблетки №10");
  const wrong = product("WRONG", "Нурофен 400 мг капсулы №20");
  const foreign = { ...safe, source: "medusa" };
  assert.deepEqual(guardNativeDaribarSearch([wrong, foreign, safe], "Нурофен 200 мг таблетки №10").map((item) => item.sku), ["SAFE"]);
  assert.deepEqual(guardNativeDaribarSearch([wrong, foreign, safe], "нурофн 200 мг таблетки №10"), [], "unbound typo plus dose must not rescue another medication");
  assert.deepEqual(guardNativeDaribarSearch([wrong, foreign, safe], "нурофн 200 мг таблетки №10", false, { resolvedProducts: [safe] }).map((item) => item.sku), ["SAFE"]);
  assert.deepEqual(guardNativeDaribarSearch([safe], "нурофн", true), []);
});

test("every ranked ID survives hydration, filters and pagination past the first 200 hits", async () => {
  const products = Array.from({ length: 345 }, (_, index) => product(`SKU-${index}`, "Парацетамол 500 мг таблетки №10", {
    manufacturer: index % 2 ? "Beta Labs" : "Alpha Pharma", min_customer_price: 500 + index,
  }));
  const ranked = [...products].reverse();
  const result = await searchDaribarSnapshot(source("парацитамол", products), async (request) =>
    indexReply(request.typos > 0 ? ranked.map((item) => item.id) : []));
  assert.equal(result.products.length, 345);
  const params = new URLSearchParams({ q: "парацитамол", limit: "24", offset: "240", sort: "relevance" });
  const projection = projectDaribarCatalog(result.products, parseCatalogQuery(params), true);
  assert.equal(projection.matched.length, 345);
  assert.deepEqual(projection.products.map((item) => item.id), ranked.slice(240, 264).map((item) => item.id));
  assert.equal(projection.facets.categories.find((category) => category.slug === "lekarstva-i-bady").count, 345);
  assert.equal(projection.facets.brands.find((brand) => brand.key === "beta-labs").count, 172);
  assert.deepEqual(projection.facets.price, { min: 500, max: 844, unknown: 0 });

  params.set("brand", "beta-labs");
  params.set("offset", "150");
  const filtered = projectDaribarCatalog(result.products, parseCatalogQuery(params), true);
  const expected = ranked.filter((item) => item.brand === "Beta Labs");
  assert.equal(filtered.matched.length, expected.length);
  assert.deepEqual(filtered.products.map((item) => item.id), expected.slice(150, 174).map((item) => item.id));
});

test("explicit price sorting remains authoritative after relevance matching", async () => {
  const first = product("A", "Парацетамол 500 мг таблетки №10", { min_customer_price: 2000 });
  const second = product("B", "Парацетамол 500 мг таблетки №10", { min_customer_price: 500 });
  const result = await searchDaribarSnapshot(source("парацитомол", [first, second]), async (request) =>
    indexReply(request.typos > 0 ? [first.id, second.id] : []));
  const query = parseCatalogQuery(new URLSearchParams({ q: "парацитомол", sort: "price_asc", limit: "1" }));
  const projection = projectDaribarCatalog(result.products, query, true);
  assert.deepEqual(projection.products.map((item) => item.sku), ["B"]);
  assert.equal(projection.facets.price.min, 500);
});

test("transport/index failure propagates distinctly from verified no-match", async () => {
  await assert.rejects(() => searchDaribarSnapshot(source("нурофен", []), async () => {
    throw new Error("typesense_timeout");
  }), /typesense_timeout/);
});

test("all sequential spelling passes share one deadline and receive only remaining budget", async () => {
  const originalNow = Date.now;
  let clock = 1_000_000;
  const budgets = [];
  Date.now = () => clock;
  try {
    await assert.rejects(() => searchDaribarSnapshot(source("несуществующийпрепарат", []), async (request) => {
      budgets.push(request.timeoutMs);
      clock += 1600;
      return indexReply([]);
    }), /daribar_search_deadline_exceeded/);
    assert.deepEqual(budgets, [4000, 2400, 800]);
  } finally {
    Date.now = originalNow;
  }
});

test("explicit orchestration timeout is clamped rather than multiplying across variants", async () => {
  const originalNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    for (const [requested, expected] of [[999_999, 8000], [-10, 100], [1500, 1500]]) {
      const budgets = [];
      await assert.rejects(() => searchDaribarSnapshot(source("несуществующийпрепарат", [], { timeoutMs: requested }), async (request) => {
        budgets.push(request.timeoutMs);
        clock += 10_000;
        return indexReply([]);
      }), /daribar_search_deadline_exceeded/);
      assert.deepEqual(budgets, [expected]);
    }
  } finally {
    Date.now = originalNow;
  }
});
