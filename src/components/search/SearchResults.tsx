"use client";

import { useSearchParams } from "next/navigation";
import { CatalogView } from "@/components/catalog/CatalogView";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";

export function SearchResults() {
  const sp = useSearchParams();
  const q = (sp.get("q") || "").trim();
  const exactSearch = sp.get("exact") === "1";
  const requestedPage = Number(sp.get("page") || "1");
  const initialPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pharmacyCodes = [...new Set(
    sp.getAll("pharmacy").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean),
  )].slice(0, 8);
  const { t } = useLang();
  // The full Daribar-backed search response is authoritative. A local preview
  // from the first catalogue page can show unrelated cards and then disappear.

  if (!q) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("search.title") }]} />
        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("search.title")}</h1>
        <p className="mt-1 text-slate-500">{t("search.hint")}</p>
      </div>
    );
  }

  return (
    <CatalogView
      key={`${q}:${exactSearch}:${pharmacyCodes.join(",")}`}
      products={[]}
      tree={[]}
      searchQuery={q}
      exactSearch={exactSearch}
      initialPage={initialPage}
      pharmacyCodes={pharmacyCodes}
      heading={`${t("search.results")} «${q}»`}
      crumbs={[{ label: t("common.home"), href: "/" }, { label: t("search.title") }]}
    />
  );
}
