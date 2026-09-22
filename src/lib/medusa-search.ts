import type { Product } from "./types.ts";
import { productNameSearchScore } from "./product-name-search.ts";
import { parseProductSearchQuery, createProductSearchDocument, matchesProductSearchConstraints } from "./search/product-search-model.ts";
import { matchesSourceSearchName, rankProductSearchCandidates } from "./search/search-ranking.ts";
import type { ProductSearchMetadata } from "./search/search-metadata.ts";

export type MedusaTitle = { id: string; title: string };
const prepared = new WeakMap<MedusaTitle[], Array<{ product: Product; name: string }>>();

/** Search only imported Medusa names; fuzzy matching never substitutes a dose or form. */
export function matchMedusaTitles(titles: MedusaTitle[], query: string, exact = false) {
  const parsed = parseProductSearchQuery(query);
  let entries = prepared.get(titles);
  if (!entries) {
    const products: Product[] = titles.map(({ id, title }) => ({
    id, name: title, source: "medusa", slug: id, brand: "", categorySlug: "",
    price: 0, priceTBD: true, inStock: false, stockPharmacies: 0, rating: 0, reviews: 0,
    badges: [], art: { kind: "box", hue: 150 },
    }));
    // Compare the name portion of the same canonical parser used for query
    // constraints. This keeps mixed Cyrillic/Latin glyphs and attached labels
    // such as "3 в1" searchable without allowing dosage/form substitutions.
    entries = products.map((product) => ({ product, name: parseProductSearchQuery(product.name).nameQuery }));
    prepared.set(titles, entries);
  }
  let products: Product[] = [];
  let matchType: ProductSearchMetadata["matchType"] = "none";
  for (const variant of parsed.variants) {
    if (exact && variant.kind !== "original") continue;
    const words = variant.value.split(" ").filter(Boolean);
    const possible = entries.filter(({ name }) => {
      const tokens = name.split(" ");
      const literal = words.every((word, position) => tokens.includes(word)
        || (position === words.length - 1 && tokens.some((token) => token.startsWith(word))));
      return literal || (!exact && productNameSearchScore(name, variant.value) !== null);
    }).filter(({ product }) => matchesProductSearchConstraints(createProductSearchDocument(product), parsed));
    const literal = possible.filter(({ product }) => matchesSourceSearchName(product, variant.value, 0, true)).map(({ product }) => product);
    const fuzzy = exact ? [] : possible.filter(({ product }) => {
      // Three wrong letters are allowed only for long names (пороцетомол).
      return productNameSearchScore(parseProductSearchQuery(product.name).nameQuery, variant.value) !== null;
    }).map(({ product }) => product);
    const byId = new Map([...literal, ...fuzzy].map((product) => [product.id, product]));
    if (!byId.size) continue;
    products = rankProductSearchCandidates([...byId.values()], parsed, variant);
    matchType = variant.kind === "original" ? literal.length ? "exact" : "typo" : variant.kind;
    break;
  }
  return {
    ids: products.map((product) => product.id),
    // Several medicine names can match a typo. Never invent a single correction.
    search: { query, matchedQuery: null, matchType, degraded: false } satisfies ProductSearchMetadata,
  };
}
