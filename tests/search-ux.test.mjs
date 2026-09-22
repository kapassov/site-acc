import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { correctedSearchQuery, hasUncertainSearchMatch, readSearchFeedback, searchResultsHref } from "../src/components/search/search-feedback.ts";
import { dict } from "../src/lib/i18n/dict.ts";

const readSource = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const bar = readSource("components/layout/SearchBar.tsx");
const results = readSource("components/search/SearchResults.tsx");
const catalog = readSource("components/catalog/CatalogView.tsx");
const feedback = readSource("components/search/SearchFeedback.tsx");

const metadata = (overrides = {}) => ({ query: "нурофн", matchedQuery: "Нурофен", matchType: "typo", degraded: false, ...overrides });

test("search feedback accepts only metadata belonging to the visible query", () => {
  assert.deepEqual(readSearchFeedback(metadata(), "нурофн"), metadata());
  assert.deepEqual(readSearchFeedback(metadata(), "  НУРОФН  "), metadata());
  assert.equal(readSearchFeedback(metadata(), "другой препарат"), null);
  assert.equal(readSearchFeedback(null, "нурофн"), null);
  assert.equal(readSearchFeedback({ query: "нурофн" }, "нурофн"), null);
  assert.equal(readSearchFeedback(metadata({ matchType: "guess" }), "нурофн"), null);
  assert.equal(readSearchFeedback(metadata({ matchedQuery: 123 }), "нурофн"), null);
  assert.equal(readSearchFeedback(metadata({ degraded: "false" }), "нурофн"), null);
});

test("unambiguous corrected text comes from the server, never from the first product", () => {
  assert.equal(correctedSearchQuery(metadata()), "Нурофен");
  for (const matchType of ["alias", "layout", "transliteration"]) {
    assert.equal(correctedSearchQuery(metadata({ matchType })), "Нурофен");
  }
  assert.equal(correctedSearchQuery(metadata({ matchedQuery: null })), null);
  assert.equal(correctedSearchQuery(metadata({ matchedQuery: "  " })), null);
  assert.equal(correctedSearchQuery(metadata({ query: " НУРОФЕН " })), null);
  assert.equal(correctedSearchQuery(metadata({ matchType: "exact" })), null);
  assert.equal(correctedSearchQuery(metadata({ matchType: "none" })), null);
  assert.equal(correctedSearchQuery(metadata({ degraded: true })), null);
  assert.equal(correctedSearchQuery(null), null);
});

test("original-query links preserve selected city, pharmacies and dose text", () => {
  const href = searchResultsHref(" нурофн 200 мг ", { city: "Астана", pharmacies: ["123", "456"], exact: true });
  const params = new URL(href, "https://example.test").searchParams;
  assert.equal(params.get("q"), "нурофн 200 мг");
  assert.equal(params.get("city"), "Астана");
  assert.deepEqual(params.getAll("pharmacy"), ["123", "456"]);
  assert.equal(params.get("exact"), "1");
  assert.equal(new URL(searchResultsHref("нурофн"), "https://example.test").searchParams.has("exact"), false);
});

test("uncertain aliases, keyboard layouts and transliterations get the same cautious feedback as typos", () => {
  for (const matchType of ["typo", "alias", "layout", "transliteration"]) {
    const uncertain = metadata({ matchType, matchedQuery: null });
    assert.equal(correctedSearchQuery(uncertain), null);
    assert.equal(hasUncertainSearchMatch(uncertain), true, matchType);
    assert.equal(hasUncertainSearchMatch(metadata({ matchType })), false, "a verified canonical label uses explicit correction feedback");
    assert.equal(hasUncertainSearchMatch(metadata({ matchType, matchedQuery: null, degraded: true })), false);
  }
  assert.equal(hasUncertainSearchMatch(metadata({ matchType: "exact", matchedQuery: null })), false);
  assert.equal(hasUncertainSearchMatch(metadata({ matchType: "none", matchedQuery: null })), false);
  assert.equal(hasUncertainSearchMatch(null), false);
  const linx = { query: "линкс", matchedQuery: null, matchType: "alias", degraded: false };
  assert.equal(hasUncertainSearchMatch(linx), true);
  assert.equal(correctedSearchQuery(linx), null, "never assert Microtech as the correction for LinX");
});

test("typed text is URL-encoded and cannot become a navigation destination", () => {
  const query = 'javascript:alert(1)&exact=0#<img src=x onerror=alert(1)>';
  const href = searchResultsHref(query, { exact: true });
  const url = new URL(href, "https://example.test");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), query);
  assert.equal(url.searchParams.get("exact"), "1");
  assert.equal(url.hash, "");
  assert.doesNotMatch(feedback + bar + results, /dangerouslySetInnerHTML|\.innerHTML/);
});

