import type { Brand, Category, Product } from "@/lib/types";
import { productNameSearchScore } from "./product-name-search.ts";
import { resolveCategoryHandle } from "./category-aliases.ts";

export const DEFAULT_CATALOG_LIMIT = 100;
export const MAX_CATALOG_LIMIT = 250;

export type CatalogSort = "relevance" | "name_asc" | "name_desc" | "price_asc" | "price_desc";
export type PrescriptionFilter = "all" | "rx" | "otc";

export type CatalogQuery = {
  limit: number;
  offset: number;
  page: number;
  includeFacets: boolean;
  q: string;
  category: string | null;
  brands: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  sale: boolean;
  prescription: PrescriptionFilter;
  sort: CatalogSort;
};

export class CatalogQueryError extends Error {
  code: string;
  field: string;

  constructor(field: string, code = "invalid_parameter") {
    super(`${field}: ${code}`);
    this.name = "CatalogQueryError";
    this.code = code;
    this.field = field;
  }
}

function firstParam(params: URLSearchParams, camel: string, snake?: string): string | null {
  return params.get(camel) ?? (snake ? params.get(snake) : null);
}

function integerParam(
  raw: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new CatalogQueryError(field, "must_be_integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CatalogQueryError(field, `must_be_between_${min}_and_${max}`);
  }
  return value;
}

function optionalIntegerParam(raw: string | null, field: string): number | null {
  if (raw == null || raw === "") return null;
  return integerParam(raw, field, 0, 0, 100_000_000);
}

function enabledParam(raw: string | null, field: string): boolean {
  if (raw == null || raw === "" || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  throw new CatalogQueryError(field, "must_be_boolean");
}

function includedParam(raw: string | null, field: string): boolean {
  if (raw == null || raw === "" || raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new CatalogQueryError(field, "must_be_boolean");
}

export function catalogBrandKey(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/ё/g, "е");
  const compact = normalized.replace(/[^a-zа-я0-9]+/gi, "");
  if (/^(?:тд)?пептидбио$/.test(compact) || /^(?:td)?pept(?:id|ide)bio$/.test(compact)) {
    return "peptid-bio";
  }
  return normalized
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "brand";
}

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const limit = integerParam(params.get("limit"), "limit", DEFAULT_CATALOG_LIMIT, 1, MAX_CATALOG_LIMIT);
  const rawOffset = params.get("offset");
  const rawPage = params.get("page");
  const offset = rawOffset != null
    ? integerParam(rawOffset, "offset", 0, 0, 10_000_000)
    : (integerParam(rawPage, "page", 1, 1, 1_000_000) - 1) * limit;
  const q = (params.get("q") || "").trim().replace(/\s+/g, " ");
  if (q.length > 120) throw new CatalogQueryError("q", "too_long");

  const rawCategory = (params.get("category") || "").trim() || null;
  if (rawCategory && !/^[a-z0-9_-]{1,120}$/i.test(rawCategory)) {
    throw new CatalogQueryError("category", "invalid_handle");
  }
  const category = rawCategory ? resolveCategoryHandle(rawCategory) : null;

  const brands = [...new Set(
    params.getAll("brand")
      .flatMap((value) => value.split(","))
      .map((value) => catalogBrandKey(value))
      .filter(Boolean),
  )];
  if (brands.length > 20) throw new CatalogQueryError("brand", "too_many_values");

  const minPrice = optionalIntegerParam(firstParam(params, "minPrice", "price_min"), "minPrice");
  const maxPrice = optionalIntegerParam(firstParam(params, "maxPrice", "price_max"), "maxPrice");
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new CatalogQueryError("minPrice", "greater_than_maxPrice");
  }

  const prescription = (params.get("prescription") || params.get("rx") || "all") as PrescriptionFilter;
  if (!(["all", "rx", "otc"] as string[]).includes(prescription)) {
    throw new CatalogQueryError("prescription", "must_be_all_rx_or_otc");
  }

  const sort = (params.get("sort") || "relevance") as CatalogSort;
  if (!(["relevance", "name_asc", "name_desc", "price_asc", "price_desc"] as string[]).includes(sort)) {
    throw new CatalogQueryError("sort", "unsupported_value");
  }

  return {
    limit,
    offset,
    page: Math.floor(offset / limit) + 1,
    includeFacets: includedParam(firstParam(params, "includeFacets", "facets"), "facets"),
    q,
    category,
    brands,
    minPrice,
    maxPrice,
    inStock: enabledParam(firstParam(params, "inStock", "in_stock"), "inStock"),
    sale: enabledParam(params.get("sale"), "sale"),
    prescription,
    sort,
  };
}

