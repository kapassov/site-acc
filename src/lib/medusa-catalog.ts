import type { Brand, Category, CatNode, Product } from "./types";
import { buildCatalogBrands, buildCatalogFacets, cataloguePagination, filterAndSortCatalog, type CatalogQuery, type CatalogFacets } from "./catalog-query";
import {
  getLocalCatalogTitleRevision,
  getLocalCatalogTitles,
  queryLocalCatalog,
  searchLocalProductTitleCandidates,
} from "./catalog-local-read";
import { getCatalogReadSnapshot, getCatalogReadCategoryTree, postgresCatalogEnabled } from "./catalog-read";
import { getCategoryTree } from "./medusa";
import { matchMedusaTitles, type MedusaTitle } from "./medusa-search";
import type { ProductSearchMetadata } from "./search/search-metadata";
import { parseProductSearchQuery } from "./search/product-search-model";
import { getLruEntry, setLruEntry } from "./boundedLru";
import { resolveMedusaCategoryHandle } from "./category-aliases";

type TitleCache = { nextRevisionCheck: number; revision: string; titles: MedusaTitle[]; pending?: Promise<MedusaTitle[]> };
const root = globalThis as typeof globalThis & { __medusaTitleIndex?: TitleCache };
const index = root.__medusaTitleIndex ??= { nextRevisionCheck: 0, revision: "", titles: [] };
const revisionCheckIntervalMs = 60_000;
type PageCacheEntry = { expiresAt: number; pending: Promise<MedusaCatalogPage> };
const pageCacheRoot = globalThis as typeof globalThis & { __medusaCatalogPageCache?: Map<string, PageCacheEntry> };
const pageCache = pageCacheRoot.__medusaCatalogPageCache ??= new Map<string, PageCacheEntry>();
const pageCacheTtlMs = 30_000;
const pageCacheLimit = 80;

async function titles() {
  if (index.titles.length && index.nextRevisionCheck > Date.now()) return index.titles;
  if (index.pending) return index.pending;
  index.pending = (async () => {
    const revision = await getLocalCatalogTitleRevision();
    if (!index.titles.length || revision !== index.revision) {
      index.titles = await getLocalCatalogTitles();
      index.revision = revision;
    }
    index.nextRevisionCheck = Date.now() + revisionCheckIntervalMs;
    return index.titles;
  })().finally(() => { index.pending = undefined; });
  return index.pending;
}

/** Warm the lightweight source-title cache without blocking the Node event loop on fuzzy scoring. */
export async function prewarmMedusaTitleIndex(): Promise<void> {
  if (!postgresCatalogEnabled()) return;
  await titles();
}

export async function getMedusaNavigation(): Promise<CatNode[]> {
  const local = await getCatalogReadCategoryTree();
  return local ?? getCategoryTree();
}

function categoryPresentation(node: CatNode): Category {
  const icon = /лекарств|бад/i.test(node.name) ? "pill" : /мам|малыш/i.test(node.name) ? "baby"
    : /гигиен/i.test(node.name) ? "shower" : /прибор/i.test(node.name) ? "stethoscope" : "sparkles";
  return { id: node.id, slug: node.handle, name: node.name, icon, from: "#f1faf5", to: "#e9f5ef", count: 0 };
}

export type MedusaCatalogPage = {
  products: Product[]; categories: Category[]; brands: Brand[]; facets?: CatalogFacets;
  count: number; catalogTotal: number; page: number; totalPages: number; hasMore: boolean;
  sourceMode: "medusa_postgres" | "medusa_api"; generatedAt: string; complete: boolean; stale: boolean;
  search?: ProductSearchMetadata;
};

