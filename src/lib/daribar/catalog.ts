import type { CatalogFacets, CatalogQuery } from "../catalog-query.ts";
import { catalogBrandKey, isVisibleCatalogProduct, prioritizeOrderableOtcProducts } from "../catalog-query.ts";
import type { PriceInfo } from "../price-info.ts";
import type { Brand, Category, Product } from "../types.ts";
import type { ProductSearchEngine, ProductSearchMetadata } from "../search/search-metadata.ts";
import { typesenseSearchConfigured } from "../search/typesense-client.ts";
import { parseProductSearchQuery, resolveSourceVowelCorrection } from "../search/product-search-model.ts";
import { daribarSearchLookupNames, directlyMatchesProductName, guardNativeDaribarSearch, searchDaribarSnapshot } from "./indexed-search.ts";
import { daribarJson } from "./client.ts";
import { daribarDefaultCity, isDaribarEnabled } from "./config.ts";
import {
  daribarCategoryIds,
  dedupeDaribarProducts,
  mapDaribarProduct,
  projectDaribarCatalog,
  type DaribarRawProduct,
} from "./catalog-data.ts";
import { daribarSkuFromProductId, daribarSkuFromSlug } from "./ids.ts";
import {
  DaribarSnapshotFileError,
  readDaribarCatalogSnapshot,
} from "./snapshot-file.ts";
import { readDaribarCatalogDatabase } from "./catalog-db.ts";

// Product normalization excludes «конфиг-рацион» and exposes images only through /api/media/daribar?sku=.

export { daribarCategoryId, daribarCategoryIds, mapDaribarProduct } from "./catalog-data.ts";
export type { DaribarRawProduct } from "./catalog-data.ts";

const UPSTREAM_PAGE_SIZE = 500;
const MAX_UPSTREAM_PAGES = 64;
const MAX_PHARMACIES = 5;
const SNAPSHOT_FRESH_MS = 2 * 60_000;
const SNAPSHOT_STALE_MS = 30 * 60_000;
const MAX_SNAPSHOT_CACHE = 32;
const PRODUCT_CACHE_MAX = 5_000;
const PRODUCT_CACHE_MS = 10 * 60_000;

export class DaribarCatalogError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status = 503) {
    super(code);
    this.name = "DaribarCatalogError";
    this.code = code;
    this.status = status;
  }
}

type DaribarProductResponse = {
  products?: unknown;
  matching_products?: unknown;
  unavailable_products?: unknown;
  result?: unknown;
  current_page?: unknown;
  total_count?: unknown;
  total_pages?: unknown;
  filters?: unknown;
};

export type DaribarCollectedPages = {
  rawProducts: DaribarRawProduct[];
  rawCount: number;
  reportedTotal: number;
  pages: number;
};

type DaribarSnapshot = DaribarCollectedPages & {
  products: Product[];
  generatedAt: string;
  stale: boolean;
  sourceMode: "postgres_snapshot" | "snapshot_file" | "priced_subset" | "live_keyword" | "live_full" | "indexed_snapshot";
  search?: ProductSearchMetadata;
  searchEngine?: ProductSearchEngine;
};

export type DaribarCatalogPage = {
  products: Product[];
  count: number;
  catalogTotal: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  rawCount: number;
  categories: Category[];
  brands: Brand[];
  facets: CatalogFacets | null;
  generatedAt: string;
  complete: boolean;
  stale: boolean;
  sourceMode: "postgres_snapshot" | "snapshot_file" | "live_full" | "live_keyword" | "selected_pharmacies" | "priced_subset" | "indexed_snapshot";
  search?: ProductSearchMetadata;
  searchEngine?: ProductSearchEngine;
};

export type DaribarSearchOptions = { exact?: boolean };
export type DaribarSearchResponse = {
  products: Product[];
  search: ProductSearchMetadata;
  engine: ProductSearchEngine;
  generatedAt: string;
  stale: boolean;
};

