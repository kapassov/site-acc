import type { Product } from "../types.ts";
import {
  matchesProductSearchConstraints,
  normalizeProductSearchText,
  parseProductSearchQuery,
  type ParsedProductSearchQuery,
} from "../search/product-search-model.ts";
import { boundedProductNameDistance, rankProductSearchCandidates } from "../search/search-ranking.ts";
import type { ProductSearchMetadata } from "../search/search-metadata.ts";

type SearchHit = { product: Product; field: "name" | "mnn" };
type IndexedProduct = { product: Product; nameWords: string[]; mnnWords: string[] };

const GENERIC_QUERY_ALIASES = new Map([
  ["шприцы", "шприц"],
  ["шприцов", "шприц"],
]);

const searchIndexes = new WeakMap<readonly Product[], IndexedProduct[]>();

function words(value: string): string[] {
  return normalizeProductSearchText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function indexedProducts(products: readonly Product[]): IndexedProduct[] {
  const cached = searchIndexes.get(products);
  if (cached) return cached;
  const indexed = products.map((product) => ({
    product,
    nameWords: words(product.name),
    mnnWords: words(product.mnn || ""),
  }));
  searchIndexes.set(products, indexed);
  return indexed;
}

function allowedTypos(word: string, requested: 0 | 1 | 2): number {
  if (requested === 0 || /\d/u.test(word) || [...word].length < 5) return 0;
  return Math.min(requested, [...word].length < 9 ? 1 : 2);
}

function matchesIndexedWords(
  sourceWords: readonly string[],
  needles: readonly string[],
  typos: 0 | 1 | 2,
): boolean {
  return needles.every((needle, index) => {
    const bound = allowedTypos(needle, typos);
    const lastPrefix = index === needles.length - 1 && needle.length >= 2 && !/\d/u.test(needle);
    if (sourceWords.some((word) => word === needle
      || (lastPrefix && word.startsWith(needle))
      || (bound > 0 && boundedProductNameDistance(word, needle, bound) <= bound))) return true;
    return sourceWords.some((word, position) => (
      position + 1 < sourceWords.length && `${word}${sourceWords[position + 1]}` === needle
    ));
  });
}

function variantMatchType(
  kind: ParsedProductSearchQuery["variants"][number]["kind"],
  typos: 0 | 1 | 2,
): ProductSearchMetadata["matchType"] {
  if (typos > 0) return "typo";
  if (kind === "layout") return "layout";
  if (kind === "transliteration") return "transliteration";
  if (kind === "alias") return "alias";
  return "exact";
}

function matchingHits(
  products: readonly Product[],
  parsed: ParsedProductSearchQuery,
  value: string,
  typos: 0 | 1 | 2,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const needles = words(value);
  if (!needles.length) return hits;
  for (const indexed of indexedProducts(products)) {
    if (matchesIndexedWords(indexed.nameWords, needles, typos)) {
      if (matchesProductSearchConstraints(indexed.product, parsed)) {
        hits.push({ product: indexed.product, field: "name" });
      }
      continue;
    }
    if (indexed.mnnWords.length && matchesIndexedWords(indexed.mnnWords, needles, typos)
        && matchesProductSearchConstraints(indexed.product, parsed)) {
      hits.push({ product: indexed.product, field: "mnn" });
    }
  }
  return hits;
}

/**
 * Search the immutable catalogue already loaded from PostgreSQL. Candidate
 * generation never calls Daribar or a secondary search service. MNN is a
 * first-class searchable field, while dose/form guards always use the source
 * product title so an active ingredient cannot silently change the pack.
 */
export function searchDaribarPostgresProducts(input: {
  query: string;
  products: readonly Product[];
  exact?: boolean;
}): { products: Product[]; search: ProductSearchMetadata } {
  const query = input.query.trim();
  const parsed = parseProductSearchQuery(query);
  const sku = input.products.find((product) => product.sku === query);
  if (sku) {
    return {
      products: [sku],
      search: { query, matchedQuery: null, matchType: "exact", degraded: false },
    };
  }

  const typoPasses: (0 | 1 | 2)[] = input.exact ? [0] : [0, 1, 2];
  const genericAlias = GENERIC_QUERY_ALIASES.get(parsed.nameQuery);
  const variants = genericAlias
    ? [...parsed.variants, { value: genericAlias, kind: "alias" as const }]
    : parsed.variants;
  for (const typos of typoPasses) {
    const byProduct = new Map<string, SearchHit>();
    let matchedType: ProductSearchMetadata["matchType"] = typos ? "typo" : "exact";
    for (const variant of variants) {
      const hits = matchingHits(input.products, parsed, variant.value, typos);
      if (hits.length && byProduct.size === 0) matchedType = variantMatchType(variant.kind, typos);
      for (const hit of hits) {
        const key = hit.product.sku || hit.product.id;
        const previous = byProduct.get(key);
        if (!previous || previous.field === "mnn" && hit.field === "name") byProduct.set(key, hit);
      }
    }
    if (byProduct.size) {
      const hits = [...byProduct.values()];
      let nameHits = rankProductSearchCandidates(
        hits.filter((hit) => hit.field === "name").map((hit) => hit.product),
        parsed,
      );
      if (genericAlias === "шприц") {
        nameHits = nameHits.sort((left, right) => (
          Number(!normalizeProductSearchText(left.name).startsWith("шприц "))
          - Number(!normalizeProductSearchText(right.name).startsWith("шприц "))
          || Number(right.inStock) - Number(left.inStock)
          || Number(right.stockPharmacies || 0) - Number(left.stockPharmacies || 0)
        ));
      }
      const ingredientHits = hits.filter((hit) => hit.field === "mnn").map((hit) => hit.product)
        .sort((left, right) => Number(right.inStock) - Number(left.inStock)
          || left.name.localeCompare(right.name, "ru"));
      return {
        products: [...nameHits, ...ingredientHits],
        search: { query, matchedQuery: null, matchType: matchedType, degraded: false },
      };
    }
  }

  return {
    products: [],
    search: { query, matchedQuery: null, matchType: "none", degraded: false },
  };
}
