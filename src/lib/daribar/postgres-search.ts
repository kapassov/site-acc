import type { Product } from "../types.ts";
import {
  matchesProductSearchConstraints,
  parseProductSearchQuery,
  type ParsedProductSearchQuery,
} from "../search/product-search-model.ts";
import { matchesSourceSearchName, rankProductSearchCandidates } from "../search/search-ranking.ts";
import type { ProductSearchMetadata } from "../search/search-metadata.ts";

type SearchHit = { product: Product; field: "name" | "mnn" };

const mnnProducts = new WeakMap<Product, { mnn: string; product: Product }>();

function mnnProduct(product: Product): Product | null {
  const mnn = product.mnn?.trim() || "";
  if (!mnn) return null;
  const cached = mnnProducts.get(product);
  if (cached?.mnn === mnn) return cached.product;
  const value = { ...product, name: mnn };
  mnnProducts.set(product, { mnn, product: value });
  return value;
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
  for (const product of products) {
    if (!matchesProductSearchConstraints(product, parsed)) continue;
    if (matchesSourceSearchName(product, value, typos, true)) {
      hits.push({ product, field: "name" });
      continue;
    }
    const activeIngredient = mnnProduct(product);
    if (activeIngredient && matchesSourceSearchName(activeIngredient, value, typos, true)) {
      hits.push({ product, field: "mnn" });
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
  for (const typos of typoPasses) {
    const byProduct = new Map<string, SearchHit>();
    let matchedType: ProductSearchMetadata["matchType"] = typos ? "typo" : "exact";
    for (const variant of parsed.variants) {
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
      const nameHits = rankProductSearchCandidates(
        hits.filter((hit) => hit.field === "name").map((hit) => hit.product),
        parsed,
      );
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