type SnapshotCacheEntry = { value: DaribarSnapshot; freshUntil: number; staleUntil: number };
type ProductCacheEntry = { value: Product; expiresAt: number };
type DaribarRuntime = typeof globalThis & {
  __daribarSnapshots?: Map<string, SnapshotCacheEntry>;
  __daribarSnapshotInflight?: Map<string, Promise<DaribarSnapshot>>;
  __daribarProductCache?: Map<string, ProductCacheEntry>;
};

const runtime = globalThis as DaribarRuntime;
const snapshotCache = runtime.__daribarSnapshots ??= new Map<string, SnapshotCacheEntry>();
const snapshotInflight = runtime.__daribarSnapshotInflight ??= new Map<string, Promise<DaribarSnapshot>>();
const productCache = runtime.__daribarProductCache ??= new Map<string, ProductCacheEntry>();

function text(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function integer(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(1_000_000, number) : 0;
}

function productArray(value: unknown): DaribarRawProduct[] {
  return Array.isArray(value)
    ? value.filter((item): item is DaribarRawProduct => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function responseProducts(payload: DaribarProductResponse): DaribarRawProduct[] {
  const direct = productArray(payload.products);
  if (direct.length > 0) return direct;
  const matching = productArray(payload.matching_products);
  if (matching.length > 0) return matching;
  if (payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)) {
    const nested = productArray((payload.result as Record<string, unknown>).products);
    if (nested.length > 0) return nested;
  }
  return productArray(payload.result);
}

function skuOf(raw: DaribarRawProduct): string {
  return text(raw.sku, 96);
}

/** Collect complete upstream pages; partial pages are never exposed as a full catalogue. */
export async function collectDaribarPages(
  fetchPage: (page: number, limit: number) => Promise<DaribarProductResponse>,
  maxPages = MAX_UPSTREAM_PAGES,
): Promise<DaribarCollectedPages> {
  const boundedMax = Math.max(1, Math.min(200, Math.trunc(maxPages) || MAX_UPSTREAM_PAGES));
  const rawProducts: DaribarRawProduct[] = [];
  const seen = new Set<string>();
  let reportedTotal = 0;
  for (let page = 1; page <= boundedMax; page += 1) {
    const payload = await fetchPage(page, UPSTREAM_PAGE_SIZE);
    const pageProducts = responseProducts(payload);
    reportedTotal = Math.max(reportedTotal, integer(payload.total_count));
    if (pageProducts.length === 0) {
      return { rawProducts, rawCount: rawProducts.length, reportedTotal, pages: page - 1 };
    }
    let fresh = 0;
    for (const product of pageProducts) {
      const sku = skuOf(product);
      if (sku && !seen.has(sku)) {
        seen.add(sku);
        fresh += 1;
      }
      rawProducts.push(product);
    }
    const totalPages = integer(payload.total_pages);
    const currentPage = integer(payload.current_page) || page;
    if (totalPages > 0 && currentPage >= totalPages) {
      return { rawProducts, rawCount: rawProducts.length, reportedTotal, pages: page };
    }
    if (fresh === 0) throw new DaribarCatalogError("daribar_catalog_pagination_stalled");
  }
  throw new DaribarCatalogError("daribar_catalog_snapshot_incomplete");
}

const KEYWORD_CITY: Record<string, string> = {
  алматы: "almaty", астана: "astana", шымкент: "shymkent", караганда: "karaganda",
  актобе: "aktobe", талдыкорган: "taldykorgan", тараз: "taraz", уральск: "uralsk",
  павлодар: "pavlodar", устькаменогорск: "ustKamenogorsk", актау: "aktau", атырау: "atirau",
  петропавловск: "petropavlovsk", семей: "semei", рудный: "rudny", костанай: "kostanay",
  кызылорда: "kyzylorda", туркестан: "turkestan", экибастуз: "ekibastuz",
};

const CATEGORY_CITY: Record<string, string> = {
  almaty: "Алматы", astana: "Астана", shymkent: "Шымкент", karaganda: "Караганда",
  aktobe: "Актобе", taldykorgan: "Талдыкорган", taraz: "Тараз", uralsk: "Уральск",
  pavlodar: "Павлодар", ustkamenogorsk: "Усть-Каменогорск", aktau: "Актау", atirau: "Атырау",
  petropavlovsk: "Петропавловск", semei: "Семей", rudny: "Рудный", kostanay: "Костанай",
  kyzylorda: "Кызылорда", turkestan: "Туркестан", ekibastuz: "Экибастуз",
};

export function daribarKeywordCity(value?: string): string {
  const raw = text(value || daribarDefaultCity(), 100);
  const key = raw.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^a-zа-я0-9]/gi, "");
  return /^[a-z][a-zA-Z]{1,40}$/.test(raw) ? raw : KEYWORD_CITY[key] || "almaty";
}