function hasKnownPrice(product: Product): boolean {
  return !product.priceTBD && Number.isFinite(product.price) && product.price > 0;
}

/** Public catalogue cards must represent something the customer can buy. */
export function isVisibleCatalogProduct(product: Product): boolean {
  return hasKnownPrice(product) && product.inStock && Boolean(product.variantId);
}

function compareId(left: Product, right: Product): number {
  return left.id.localeCompare(right.id);
}

function compareKnownPrice(left: Product, right: Product, direction: 1 | -1): number {
  const leftKnown = hasKnownPrice(left);
  const rightKnown = hasKnownPrice(right);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (leftKnown && rightKnown && left.price !== right.price) return (left.price - right.price) * direction;
  return compareId(left, right);
}

function compareOrderableOtc(left: Product, right: Product): number {
  const leftPreferred = left.inStock && left.prescription === false && hasKnownPrice(left) && Boolean(left.variantId);
  const rightPreferred = right.inStock && right.prescription === false && hasKnownPrice(right) && Boolean(right.variantId);
  return Number(rightPreferred) - Number(leftPreferred);
}

/**
 * Keep products that can be ordered without a prescription ahead of the rest.
 * Array sorting is stable, so the provider/search ranking is preserved inside
 * each priority group.
 */
export function prioritizeOrderableOtcProducts(products: Product[]): Product[] {
  return [...products].sort(compareOrderableOtc);
}

export function filterAndSortCatalog(
  products: Product[],
  query: CatalogQuery,
  options: { prioritizeOrderableOtc?: boolean; visibleOnly?: boolean } = {},
): Product[] {
  const prioritizeOrderableOtc = options.prioritizeOrderableOtc ?? true;
  const filtered = products.filter((product) => {
    if (options.visibleOnly && !isVisibleCatalogProduct(product)) return false;
    if (query.q && productNameSearchScore(product.name, query.q) === null) return false;
    if (query.category) {
      const handles = new Set([product.categorySlug, ...(product.categoryHandles || [])]);
      if (!handles.has(query.category)) return false;
    }
    if (query.brands.length && !query.brands.includes(catalogBrandKey(product.brand))) return false;
    if (query.minPrice != null && (!hasKnownPrice(product) || product.price < query.minPrice)) return false;
    if (query.maxPrice != null && (!hasKnownPrice(product) || product.price > query.maxPrice)) return false;
    if (query.inStock && !product.inStock) return false;
    if (query.sale && !(product.oldPrice != null && product.oldPrice > product.price)) return false;
    if (query.prescription === "rx" && !product.prescription) return false;
    if (query.prescription === "otc" && product.prescription !== false) return false;
    return true;
  });

  if (query.sort === "relevance") {
    if (!query.q) return prioritizeOrderableOtc ? prioritizeOrderableOtcProducts(filtered) : filtered;
    return [...filtered].sort((left, right) =>
      (productNameSearchScore(left.name, query.q) ?? Number.POSITIVE_INFINITY)
      - (productNameSearchScore(right.name, query.q) ?? Number.POSITIVE_INFINITY)
      || (prioritizeOrderableOtc ? compareOrderableOtc(left, right) : 0)
      || compareId(left, right));
  }
  return [...filtered].sort((left, right) => {
    const byOrderability = prioritizeOrderableOtc ? compareOrderableOtc(left, right) : 0;
    if (byOrderability !== 0) return byOrderability;
    if (query.sort === "price_asc") return compareKnownPrice(left, right, 1);
    if (query.sort === "price_desc") return compareKnownPrice(left, right, -1);
    const byName = left.name.localeCompare(right.name, "ru", { sensitivity: "base" });
    if (byName !== 0) return query.sort === "name_desc" ? -byName : byName;
    return compareId(left, right);
  });
}

