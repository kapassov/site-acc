import type { Product } from "../types.ts";
import type { ProductSearchMetadata } from "../search/search-metadata.ts";
import {
  matchesProductSearchConstraints,
  normalizeProductSearchText,
  parseProductSearchQuery,
  resolveSourceVowelCorrection,
  type ParsedProductSearchQuery,
} from "../search/product-search-model.ts";
import { searchTypesenseProductIds } from "../search/typesense-client.ts";
import { matchesSourceSearchName, rankProductSearchCandidates } from "../search/search-ranking.ts";

export type DaribarIndexedSearchInput = {
  query: string;
  products: Product[];
  city: string;
  generatedAt: string;
  exact?: boolean;
  timeoutMs?: number;
};

export type DaribarIndexedSearchResult = {
  products: Product[];
  search: ProductSearchMetadata;
  stale: boolean;
};

type IndexSearch = typeof searchTypesenseProductIds;
type SearchVariant = ParsedProductSearchQuery["variants"][number];

export type NativeDaribarSearchContext = {
  /** Complete Daribar snapshot, used only for literal identity selection before constraints. */
  sourceProducts?: readonly Product[];
  /** Already resolved source identities when hydrating another city or selected pharmacies. */
  resolvedProducts?: readonly Product[];
};

const literalSourceWords = new WeakMap<Product, { name: string; words: Set<string> }>();