export function daribarCategoryCity(value?: string): string {
  const raw = text(value || daribarDefaultCity(), 100);
  const key = raw.toLocaleLowerCase("ru").replace(/[^a-zа-я0-9]/gi, "");
  return /^[а-яё -]{2,80}$/i.test(raw) ? raw : CATEGORY_CITY[key] || "Алматы";
}

function rememberProducts(products: Product[]): void {
  const now = Date.now();
  for (const product of products) {
    if (!product.sku) continue;
    productCache.delete(product.sku);
    productCache.set(product.sku, { value: product, expiresAt: now + PRODUCT_CACHE_MS });
  }
  while (productCache.size > PRODUCT_CACHE_MAX) {
    const oldest = productCache.keys().next().value;
    if (!oldest) break;
    productCache.delete(oldest);
  }
}

function cachedProduct(sku: string): Product | null {
  const entry = productCache.get(sku);
  if (!entry || entry.expiresAt <= Date.now()) {
    productCache.delete(sku);
    return null;
  }
  productCache.delete(sku);
  productCache.set(sku, entry);
  return entry.value;
}

function mapCollected(
  collected: DaribarCollectedPages,
  sourceMode: DaribarSnapshot["sourceMode"] = "live_full",
): DaribarSnapshot {
  const products = dedupeDaribarProducts(
    collected.rawProducts.map(mapDaribarProduct).filter((product): product is Product => product !== null),
  );
  rememberProducts(products);
  return { ...collected, products, generatedAt: new Date().toISOString(), stale: false, sourceMode };
}

function trimSnapshotCache(): void {
  while (snapshotCache.size > MAX_SNAPSHOT_CACHE) {
    const oldest = snapshotCache.keys().next().value;
    if (!oldest) break;
    snapshotCache.delete(oldest);
  }
}

async function cachedSnapshot(key: string, loader: () => Promise<DaribarSnapshot>): Promise<DaribarSnapshot> {
  const now = Date.now();
  const cached = snapshotCache.get(key);
  if (cached && cached.freshUntil > now) {
    snapshotCache.delete(key);
    snapshotCache.set(key, cached);
    return cached.value;
  }
  const running = snapshotInflight.get(key);
  if (running) return running;
  const promise = loader().then((value) => {
    snapshotCache.delete(key);
    snapshotCache.set(key, {
      value,
      freshUntil: Date.now() + SNAPSHOT_FRESH_MS,
      staleUntil: Date.now() + SNAPSHOT_STALE_MS,
    });
    trimSnapshotCache();
    return value;
  }).catch((error) => {
    if (cached && cached.staleUntil > Date.now()) return { ...cached.value, stale: true };
    throw error;
  }).finally(() => snapshotInflight.delete(key));
  snapshotInflight.set(key, promise);
  return promise;
}

