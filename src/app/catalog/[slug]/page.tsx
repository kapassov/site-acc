import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolveMedusaCategoryHandle } from "@/lib/category-aliases";
import { CatalogView } from "@/components/catalog/CatalogView";
import { getCategoryName } from "@/lib/api";
import { parseCatalogQuery } from "@/lib/catalog-query";
import { getStorefrontCatalogPage, getStorefrontNavigation, storefrontCatalogSource } from "@/lib/storefront-catalog";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const canonicalSlug = storefrontCatalogSource() === "daribar" ? slug : resolveMedusaCategoryHandle(slug);
  const name = await getCategoryName(canonicalSlug);
  return {
    title: name || "Каталог",
    description: name ? `${name}: товары, цены и наличие в аптеках.` : "Каталог товаров для здоровья.",
    alternates: { canonical: `/catalog/${canonicalSlug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  const { slug } = await params;
  const rawSearch = await searchParams;
  const requestedPage = Array.isArray(rawSearch.page) ? rawSearch.page[0] : rawSearch.page;
  const canonicalSlug = storefrontCatalogSource() === "daribar" ? slug : resolveMedusaCategoryHandle(slug);
  if (canonicalSlug !== slug) redirect(`/catalog/${canonicalSlug}`);
  const categoryName = await getCategoryName(canonicalSlug);
  if (!categoryName) notFound();
  const queryParams = new URLSearchParams({ category: canonicalSlug, limit: "24", facets: "0" });
  if (requestedPage && /^\d{1,6}$/.test(requestedPage)) queryParams.set("page", requestedPage);
  const initialQuery = parseCatalogQuery(queryParams);
  const [catalogPage, tree] = await Promise.all([
    getStorefrontCatalogPage(initialQuery).catch(() => null),
    getStorefrontNavigation().catch(() => []),
  ]);

  return (
    <CatalogView
      key={canonicalSlug}
      products={catalogPage?.products ?? []}
      tree={tree}
      activeHandle={canonicalSlug}
      totalCount={catalogPage?.count}
      initialPageVerified={catalogPage !== null}
      initialPage={initialQuery.page}
      initialFacets={catalogPage?.facets ?? null}
      heading={categoryName}
    />
  );
}