function nameWords(value: string): string[] {
  return normalizeProductSearchText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function sourceHasWholeNameTerms(product: Product, terms: readonly string[]): boolean {
  let cached = literalSourceWords.get(product);
  if (!cached || cached.name !== product.name) {
    cached = { name: product.name, words: new Set(nameWords(product.name)) };
    literalSourceWords.set(product, cached);
  }
  const words = cached.words;
  return terms.length > 0 && terms.every(term => words.has(term));
}

function matchesWholeNameTerms(product: Product, name: string): boolean {
  return sourceHasWholeNameTerms(product, nameWords(name));
}

/** Literal token matching is used only for the explicit "as entered" action and feedback. */
export function directlyMatchesProductName(product: Product, query: string): boolean {
  const parsed = parseProductSearchQuery(query);
  if (!matchesProductSearchConstraints(product, parsed)) return false;
  const needles = nameWords(parsed.nameQuery);
  const words = nameWords(product.name);
  if (needles.length === 0) return parsed.numbers.length > 0 || parsed.forms.length > 0;
  return needles.every((needle, index) => words.some(word =>
    word === needle || (index === needles.length - 1 && needle.length >= 2 && word.startsWith(needle))));
}

function correctedLabel(products: Product[], query: ParsedProductSearchQuery): string | null {
  if (products.length === 0) return null;
  // A single base label is required. Different similar names are suggestions, not a correction.
  const termCount = Math.max(1, query.nameQuery.split(/\s+/).filter(Boolean).length);
  const labels = [...new Set(products.map(product => parseProductSearchQuery(product.name).nameQuery
    .split(/\s+/).filter(Boolean).slice(0, termCount).join(" ")).filter(Boolean))];
  if (labels.length !== 1 || labels[0] === query.nameQuery) return null;
  const label = labels[0];
  // Do not invent dose/pack conversions or replace the user's full constraint string.
  if (query.numbers.length || query.forms.length) return null;
  return label.charAt(0).toLocaleUpperCase("ru") + label.slice(1);
}

function feedback(
  products: Product[],
  query: ParsedProductSearchQuery,
  variant: SearchVariant,
  typos: number,
): ProductSearchMetadata {
  let matchType: ProductSearchMetadata["matchType"] = "exact";
  if (products.length === 0) matchType = "none";
  else if (typos > 0) matchType = "typo";
  else if (variant.kind !== "original") matchType = variant.kind;
  else if (!products.some(product => directlyMatchesProductName(product, query.original))) matchType = "alias";
  return {
    query: query.original,
    matchedQuery: matchType === "exact" || matchType === "none" ? null : correctedLabel(products, query),
    matchType,
    degraded: false,
  };
}

/**
 * Match identity in Typesense, then hydrate exclusively from the validated Daribar snapshot.
 * Every edit level is a separate pass: an existing exact medication name always wins.
 */
export async function searchDaribarSnapshot(
  input: DaribarIndexedSearchInput,
  searchIndex: IndexSearch = searchTypesenseProductIds,
): Promise<DaribarIndexedSearchResult> {
  const parsed = parseProductSearchQuery(input.query);
  const original = { value: parsed.nameQuery, kind: "original" as const };
  const variants = input.exact
    ? [original]
    : [original, ...parsed.variants.filter(variant => variant.value !== original.value)].slice(0, 6);
  const source = new Map(input.products.filter(product => product.source === "daribar" && product.sku)
    .map(product => [product.id, product]));
  const levels = input.exact ? [0] as const : [0, 1, 2] as const;
  const empty: DaribarIndexedSearchResult = {
    products: [], search: { query: parsed.original, matchedQuery: null, matchType: "none", degraded: false }, stale: false,
  };
  if (!parsed.nameQuery && !parsed.numbers.length && !parsed.forms.length) return empty;
  const deadline = Date.now() + Math.min(8_000, Math.max(100, input.timeoutMs ?? 4_000));
  let aliasCandidates: Product[] = [];

  const lookup = async (variant: SearchVariant, typos: 0 | 1 | 2, useAliases: boolean) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("daribar_search_deadline_exceeded");
    const result = await searchIndex({
      query: variant.value,
      // Resolve the medication name FIRST. Missing form/dose must never cause a
      // later fuzzy pass to select a different medication with that form/dose.
      numbers: parsed.nameQuery ? [] : parsed.numbers,
      forms: parsed.nameQuery ? [] : parsed.forms,
      expectedCity: input.city,
      expectedGeneratedAt: input.generatedAt,
      typos,
      useAliases,
      prefix: !useAliases,
      timeoutMs: remaining,
    });
    empty.stale ||= result.stale;
    const candidates = [...new Set(result.ids)].map(id => {
      const product = source.get(id);
      if (!product) throw new Error("daribar_search_index_product_mismatch");
      return product;
    }).filter(product => useAliases || matchesSourceSearchName(product, variant.value, typos));
    // Whole names outrank partial word completions. In particular, a real
    // "Лоратадин" must not become "Гриппферон с лоратадином" to satisfy "мазь".
    const wholeNames = typos === 0 && !useAliases
      ? candidates.filter(product => matchesWholeNameTerms(product, variant.value)) : [];
    return wholeNames.length ? wholeNames : candidates;
  };

  const constrain = (candidates: Product[]) => candidates.filter(product =>
    matchesProductSearchConstraints(product, parsed)
    && (!input.exact || directlyMatchesProductName(product, parsed.original)));

  for (const typos of levels) {
    if (typos === 1 && (parsed.nameQuery.match(/\p{L}/gu)?.length ?? 0) >= 4) {
      // A generated transliteration is only a possibility. Keep it alongside
      // plausible source-name typos instead of silently choosing e.g. LinX
      // instead of Линекс for "линкс".
      aliasCandidates = await lookup(original, 0, true);
    }
    for (const variant of variants) {
      const minimumLength = typos === 2 ? 9 : 5;
      if (typos > 0 && !variant.value.split(/\s+/).some(word => word.length >= minimumLength)) continue;
      const candidates = await lookup(variant, typos, false);
      if (candidates.length) {
        const identities = [...new Map([...candidates, ...(typos > 0 ? aliasCandidates : [])]
          .map(product => [product.id, product])).values()];
        const products = rankProductSearchCandidates(constrain(identities), parsed, variant);
        return { products, search: feedback(products, parsed, variant, typos), stale: empty.stale };
      }
    }
  }
  if (aliasCandidates.length) {
    const products = rankProductSearchCandidates(constrain(aliasCandidates), parsed);
    return {
      products,
      search: { query: parsed.original, matchedQuery: null, matchType: products.length ? "alias" : "none", degraded: false },
      stale: empty.stale,
    };
  }
  if (!input.exact) {
    const canonical = resolveSourceVowelCorrection(parsed.nameQuery, input.products);
    if (canonical) {
      const variant = { value: canonical, kind: "original" as const };
      const candidates = (await lookup(variant, 0, false))
        .filter(product => nameWords(product.name)[0] === canonical);
      const products = rankProductSearchCandidates(constrain(candidates), parsed, variant);
      return { products, search: feedback(products, parsed, original, 3), stale: empty.stale };
    }
  }
  return empty;
}