async function categorySnapshot(city?: string, requireComplete = false): Promise<DaribarSnapshot> {
  const requestedCity = daribarKeywordCity(city);
  const databaseFirst = String(process.env.DARIBAR_CATALOG_READ_SOURCE || "snapshot").trim().toLowerCase() === "postgres";
  try {
    if (databaseFirst) {
      const source = await readDaribarCatalogDatabase();
      if (daribarKeywordCity(source.city) !== requestedCity) {
        throw new DaribarCatalogError("daribar_snapshot_city_mismatch");
      }
      rememberProducts(source.products);
      return {
        products: source.products,
        rawProducts: [],
        rawCount: source.sourceCount,
        reportedTotal: source.sourceCount,
        pages: 1,
        generatedAt: source.generatedAt,
        stale: false,
        sourceMode: "postgres_snapshot",
      };
    }
    // Validate file presence and hard age before consulting the mapped cache.
    // The file is built only from /api/v1/search/category?category=145;
    // loading the 29k-row authority on a web request would take many minutes.
    const source = await readDaribarCatalogSnapshot();
    if (daribarKeywordCity(source.city) !== requestedCity) {
      throw new DaribarCatalogError("daribar_snapshot_city_mismatch");
    }
    const mapped = await cachedSnapshot(`snapshot:${requestedCity}:${source.generatedAt}`, async () => {
      const value = mapCollected({
        rawProducts: source.products,
        rawCount: source.products.length,
        reportedTotal: source.totalCount,
        pages: source.pagesFetched,
      }, "snapshot_file");
      return { ...value, generatedAt: source.generatedAt, stale: source.stale };
    });
    return { ...mapped, generatedAt: source.generatedAt, stale: source.stale };
  } catch (error) {
    if (error instanceof DaribarCatalogError) throw error;
    if (databaseFirst) throw new DaribarCatalogError("daribar_catalog_database_unavailable");
    if (error instanceof DaribarSnapshotFileError) {
      if (error.code === "daribar_snapshot_file_missing" || error.code === "daribar_snapshot_expired") {
        if (requireComplete) throw new DaribarCatalogError(error.code, error.status);
        return pricedSubsetSnapshot(city);
      }
      throw new DaribarCatalogError(error.code, error.status);
    }
    throw error;
  }
}

async function pricedSubsetSnapshot(city?: string): Promise<DaribarSnapshot> {
  const categoryCity = daribarCategoryCity(city);
  return cachedSnapshot(`priced-subset:${categoryCity}`, async () => mapCollected(await collectDaribarPages(
    (page, limit) => daribarJson<DaribarProductResponse>("/api/v1/search/category/all", {
      auth: false,
      query: { city: categoryCity, page, limit, sorting: false, filter_by_ip: false, show_restricted: true },
      timeoutMs: 20_000,
      maxBytes: 12 * 1024 * 1024,
    }),
  ), "priced_subset"));
}

async function keywordSnapshot(keyword: string, city?: string): Promise<DaribarSnapshot> {
  const q = text(keyword, 120);
  if (!q) return categorySnapshot(city);
  const keywordCity = daribarKeywordCity(city);
  return cachedSnapshot(`keyword:${keywordCity}:${q.toLocaleLowerCase("ru")}`, async () => mapCollected(
    await collectDaribarPages((page, limit) => daribarJson<DaribarProductResponse>("/api/v1/search/keyword", {
      method: "POST",
      auth: false,
      body: { keyword: q, city: keywordCity, page, limit, sorting: true, filter_by_ip: false, show_restricted: true },
      timeoutMs: 15_000,
      maxBytes: 12 * 1024 * 1024,
    })),
    "live_keyword",
  ));
}

