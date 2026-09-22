"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { useFavorites } from "@/lib/favorites/FavoritesContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useCatalogData } from "@/lib/content/CatalogData";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";

export default function FavoritesPage() {
  const { ids } = useFavorites();
  const { t } = useLang();
  const { products, ready } = useCatalogData();
  const list = products.filter((p) => ids.includes(p.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("fav.title") }]} />
      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("fav.title")}</h1>

      {!ready ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-slate-200 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-slate-300"><Heart className="h-8 w-8" /></span>
          <p className="mt-4 font-semibold text-slate-800">{t("fav.empty.t")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("fav.empty.s")}</p>
          <Link href="/catalog" className="mt-5 inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white transition hover:bg-brand-700">{t("fav.empty.cta")}</Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