/**
 * Provider search can suggest other medicines, even for an exact name. Resolve identity before
 * quantity/form and never let a missing requested dose rescue a different medicine. Degraded
 * search may return fewer matches; it must not weaken the healthy path's medication safeguards.
 */
export function guardNativeDaribarSearch(
  products: Product[],
  query: string,
  exact = false,
  context: NativeDaribarSearchContext = {},
): Product[] {
  const parsed = parseProductSearchQuery(query);
  if (!parsed.nameQuery && !parsed.numbers.length && !parsed.forms.length) return [];
  const authoritative = (product: Product) => product.source === "daribar" && typeof product.sku === "string" && Boolean(product.sku);
  const candidates = [...new Map(products.filter(authoritative).map(product => [product.id, product])).values()];
  const constrain = (items: Product[]) => items.filter(product => matchesProductSearchConstraints(product, parsed)
    && (!exact || directlyMatchesProductName(product, query)));

  if (context.resolvedProducts) {
    const resolved = new Map(context.resolvedProducts.filter(authoritative).map(product => [product.id, product]));
    return constrain(candidates.filter(product => {
      const reference = resolved.get(product.id);
      return reference && reference.sku === product.sku
        && parseProductSearchQuery(reference.name).nameQuery === parseProductSearchQuery(product.name).nameQuery;
    }));
  }

  if (!parsed.nameQuery) return constrain(candidates);
  const original: SearchVariant = { value: parsed.nameQuery, kind: "original" };
  const variants = exact ? [original]
    : [original, ...parsed.variants.filter(variant => variant.value !== original.value)].slice(0, 6);
  // Keep current native items too, so a newly
  // added Daribar SKU with the exact name does not require a snapshot refresh to be recognized.
  const reference = [...(context.sourceProducts || []), ...candidates].filter(authoritative);
  for (const variant of variants) {
    const terms = nameWords(variant.value);
    if (reference.some(product => sourceHasWholeNameTerms(product, terms))) {
      return rankProductSearchCandidates(constrain(candidates.filter(product => sourceHasWholeNameTerms(product, terms))), parsed, variant);
    }
  }

  const recoverVowels = () => {
    // A native result subset cannot establish that the corrected source name is unique.
    if (exact || !context.sourceProducts) return [];
    const canonical = resolveSourceVowelCorrection(parsed.nameQuery, reference);
    if (!canonical) return [];
    return rankProductSearchCandidates(constrain(candidates.filter(product => nameWords(product.name)[0] === canonical)),
      parsed, { value: canonical, kind: "original" });
  };

  // Native responses may already have filtered out the intended medicine due to a missing
  // dose/form. Without a resolved identity, fuzzy or prefix rescue could choose another drug.
  if (parsed.numbers.length || parsed.forms.length) return recoverVowels();
  for (const typos of exact ? [0] as const : [0, 1, 2] as const) {
    for (const variant of variants) {
      if (typos > 0 && !nameWords(variant.value).some(word => word.length >= (typos === 2 ? 9 : 5))) continue;
      const matches = candidates.filter(product => matchesSourceSearchName(product, variant.value, typos));
      if (matches.length) return rankProductSearchCandidates(constrain(matches), parsed, variant);
    }
  }
  return recoverVowels();
}

/** Source-backed name prefixes for provider city/pharmacy hydration, never invented alternatives. */
export function daribarSearchLookupNames(products: Product[], originalQuery: string): string[] {
  const terms = parseProductSearchQuery(originalQuery).nameQuery.split(/\s+/).filter(Boolean).length;
  if (terms === 0) return [originalQuery];
  const names = [...new Set(products.map(product => parseProductSearchQuery(product.name).nameQuery
    .split(/\s+/).filter(Boolean).slice(0, terms).join(" ")).filter(Boolean))];
  if (names.length > 5) throw new Error("daribar_search_hydration_too_broad");
  return names;
}