async function productSearchSnapshot(
  keyword: string,
  city?: string,
  options: DaribarSearchOptions = {},
): Promise<DaribarSnapshot> {
  const q = text(keyword, 120);
  const configured = typesenseSearchConfigured();
  let sourceProducts: Product[] | undefined;
  if (configured) {
    try {
      const full = await categorySnapshot(city, true);
      if (!["postgres_snapshot", "snapshot_file"].includes(full.sourceMode)) {
        throw new DaribarCatalogError("daribar_search_complete_snapshot_required");
      }
      sourceProducts = full.products;
      // SKU lookups support product/checkout internals, but are never fuzzy-corrected.
      const skuMatch = full.products.find(product => product.sku === q);
      if (skuMatch) return {
        ...full, products: [skuMatch], searchEngine: "daribar",
        search: { query: q, matchedQuery: null, matchType: "exact", degraded: false },
      };
      const indexed = await cachedSnapshot(`indexed:${daribarKeywordCity(city)}:${full.generatedAt}:${options.exact ? 1 : 0}:${q.toLocaleLowerCase("ru")}`, async () => {
        const result = await searchDaribarSnapshot({
          query: q, products: full.products, city: city || daribarDefaultCity(), generatedAt: full.generatedAt, exact: options.exact,
        });
        return { ...full, products: result.products, stale: full.stale || result.stale,
          sourceMode: "indexed_snapshot", search: result.search, searchEngine: "typesense" };
      });
      return { ...indexed, stale: indexed.stale || full.stale, search: indexed.search ? { ...indexed.search, query: q } : undefined };
    } catch {
      // No query text, upstream response or credentials are written to logs.
      // A failed/unready index must not turn working provider search into a blank page.
    }
  }
  let native = await keywordSnapshot(q, city);
  const exactSku = native.products.find(product => product.sku === q);
  let products = exactSku ? [exactSku] : guardNativeDaribarSearch(native.products, q, options.exact, { sourceProducts });
  let matchedQuery: string | null = null;
  // A provider may return no candidates for a three-vowel misspelling. Resolve only
  // a unique name in the complete Daribar source, then obtain current city data
  // using that spelling. Keep the original dose/form constraints on the result.
  if (!products.length && !options.exact && sourceProducts) {
    const canonical = resolveSourceVowelCorrection(parseProductSearchQuery(q).nameQuery, sourceProducts);
    if (canonical) {
      const corrected = await keywordSnapshot(canonical, city);
      products = guardNativeDaribarSearch(corrected.products, q, false, { sourceProducts });
      native = corrected;
      const parsed = parseProductSearchQuery(q);
      if (products.length && !parsed.numbers.length && !parsed.forms.length) {
        matchedQuery = canonical.charAt(0).toLocaleUpperCase("ru") + canonical.slice(1);
      }
    }
  }
  const isLiteral = exactSku || products.every(product => directlyMatchesProductName(product, q));
  return {
    ...native, products, searchEngine: "daribar",
    search: {
      query: q, matchedQuery,
      matchType: products.length === 0 ? "none" : isLiteral ? "exact" : "typo",
      degraded: configured,
    },
  };
}

function hasFilterDimensions(query: CatalogQuery): boolean {
  return query.brands.length > 0 || query.minPrice != null || query.maxPrice != null
    || query.inStock || query.sale || query.prescription !== "all";
}

/**
 * Daribar's live filters endpoint currently reports zero pagination counts.
 * We still validate through that documented endpoint, while the complete
 * keyword snapshot remains authoritative for exact filtering and pagination.
 */
async function validateNativeKeywordFilters(query: CatalogQuery, snapshot: DaribarSnapshot, city?: string): Promise<void> {
  if (!query.q || !hasFilterDimensions(query)) return;
  const manufacturers = new Map(snapshot.products
    .filter((product) => product.brand && product.brand !== "—")
    .map((product) => [catalogBrandKey(product.brand), product.brand]));
  const selected = query.brands.map((brand) => manufacturers.get(brand)).filter((value): value is string => Boolean(value));
  if (query.brands.length > 0 && selected.length === 0) return;
  try {
    await daribarJson<DaribarProductResponse>("/api/v1/search/filters", {
      method: "POST",
      auth: false,
      body: {
        keyword: query.q,
        city: daribarKeywordCity(city),
        page: 1,
        limit: UPSTREAM_PAGE_SIZE,
        sorting: true,
        filter_by_ip: false,
        show_restricted: true,
        ...(selected.length ? { manufacturers: selected } : {}),
        ...(query.minPrice != null ? { min_price: query.minPrice } : {}),
        ...(query.maxPrice != null ? { max_price: query.maxPrice } : {}),
        ...(query.prescription === "rx" ? { recipe: ["1", "2"] } : {}),
        ...(query.prescription === "otc" ? { recipe: ["0"] } : {}),
      },
      timeoutMs: 10_000,
      maxBytes: 12 * 1024 * 1024,
    });
  } catch {
    // The complete keyword snapshot still applies the same dimensions exactly.
  }
}