async function loadMedusaCatalogPage(query: CatalogQuery, options: { exact?: boolean; pharmacies?: string[] } = {}): Promise<MedusaCatalogPage> {
  query = query.category ? { ...query, category: resolveMedusaCategoryHandle(query.category) } : query;
  const categories = (await getMedusaNavigation()).map(categoryPresentation);
  const pharmacies = options.pharmacies ?? [];
  if (postgresCatalogEnabled()) {
    try {
      // PostgreSQL owns the public search hot path. Scoring every imported title
      // synchronously blocked the Node event loop for tens of seconds on production
      // and made the health watchdog restart an otherwise healthy storefront.
      // Query-layout and transliteration variants are still supported, but each is
      // evaluated by the indexed SQL search and stops at the first non-empty result.
      const variants = query.q
        ? parseProductSearchQuery(query.q).variants.filter((variant) => !options.exact || variant.kind === "original")
        : [];
      let page;
      let search: ProductSearchMetadata | undefined;
      if (!variants.length) {
        page = await queryLocalCatalog(query, { pharmacies });
      } else {
        for (const variant of variants) {
          // The trigram/FTS indexes reduce 28k source rows to a bounded identity
          // candidate set. Canonical dose/form guards then run over at most 250
          // titles, never over the complete catalogue on the request thread.
          const candidates = await searchLocalProductTitleCandidates(variant.value, 250);
          const matched = matchMedusaTitles(candidates, query.q, options.exact);
          if (!matched.ids.length) continue;
          const candidate = await queryLocalCatalog({ ...query, q: "" }, {
            productIds: matched.ids,
            pharmacies,
          });
          if (!page) page = candidate;
          if (!candidate.count) continue;
          page = candidate;
          search = matched.search;
          break;
        }
        search ??= { query: query.q, matchedQuery: null, matchType: "none", degraded: false };
      }
      if (!page) page = await queryLocalCatalog({ ...query, q: "" }, { productIds: [], pharmacies });
      const pagination = cataloguePagination(page.count, query);
      const counts = new Map(page.facets?.categories.map((category) => [category.slug, category.count]));
      const brands = page.facets?.brands.map((brand) => ({ id: brand.key, slug: brand.key, name: brand.name, tagline: `${brand.count}`, hue: 150 })) ?? [];
      const stale = page.products.some((product) => product.stockStale === true);
      return { ...page, categories: categories.map((category) => ({ ...category, count: counts.get(category.slug) ?? 0 })), brands,
        page: pagination.page, totalPages: pagination.totalPages, hasMore: pagination.hasNext,
        sourceMode: "medusa_postgres", complete: true, stale, generatedAt: new Date().toISOString(), search };
    } catch (error) {
      console.error("[catalog] verified Medusa mirror unavailable", error instanceof Error ? error.message : "read_failed");
      if (pharmacies.length) throw new Error("selected_pharmacy_catalog_unavailable");
    }
  } else if (pharmacies.length) {
    throw new Error("selected_pharmacy_catalog_unavailable");
  }
  // A complete Medusa-only snapshot is the sole fallback. No Daribar URL/index/cache.
  const { snapshot } = await getCatalogReadSnapshot();
  if (!snapshot.complete) throw new Error("medusa_catalog_incomplete");
  const matched = query.q ? matchMedusaTitles(snapshot.products.map((product) => ({ id: product.id, title: product.name })), query.q, options.exact) : undefined;
  const ids = matched ? new Map(matched.ids.map((id, position) => [id, position])) : undefined;
  const candidates = ids ? snapshot.products.filter((product) => ids.has(product.id)).sort((a, b) => ids.get(a.id)! - ids.get(b.id)!) : snapshot.products;
  // If PostgreSQL is temporarily unavailable, the complete Medusa snapshot is
  // still filtered fail-closed: cards without a positive price, stock or a
  // concrete variant must not reappear through the fallback path.
  const products = filterAndSortCatalog(candidates, { ...query, q: "" }, { visibleOnly: true });
  const pagination = cataloguePagination(products.length, query);
  const facets = query.includeFacets ? buildCatalogFacets(products, categories) : undefined;
  return { products: products.slice(query.offset, query.offset + query.limit), categories, brands: buildCatalogBrands(products), facets,
    count: products.length, catalogTotal: snapshot.sourceCount, page: query.page, totalPages: pagination.totalPages, hasMore: pagination.hasNext,
    sourceMode: "medusa_api", generatedAt: snapshot.generatedAt, complete: snapshot.complete, stale: snapshot.stale, search: matched?.search };
}

export async function getMedusaCatalogPage(query: CatalogQuery, options: { exact?: boolean; pharmacies?: string[] } = {}): Promise<MedusaCatalogPage> {
  const key = JSON.stringify({
    query,
    exact: options.exact === true,
    pharmacies: [...(options.pharmacies ?? [])].sort(),
  });
  const now = Date.now();
  const cached = getLruEntry(pageCache, key);
  if (cached && cached.expiresAt > now) return cached.pending;
  if (cached) pageCache.delete(key);
  const pending = loadMedusaCatalogPage(query, options);
  const entry = { expiresAt: now + pageCacheTtlMs, pending };
  setLruEntry(pageCache, key, entry, pageCacheLimit);
  void pending.catch(() => {
    if (pageCache.get(key) === entry) pageCache.delete(key);
  });
  return pending;
}
