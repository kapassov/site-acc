import type { CatalogQuery } from "./catalog-query.ts";
import type { CatNode } from "./types.ts";
import { servesDaribarCatalog } from "./catalog-provider.ts";
import { getMedusaCatalogPage, getMedusaNavigation } from "./medusa-catalog.ts";
import { getDaribarCatalogPage } from "./daribar/catalog.ts";
import { daribarCategoryDefinitions } from "./daribar/catalog-data.ts";

export function storefrontCatalogSource(): "medusa" | "daribar" {
  return servesDaribarCatalog() ? "daribar" : "medusa";
}

export async function getStorefrontCatalogPage(
  query: CatalogQuery,
  options: { exact?: boolean; pharmacies?: string[]; city?: string } = {},
) {
  if (servesDaribarCatalog()) {
    return getDaribarCatalogPage(query, options.city, { exact: options.exact });
  }
  return getMedusaCatalogPage(query, { exact: options.exact, pharmacies: options.pharmacies });
}

export async function getStorefrontNavigation(): Promise<CatNode[]> {
  if (!servesDaribarCatalog()) return getMedusaNavigation();
  return daribarCategoryDefinitions().map((category) => ({
    id: category.id,
    name: category.name,
    handle: category.slug,
    children: [],
  }));
}