function ensureSupportedCategory(query: CatalogQuery): void {
  if (query.category && daribarCategoryIds(query.category).length === 0) {
    throw new DaribarCatalogError("daribar_category_not_mapped", 404);
  }
}

export function daribarCatalogEnabled(): boolean {
  return isDaribarEnabled("catalog");
}

export function canServeDaribarCatalogQuery(query: CatalogQuery): boolean {
  return daribarCatalogEnabled() && (!query.category || daribarCategoryIds(query.category).length > 0);
}

function pageFromProducts(
  sourceProducts: Product[],
  query: CatalogQuery,
  snapshot: Pick<DaribarSnapshot, "rawCount" | "generatedAt" | "stale">,
  searchAlreadyApplied: boolean,
  sourceMode: DaribarCatalogPage["sourceMode"],
): DaribarCatalogPage {
  const projection = projectDaribarCatalog(sourceProducts, query, searchAlreadyApplied);
  const count = projection.matched.length;
  const page = Math.floor(query.offset / query.limit) + 1;
  return {
    products: projection.products,
    count,
    catalogTotal: sourceProducts.length,
    page,
    totalPages: count === 0 ? 0 : Math.ceil(count / query.limit),
    hasMore: query.offset + query.limit < count,
    rawCount: snapshot.rawCount,
    categories: projection.categories,
    brands: projection.brands,
    facets: query.includeFacets ? projection.facets : null,
    generatedAt: snapshot.generatedAt,
    complete: sourceMode !== "priced_subset",
    stale: snapshot.stale,
    sourceMode,
  };
}

export async function getDaribarCatalogPage(query: CatalogQuery, city?: string, options: DaribarSearchOptions = {}): Promise<DaribarCatalogPage> {
  if (!daribarCatalogEnabled()) throw new DaribarCatalogError("daribar_catalog_disabled");
  ensureSupportedCategory(query);
  const snapshot = query.q ? await productSearchSnapshot(query.q, city, options) : await categorySnapshot(city);
  if (snapshot.searchEngine !== "typesense") await validateNativeKeywordFilters(query, snapshot, city);
  return {
    ...pageFromProducts(snapshot.products, query, snapshot, Boolean(query.q), snapshot.sourceMode),
    ...(snapshot.search ? { search: snapshot.search, searchEngine: snapshot.searchEngine } : {}),
  };
}

export async function getDaribarProducts(limit = 100, city?: string): Promise<Product[]> {
  if (!daribarCatalogEnabled()) return [];
  const snapshot = await categorySnapshot(city);
  return prioritizeOrderableOtcProducts(snapshot.products.filter(isVisibleCatalogProduct))
    .slice(0, Math.min(250, Math.max(1, Math.trunc(limit) || 100)));
}

export async function searchDaribarProducts(query: string, limit = 40, city?: string): Promise<Product[]> {
  return (await searchDaribarProductsWithMetadata(query, limit, city)).products;
}

