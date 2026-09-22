import type { CatalogFacets } from "@/lib/catalog-query";
import type { Category } from "@/lib/types";

export function categoriesWithFullFacetCounts(
  categories: Category[],
  facets: CatalogFacets,
): { categories: Category[]; facets: CatalogFacets } {
  const counts = new Map(facets.categories.map((category) => [category.slug, category.count]));
  const counted = categories.map((category) => ({
    ...category,
    count: counts.get(category.slug) ?? 0,
  }));
  return {
    categories: counted,
    facets: {
      ...facets,
      categories: counted.map(({ id, slug, name, count }) => ({ id, slug, name, count })),
    },
  };
}

export function postgresCatalogMeta(input: {
  catalogTotal: number;
  facetProductCount?: number;
  loadedCount: number;
  generatedAt: string;
  includeFacets?: boolean;
  source?: "postgres" | "medusa";
}) {
  const direct = input.source === "medusa";
  const base = {
    source: input.source ?? "postgres",
    priceScope: direct ? "medusa_calculated_price" : "variant_or_pharmacy_offer",
    availabilityScope: direct ? "medusa_calculated_price" : "variant_or_pharmacy_offer",
    generatedAt: input.generatedAt,
    sourceCount: input.catalogTotal,
    loadedCount: input.loadedCount,
    complete: true,
    stale: false,
    degraded: false,
    dataState: "fresh" as const,
    responseScope: "bounded_page",
  };
  if (input.includeFacets === false) {
    return {
      ...base,
      facetScope: "omitted" as const,
    };
  }
  return {
    ...base,
    facetScope: "filtered_catalog",
    facetProductCount: input.facetProductCount ?? 0,
    facetBrandScope: "all_matching_products",
    facetCategoryScope: "top_level_with_descendants",
    brandScope: "top_100",
  };
}
