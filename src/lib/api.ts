/** Medusa is the catalog/price/stock authority. PostgreSQL is its verified read mirror. */
import type { Brand, CatNode, Category, Product, ProductBadge } from "./types.ts";
import type { PriceInfo } from "./price-info.ts";
import { catalogBrandKey, type CatalogQuery } from "./catalog-query.ts";
import { getMedusaCatalogPage, getMedusaNavigation } from "./medusa-catalog.ts";
import { getCatalogReadProduct } from "./catalog-read.ts";
import { getLocalBrandCounts } from "./catalog-local-read.ts";
import { getMedusaProductByHandle, getPharmacyPrices } from "./medusa.ts";
import { sourceProductSlug } from "./product-normalization.ts";

function query(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  const limit = Math.min(250, Math.max(1, Math.trunc(overrides.limit ?? 250)));
  const offset = Math.max(0, Math.trunc(overrides.offset ?? 0));
  return { q: "", category: null, brands: [], minPrice: null, maxPrice: null, inStock: false, sale: false,
    prescription: "all", sort: "relevance", includeFacets: false, ...overrides, limit, offset, page: Math.floor(offset / limit) + 1 };
}
export async function getCategories(): Promise<Category[]> { return (await getMedusaCatalogPage(query({ limit: 1, includeFacets: true }))).categories; }
export function withCategoryCounts(categories: Category[], products: Product[]): Category[] {
  return categories.map((category) => ({ ...category, count: products.filter((product) => product.categorySlug === category.slug || product.categoryHandles?.includes(category.slug)).length }));
}
export async function getBrands(limit = 250): Promise<Brand[]> {
  try {
    const rows = await getLocalBrandCounts(limit);
    return rows.map(({ name, count }) => {
      const slug = catalogBrandKey(name);
      let hue = 0;
      for (let index = 0; index < slug.length; index += 1) hue = (hue * 31 + slug.charCodeAt(index)) % 360;
      return { id: slug, slug, name, tagline: `${count}`, hue };
    });
  } catch {
    return (await getMedusaCatalogPage(query({ limit: 1, includeFacets: true }))).brands.slice(0, limit);
  }
}
export async function getProductsByBrand(slug: string) { return (await getMedusaCatalogPage(query({ brands: [catalogBrandKey(slug)] }))).products; }
export async function getProducts(): Promise<Product[]> { return (await getMedusaCatalogPage(query())).products; }
export async function getProductsByBadge(badge: ProductBadge) {
  return badge === "rx" ? (await getMedusaCatalogPage(query({ prescription: "rx" }))).products : (await getProducts()).filter((p) => p.badges.includes(badge));
}
export async function getBestsellers(limit = 8) { return (await getMedusaCatalogPage(query({ inStock: true, prescription: "otc", limit }))).products; }
export async function getNewArrivals(limit = 8) { return getBestsellers(limit); }
export async function getDeals(limit = 8) { return (await getMedusaCatalogPage(query({ sale: true, inStock: true, limit }))).products; }
export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(slug) || slug.startsWith("daribar-")) return null;
  const handle = sourceProductSlug(slug);
  const local = await getCatalogReadProduct(handle);
  if (local !== undefined) return local;
  return getMedusaProductByHandle(handle);
}
export async function searchProducts(value: string, limit = 40) { return value.trim() ? (await getMedusaCatalogPage(query({ q: value.trim(), limit }))).products : []; }
export async function getPrices(productId: string): Promise<PriceInfo | null> { return getPharmacyPrices(productId); }
export async function getVariants(product: Product): Promise<Product[]> { void product; return []; }
export async function getRelated(product: Product, limit = 5) {
  const page = await getMedusaCatalogPage(query({ category: product.categorySlug || null, inStock: true, limit: limit + 1 }));
  return page.products.filter((candidate) => candidate.id !== product.id).slice(0, limit);
}
export async function getProductsByCategory(slug: string) { return (await getMedusaCatalogPage(query({ category: slug }))).products; }
export async function getCatTree(): Promise<CatNode[]> { return getMedusaNavigation(); }
export async function getCategoryName(handle: string): Promise<string | null> {
  const find = (nodes: CatNode[]): string | null => { for (const node of nodes) { if (node.handle === handle) return node.name; const nested = find(node.children); if (nested) return nested; } return null; };
  return find(await getCatTree());
}
export async function getCategoryProducts(handle: string, limit = 60) { const page = await getMedusaCatalogPage(query({ category: handle, limit })); return { products: page.products, count: page.count }; }
export type { PrescriptionFilter } from "./catalog-query.ts";
