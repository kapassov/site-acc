import type { Metadata } from "next";
import { parseCatalogQuery } from "@/lib/catalog-query";
import { CatalogView } from "@/components/catalog/CatalogView";
import { getMedusaCatalogPage, getMedusaNavigation } from "@/lib/medusa-catalog";

export const metadata: Metadata = {
  title: "Каталог",
  description: "Лекарства, витамины, косметика и товары для здоровья: цены и наличие.",
  alternates: { canonical: "/catalog" },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const rawSearch = await searchParams;
  const q = Array.isArray(rawSearch.q) ? rawSearch.q[0] : rawSearch.q;
  const requestedPage = Array.isArray(rawSearch.page) ? rawSearch.page[0] : rawSearch.page;
  const params = new URLSearchParams({ limit: "24", facets: "0" });
  if (requestedPage && /^\d{1,6}$/.test(requestedPage)) params.set("page", requestedPage);
  if (q) params.set("q", q);
  const initialQuery = parseCatalogQuery(params);
  const [catalogPage, tree] = await Promise.all([
    getMedusaCatalogPage(initialQuery).catch(() => null),
    getMedusaNavigation().catch(() => []),
  ]);

  return (
    <CatalogView
      key={initialQuery.q || "catalog"}
      products={catalogPage?.products ?? []}
      tree={tree}
      totalCount={catalogPage?.count}
      initialPageVerified={catalogPage !== null}
      initialPage={initialQuery.page}
      initialFacets={catalogPage?.facets ?? null}
      searchQuery={initialQuery.q}
    />
  );
}
