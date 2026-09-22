import { NextResponse } from "next/server";
import { getMedusaCatalogPage } from "@/lib/medusa-catalog";
import { CatalogQueryError, parseCatalogQuery, cataloguePagination } from "@/lib/catalog-query";
import { resolveMedusaCategoryHandle } from "@/lib/category-aliases";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE = { "cache-control": "no-store" };
const PUBLIC_CATALOG_CACHE = { "cache-control": "public, max-age=15, s-maxage=30" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("exact") && !["0", "1"].includes(params.get("exact") || "")) throw new CatalogQueryError("exact");
    const query = parseCatalogQuery(params);
    const pharmacies = [...new Set(params.getAll("pharmacy").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
    if (pharmacies.length > 8 || pharmacies.some((id) => !/^sloc_[A-Za-z0-9]+$/.test(id))) throw new CatalogQueryError("pharmacy");
    const page = await getMedusaCatalogPage(query, { exact: params.get("exact") === "1", pharmacies });
    const pagination = cataloguePagination(page.count, query);
    return NextResponse.json({
      products: page.products,
      ...(query.includeFacets ? { categories: page.categories, brands: page.brands, facets: page.facets } : {}),
      schemaVersion: 2, count: page.count, catalogTotal: page.catalogTotal,
      limit: query.limit, offset: query.offset, page: query.page, hasMore: pagination.hasNext,
      nextOffset: pagination.nextOffset, pagination,
      filters: { ...query, category: query.category ? resolveMedusaCategoryHandle(query.category) : null },
      meta: {
        source: "medusa", sourceMode: page.sourceMode, searchEngine: "medusa_title_index",
        ...(page.search ? { search: page.search } : {}), pharmacies,
        priceScope: pharmacies.length ? "selected_pharmacy_price" : "medusa_last_known_price",
        availabilityScope: pharmacies.length ? "selected_pharmacy_stock" : "fresh_guarded_medusa_stock",
        generatedAt: page.generatedAt, sourceCount: page.catalogTotal, loadedCount: page.products.length,
        complete: page.complete, stale: page.stale, degraded: page.stale, dataState: page.stale ? "stale" : "fresh",
        coverage: "full_catalog", responseScope: "bounded_page",
        facetScope: query.includeFacets ? "full_filtered_medusa_catalog" : "omitted", facetCountsExact: page.complete,
      },
    }, { headers: { ...(page.stale ? NO_STORE : PUBLIC_CATALOG_CACHE), "x-catalog-source": "medusa", "x-data-state": page.stale ? "stale" : "fresh" } });
  } catch (error) {
    if (error instanceof CatalogQueryError) return NextResponse.json({ products: [], error: { code: error.code, field: error.field } }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ products: [], error: { code: "medusa_catalog_unavailable" } }, { status: 503, headers: NO_STORE });
  }
}
