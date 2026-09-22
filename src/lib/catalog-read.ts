import { getLocalCatalogSnapshot } from "@/lib/catalog-db";
import {
  getLocalBrandProducts,
  getLocalBrandCounts,
  getLocalCategoryProducts,
  getLocalCategoryTree,
  getLocalProduct,
  getLocalProductsPage,
  queryLocalCatalog,
  searchLocalProductTitleCandidates,
  searchLocalProducts,
} from "@/lib/catalog-local-read";
import type { CatalogQuery } from "@/lib/catalog-query";
import { getMedusaCatalogSnapshot, getMedusaProducts } from "@/lib/medusa";
import {
  prefersPostgresCatalog,
  resolveCatalogSource,
  type CatalogReadResult,
} from "@/lib/catalog-source";
import type { Product } from "@/lib/types";

export function postgresCatalogEnabled(): boolean {
  return prefersPostgresCatalog(process.env.CATALOG_READ_SOURCE);
}

export async function getCatalogReadSnapshot(): Promise<CatalogReadResult> {
  return resolveCatalogSource(process.env.CATALOG_READ_SOURCE, {
    local: getLocalCatalogSnapshot,
    medusa: getMedusaCatalogSnapshot,
  });
}

/**
 * Safe SSR/listing read. The small Medusa page is the final last-known-real
 * fallback when both the verified local snapshot and complete Medusa scan fail.
 */
export async function getCatalogReadProducts(limit = 250): Promise<Product[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit) || 250));
  if (postgresCatalogEnabled()) {
    try {
      return await getLocalProductsPage(safeLimit);
    } catch (error) {
      console.error("[catalog] bounded postgres read unavailable; falling back to Medusa", error);
    }
  }
  try {
    const products = await getMedusaProducts(Math.min(100, safeLimit));
    if (products.length > 0) return products;
  } catch {
    // The public storefront API below remains the last real-data fallback.
  }
  throw new Error("medusa_catalog_unavailable");
}

export async function getCatalogReadProduct(handle: string): Promise<Product | null | undefined> {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await getLocalProduct(handle);
  } catch (error) {
    console.error("[catalog] postgres product read unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function searchCatalogReadProducts(query: string, limit: number): Promise<Product[] | undefined> {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await searchLocalProducts(query, limit);
  } catch (error) {
    console.error("[catalog] postgres search unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function searchCatalogTitleIndex(query: string, limit: number) {
  try {
    return await searchLocalProductTitleCandidates(query, limit);
  } catch (error) {
    console.error("[catalog] title index unavailable", error);
    return [];
  }
}

export async function getCatalogReadBrandProducts(slug: string, limit = 250): Promise<Product[] | undefined> {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await getLocalBrandProducts(slug, limit);
  } catch (error) {
    console.error("[catalog] postgres brand read unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function getCatalogReadBrandCounts() {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await getLocalBrandCounts();
  } catch (error) {
    console.error("[catalog] postgres brand aggregation unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function getCatalogReadCategoryProducts(
  handle: string,
  limit = 60,
): Promise<{ products: Product[]; count: number } | undefined> {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await getLocalCategoryProducts(handle, limit);
  } catch (error) {
    console.error("[catalog] postgres category read unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function getCatalogReadCategoryTree() {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await getLocalCategoryTree();
  } catch (error) {
    console.error("[catalog] postgres category tree unavailable; falling back to Medusa", error);
    return undefined;
  }
}

export async function getCatalogReadPage(query: CatalogQuery) {
  if (!postgresCatalogEnabled()) return undefined;
  try {
    return await queryLocalCatalog(query);
  } catch (error) {
    console.error("[catalog] postgres filtered page unavailable; falling back to Medusa", error);
    return undefined;
  }
}