export async function searchDaribarProductsWithMetadata(
  query: string,
  limit = 40,
  city?: string,
  options: DaribarSearchOptions = {},
): Promise<DaribarSearchResponse> {
  const q = text(query, 120);
  const empty = { products: [], search: { query: q, matchedQuery: null, matchType: "none" as const, degraded: false },
    engine: "daribar" as const, generatedAt: new Date().toISOString(), stale: false };
  if (!daribarCatalogEnabled() || !q) return empty;
  const snapshot = await productSearchSnapshot(q, city, options);
  return {
    products: snapshot.products.filter(isVisibleCatalogProduct).slice(0, Math.min(250, Math.max(1, Math.trunc(limit) || 40))),
    search: snapshot.search || empty.search,
    engine: snapshot.searchEngine || "daribar",
    generatedAt: snapshot.generatedAt,
    stale: snapshot.stale,
  };
}

export async function searchDaribarInPharmacies(
  query: string,
  pharmacyCodes: string[],
  limit = 40,
  city?: string,
  options: DaribarSearchOptions = {},
): Promise<Product[]> {
  return (await searchDaribarInPharmaciesWithMetadata(query, pharmacyCodes, limit, city, options)).products;
}

export async function searchDaribarInPharmaciesWithMetadata(
  query: string,
  pharmacyCodes: string[],
  limit = 40,
  city?: string,
  options: DaribarSearchOptions = {},
): Promise<DaribarSearchResponse> {
  const q = text(query, 120);
  const empty: DaribarSearchResponse = { products: [], search: { query: q, matchedQuery: null, matchType: "none", degraded: false },
    engine: "daribar", generatedAt: new Date().toISOString(), stale: false };
  if (!daribarCatalogEnabled()) return empty;
  const codes = [...new Set(pharmacyCodes.map((code) => text(code, 128))
    .filter((code) => /^[A-Za-z0-9._:-]{1,128}$/.test(code)))].slice(0, MAX_PHARMACIES);
  if (!q || codes.length === 0) return empty;
  let resolved: DaribarSnapshot | null = null;
  let names = [q];
  if (typesenseSearchConfigured()) {
    try {
      resolved = await productSearchSnapshot(q, city, options);
      if (resolved.searchEngine === "typesense") {
        if (resolved.products.length === 0) return { ...empty, search: resolved.search!, engine: "typesense", stale: resolved.stale };
        names = daribarSearchLookupNames(resolved.products, q);
      }
    } catch { resolved = null; }
  }
  const allowedIds = resolved?.searchEngine === "typesense" ? new Set(resolved.products.map(product => product.id)) : null;
  const lookups = codes.flatMap(code => names.map(name => ({ code, name })));
  const settled: PromiseSettledResult<{ code: string; payload: DaribarProductResponse }>[] = [];
  const lookupDeadline = Date.now() + 10_000;
  let deadlineReached = false;
  for (let offset = 0; offset < lookups.length; offset += 4) {
    const remaining = lookupDeadline - Date.now();
    if (remaining <= 0) { deadlineReached = true; break; }
    const batch = await Promise.allSettled(lookups.slice(offset, offset + 4).map(async ({ code, name }) => ({
    code,
    payload: await daribarJson<DaribarProductResponse>("/api/v1/search/in_pharmacy", {
      method: "POST",
      origin: "auth",
      auth: false,
      body: { product_name: name, code, city: daribarKeywordCity(city), filter_by_ip: false, hide_recipe: false, sorting: true, use_adjustment: true },
      timeoutMs: Math.min(6_000, remaining),
      maxBytes: 12 * 1024 * 1024,
    }),
  })));
    settled.push(...batch);
  }
  if (settled.every(result => result.status === "rejected")) throw new DaribarCatalogError("daribar_pharmacy_search_unavailable");
  const grouped = new Map<string, { product: Product; pharmacies: Set<string> }>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const raw of responseProducts(result.value.payload)) {
      const product = mapDaribarProduct(raw);
      if (!product?.sku || !product.inStock) continue;
      if (allowedIds && !allowedIds.has(product.id)) continue;
      const previous = grouped.get(product.sku);
      if (!previous) grouped.set(product.sku, { product, pharmacies: new Set([result.value.code]) });
      else {
        previous.pharmacies.add(result.value.code);
        if (!product.priceTBD && (previous.product.priceTBD || product.price < previous.product.price)) previous.product = product;
      }
    }
  }
  let products = guardNativeDaribarSearch([...grouped.values()].map(({ product, pharmacies }) => ({ ...product, stockPharmacies: pharmacies.size })), q, options.exact,
    resolved ? { resolvedProducts: resolved.products } : {});
  if (allowedIds && resolved) {
    const rank = new Map(resolved.products.map((product, index) => [product.id, index]));
    products = products.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }
  rememberProducts(products);
  const partial = deadlineReached || settled.some(result => result.status === "rejected");
  const baseSearch = resolved?.search || { ...empty.search,
    matchType: products.every(product => directlyMatchesProductName(product, q)) ? "exact" as const : "typo" as const };
  return {
    products: products.slice(0, Math.min(500, Math.max(1, Math.trunc(limit) || 40))),
    search: { ...baseSearch, query: q, degraded: partial || Boolean(resolved?.search?.degraded) || (typesenseSearchConfigured() && !resolved),
      ...(products.length === 0 ? { matchType: "none" as const, matchedQuery: null } : {}) },
    engine: resolved?.searchEngine || "daribar", generatedAt: new Date().toISOString(), stale: partial,
  };
}

