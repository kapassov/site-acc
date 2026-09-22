"use client";

import { useCatalogData } from "@/lib/content/CatalogData";
import { ProductCard } from "@/components/product/ProductCard";
import { PromoGrid } from "@/components/home/PromoGrid";
import { PromoCodes } from "@/components/promo/PromoCodes";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";

export default function PromotionsPage() {
  const { t } = useLang();
  const { products } = useCatalogData();
  const sale = products.filter((p) => p.oldPrice != null).slice(0, 8);
  const special = products.filter((p) => p.badges.includes("hit") || p.badges.includes("new")).slice(0, 8);

  return (
    <div className="space-y-10 py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("nav.sale") }]} />
        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("promos.title")}</h1>
        <p className="mt-1 text-slate-500">{t("promos.sub")}</p>
      </div>

      <PromoGrid />

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="mb-5 font-display text-2xl font-bold text-slate-900">{t("promos.codes")}</h2>
        <PromoCodes />
      </section>

      {sale.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-bold text-slate-900">{t("promos.saleItems")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {sale.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {special.length > 0 && (<section className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="mb-5 font-display text-2xl font-bold text-slate-900">{t("promos.special")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {special.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>)}
    </div>
  );
}
