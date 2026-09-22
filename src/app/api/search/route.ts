import { NextResponse } from "next/server";
import { getMedusaCatalogPage } from "@/lib/medusa-catalog";
import { parseCatalogQuery, CatalogQueryError } from "@/lib/catalog-query";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store", "x-search-source": "medusa" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!(params.get("q") || "").trim()) return NextResponse.json({ products: [] }, { headers: NO_STORE });
  try {
    if (params.has("exact") && !["0", "1"].includes(params.get("exact") || "")) throw new CatalogQueryError("exact");
    const pharmacies = [...new Set(params.getAll("pharmacy").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
    if (pharmacies.length > 8 || pharmacies.some((id) => !/^sloc_[A-Za-z0-9]+$/.test(id))) throw new CatalogQueryError("pharmacy");
    const queryParams = new URLSearchParams({ q: params.get("q") || "", limit: params.get("limit") || "48", facets: "0" });
    const page = await getMedusaCatalogPage(parseCatalogQuery(queryParams), { exact: params.get("exact") === "1", pharmacies });
    return NextResponse.json({ products: page.products, count: page.count,
      meta: { source: "medusa", mode: pharmacies.length ? "selected_pharmacies" : "title_fuzzy", engine: "medusa_title_index", search: page.search, stale: page.stale, pharmacies } },
    { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ products: [], error: { code: error instanceof CatalogQueryError ? "invalid_search_query" : "medusa_search_unavailable" } },
      { status: error instanceof CatalogQueryError ? 400 : 503, headers: NO_STORE });
  }
}