export async function getDaribarSelectedPharmacyPage(
  query: CatalogQuery,
  pharmacyCodes: string[],
  city?: string,
  options: DaribarSearchOptions = {},
): Promise<DaribarCatalogPage> {
  ensureSupportedCategory(query);
  if (!query.q) throw new DaribarCatalogError("pharmacy_search_requires_query", 400);
  const result = await searchDaribarInPharmaciesWithMetadata(query.q, pharmacyCodes, 500, city, options);
  const page = pageFromProducts(result.products, query, { rawCount: result.products.length, generatedAt: result.generatedAt, stale: result.stale }, true, "selected_pharmacies");
  return { ...page, search: result.search, searchEngine: result.engine, complete: page.complete && !result.stale && result.products.length < 500 };
}

export async function getDaribarProductBySlug(slug: string, city?: string): Promise<Product | null> {
  const sku = daribarSkuFromSlug(slug);
  if (!sku) return null;
  let exact = cachedProduct(sku);
  if (!exact) {
    const snapshot = await categorySnapshot(city);
    exact = snapshot.products.find((product) => product.sku === sku) || null;
  }
  try {
    const payload = await daribarJson<DaribarProductResponse>("/api/v2/products/cache/get", {
      query: { sku: [sku] },
      timeoutMs: 8_000,
    });
    const raw = responseProducts(payload).find((product) => skuOf(product) === sku);
    const detailed = raw ? mapDaribarProduct(raw) : null;
    if (!exact) return detailed;
    if (!detailed) return exact;
    return {
      ...detailed,
      ...exact,
      brand: exact.brand === "—" ? detailed.brand : exact.brand,
      manufacturer: exact.manufacturer || detailed.manufacturer,
      country: exact.country || detailed.country,
      mnn: exact.mnn || detailed.mnn,
      barcode: exact.barcode || detailed.barcode,
      volume: exact.volume || detailed.volume,
      description: exact.description || detailed.description,
    };
  } catch {
    return exact;
  }
}

export async function getDaribarPriceInfo(productId: string, city?: string): Promise<PriceInfo | null> {
  const sku = daribarSkuFromProductId(productId);
  if (!sku) return null;
  const product = cachedProduct(sku)
    || (await searchDaribarProducts(sku, 100, city)).find((item) => item.sku === sku)
    || null;
  if (!product || product.priceTBD || product.price <= 0) return null;
  return { min: product.price, max: product.price, count: product.inStock ? Math.max(1, product.stockPharmacies) : 0, pharmacies: [] };
}