function brandHue(name: string): number {
  let value = 0;
  for (let i = 0; i < name.length; i++) value = (value * 31 + name.charCodeAt(i)) >>> 0;
  return value % 360;
}

function productWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "товаров";
  if (mod10 === 1) return "товар";
  if (mod10 >= 2 && mod10 <= 4) return "товара";
  return "товаров";
}

export type CatalogBrandFacet = { key: string; name: string; count: number };

export type CatalogCategoryFacet = {
  id: string;
  slug: string;
  name: string;
  count: number;
};

export type CatalogFacets = {
  categories: CatalogCategoryFacet[];
  brands: CatalogBrandFacet[];
  price: { min: number | null; max: number | null; unknown: number };
  availability: { inStock: number; outOfStock: number; unknown: number };
  sale: { onSale: number; regular: number };
  prescription: { rx: number; otc: number };
};

export function buildCatalogBrandFacets(products: Product[]): CatalogBrandFacet[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const product of products) {
    const name = product.brand.trim();
    if (!name || name === "—") continue;
    const key = catalogBrandKey(name);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ru"));
}

export function buildCatalogBrands(products: Product[]): Brand[] {
  return buildCatalogBrandFacets(products).map((brand, index) => ({
    id: `br${index}`,
    slug: brand.key,
    name: brand.name,
    tagline: `${brand.count} ${productWord(brand.count)}`,
    hue: brandHue(brand.name),
  }));
}

export function buildCatalogFacets(products: Product[], categories: Category[]): CatalogFacets {
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  let knownPrices = 0;
  let inStock = 0;
  let outOfStock = 0;
  let unknownStock = 0;
  let sale = 0;
  let rx = 0;
  let otc = 0;

  for (const product of products) {
    if (hasKnownPrice(product)) {
      knownPrices += 1;
      minPrice = minPrice == null ? product.price : Math.min(minPrice, product.price);
      maxPrice = maxPrice == null ? product.price : Math.max(maxPrice, product.price);
    }
    if (product.inStock) inStock += 1;
    else if (product.priceTBD) unknownStock += 1;
    else outOfStock += 1;
    if (product.oldPrice != null && product.oldPrice > product.price) sale += 1;
    if (product.prescription) rx += 1;
    if (product.prescription === false) otc += 1;
  }

  return {
    categories: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      count: products.filter((product) => (
        product.categorySlug === category.slug || product.categoryHandles?.includes(category.slug)
      )).length,
    })),
    brands: buildCatalogBrandFacets(products),
    price: {
      min: minPrice,
      max: maxPrice,
      unknown: products.length - knownPrices,
    },
    availability: { inStock, outOfStock, unknown: unknownStock },
    sale: { onSale: sale, regular: products.length - sale },
    prescription: { rx, otc },
  };
}

export function cataloguePagination(total: number, query: CatalogQuery) {
  const hasNext = query.offset + query.limit < total;
  return {
    page: query.page,
    limit: query.limit,
    offset: query.offset,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    hasNext,
    hasPrevious: query.offset > 0,
    nextOffset: hasNext ? query.offset + query.limit : null,
    previousOffset: query.offset > 0 ? Math.max(0, query.offset - query.limit) : null,
  };
}