test("typed suggestions and full results do not match against the first local catalogue page", () => {
  for (const source of [bar, results]) {
    assert.doesNotMatch(source, /searchProductsByName|localMatches|products:\s*catalogue/);
  }
  assert.match(results, /products=\{\[\]\}/);
  assert.doesNotMatch(results, /fetch\(/);
  assert.match(bar, /currentResponse\?\.products \?\? \[\]/);
});

test("suggestion responses are query/city scoped, debounced and aborted on replacement", () => {
  assert.match(bar, /JSON\.stringify\(\{ query: term, city, retryAttempt \}\)/);
  assert.match(bar, /serverState\?\.requestKey === requestKey/);
  assert.match(bar, /URLSearchParams\(\{ q: term, city, limit: "6" \}\)/);
  assert.match(bar, /if \(term\.length < 2 \|\| !cityReady\) return/);
  assert.match(bar, /window\.setTimeout/);
  assert.match(bar, /controller\.signal\.aborted/);
  assert.match(bar, /controller\.abort\(\)/);
  assert.match(bar, /window\.clearTimeout\(timer\)/);
  assert.match(bar, /window\.clearTimeout\(requestTimeout\)/);
  assert.match(bar, /15_000/);
  assert.match(bar, /prefetch=\{false\}/);
  assert.match(bar, /if \(!Array\.isArray\(payload\?\.products\)\) throw/);
});

test("suggestions distinguish service errors, loading, short queries and genuine no matches", () => {
  assert.match(bar, /currentResponse\?\.failed/);
  assert.match(bar, /t\("search\.error"\)/);
  assert.match(bar, /setRetryAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(bar, /t\("search\.loading"\)/);
  assert.match(bar, /t\("search\.minLength"\)/);
  assert.match(bar, /t\("search\.noHint"\)/);
});

test("suggestions support keyboard and screen-reader combobox navigation", () => {
  assert.match(bar, /useId\(\)/);
  assert.match(bar, /role="combobox"/);
  assert.match(bar, /role="listbox"/);
  assert.match(bar, /role="option"/);
  assert.match(bar, /aria-expanded=\{open\}/);
  assert.match(bar, /aria-activedescendant=/);
  assert.match(bar, /aria-selected=/);
  assert.match(bar, /event\.key === "ArrowDown"/);
  assert.match(bar, /event\.key === "ArrowUp"/);
  assert.match(bar, /event\.key === "Enter" && open && selectedIndex >= 0/);
  assert.match(bar, /event\.key === "Escape"/);
  assert.match(bar, /event\.nativeEvent\.isComposing/);
});

test("full results forward exact matching and city to the authoritative catalogue endpoint", () => {
  assert.match(results, /const exactSearch = sp\.get\("exact"\) === "1"/);
  assert.match(results, /exactSearch=\{exactSearch\}/);
  assert.match(catalog, /params\.set\("city", request\.city\)/);
  assert.match(catalog, /if \(request\.exact\) params\.set\("exact", "1"\)/);
  assert.match(catalog, /q: searchQuery\.trim\(\),\s+city,\s+exact: exactSearch/);
  assert.match(catalog, /readSearchFeedback\(payload\.meta\?\.search, request\.q\)/);
});

test("a failed or stale full-search request does not display an authoritative empty result", () => {
  assert.match(catalog, /const filtered = awaitingSearch \? \[\] : loadedProducts/);
  assert.match(catalog, /resultRequestKey !== requestKey/);
  assert.match(catalog, /!controller\.signal\.aborted && activeRequestRef\.current === requestKey/);
  assert.match(catalog, /phase: "initial"/);
  assert.match(catalog, /initialLoadError && filtered\.length === 0 \? \([\s\S]*?role="alert"[\s\S]*?setRetryAttempt/);
  assert.ok(catalog.indexOf("initialLoadError && filtered.length === 0 ? (") < catalog.indexOf('t("catalog.empty")'));
  assert.match(catalog, /window\.cancelAnimationFrame\(loadingFrame\)/);
  assert.match(catalog, /controller\.signal\.aborted \|\| activeRequestRef\.current !== expectedRequest/);
});

test("ambiguous fuzzy matches are labelled cautiously and offer an original-query search", () => {
  assert.match(feedback, /const similar = !exact && hasUncertainSearchMatch\(metadata\)/);
  assert.match(feedback, /\(corrected \|\| similar \|\| \(exact && relaxedHref\)\)/);
  assert.match(feedback, /t\("search\.similar"\)/);
  assert.match(feedback, /t\("search\.original"\)/);
  assert.match(feedback, /t\("search\.degraded"\)/);
  assert.match(catalog, /originalHref=\{searchResultsHref\(searchQuery, \{ city, pharmacies: pharmacyCodes, exact: true \}\)\}/);
  assert.match(catalog, /relaxedHref=\{searchResultsHref\(searchQuery, \{ city, pharmacies: pharmacyCodes \}\)\}/);
});

test("search analytics never send the health-related query text", () => {
  const event = bar.match(/trackEvent\("search_performed", \{([^}]+)\}\)/)?.[1];
  assert.ok(event);
  assert.match(event, /queryLength: v\.length/);
  assert.doesNotMatch(event, /(?:^|,)\s*(?:q|query|term|text):/);
  assert.doesNotMatch(bar + results + feedback, /console\.(?:log|info|warn|error)/);
});

test("search feedback and error states are localized for RU, KZ and EN", () => {
  const keys = ["search.suggestions", "search.allResults", "search.minLength", "search.error", "search.retry", "search.emptyHelp", "search.corrected", "search.original", "search.enableTypos", "search.exactMode", "search.similar", "search.degraded"];
  for (const language of ["ru", "kz", "en"]) {
    for (const key of keys) assert.ok(typeof dict[language][key] === "string" && dict[language][key].length > 0, `${language} ${key}`);
  }
  assert.match(dict.ru["search.similar"], /дозировку/);
  assert.match(dict.ru["search.similar"], /форму выпуска/);
});
