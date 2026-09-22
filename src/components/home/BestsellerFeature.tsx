"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCatalogData } from "@/lib/content/CatalogData";
import { ProductImage } from "@/components/ui/ProductImage";
import { useLang } from "@/lib/i18n/LanguageContext";

export function BestsellerFeature() {
  const { t } = useLang();
  const { products } = useCatalogData();
  const a = products[0];
  const b = products[1] ?? products[0];

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid items-center gap-7 sm:gap-10 lg:grid-cols-2">
        <div>
          <span className="inline-block rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">{t("bf.eyebrow")}</span>
          <h2 className="mt-4 font-display text-3xl font-extrabold leading-[1.08] sm:mt-5 tracking-tight text-slate-900 text-balance sm:text-5xl">{t("bf.title")}</h2>
          <p className="mt-4 max-w-md text-base leading-relaxed sm:mt-5 sm:text-lg text-slate-500">{t("bf.sub")}</p>
          <Link href="/promotions" className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 sm:mt-7 sm:h-13 sm:rounded-full sm:px-8 font-semibold text-white transition hover:bg-brand-700">
            {t("bf.cta")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="overflow-hidden rounded-3xl shadow-card">
            <div className="relative aspect-[16/11] bg-slate-50">{a && <ProductImage product={a} className="absolute inset-0 h-full w-full" />}</div>
            <div className="relative aspect-[16/11] bg-slate-50">{b && <ProductImage product={b} className="absolute inset-0 h-full w-full" />}</div>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            <polyline points="20,13 20,50 84,50 84,86" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute left-4 top-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-pop">{t("bf.b1")}</span>
          <span className="absolute bottom-4 right-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-pop">{t("bf.b2")}</span>
        </div>
      </div>
    </section>
  );
}
