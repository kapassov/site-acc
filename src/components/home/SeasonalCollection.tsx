"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { useLang } from "@/lib/i18n/LanguageContext";
import type { Product } from "@/lib/types";

export function SeasonalCollection({ products }: { products: Product[] }) {
  const { t } = useLang();
  const visible = products.slice(0, 3);
  if (!visible.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[0.9fr_2.1fr]">
        <Link href="/catalog/zagar-i-zashita-ot-solnca" className="group relative min-h-[260px] overflow-hidden rounded-3xl bg-brand-800 p-6 text-white shadow-sm sm:min-h-[320px] sm:p-8 lg:min-h-[460px]">
          <Image src="/promo/banner-lifestyle-wellness.webp" alt="" fill sizes="(max-width: 1023px) 100vw, 35vw" className="object-cover transition duration-700 group-hover:scale-[1.03]" style={{ objectPosition: "58% center" }} />
          <span className="absolute inset-0 bg-gradient-to-br from-[#153c2f]/95 via-[#153c2f]/72 to-[#153c2f]/15" />
          <span className="relative z-10 flex h-full max-w-sm flex-col items-start justify-end">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/75">{t("home.season.eyebrow")}</span>
            <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight sm:text-4xl">{t("home.season.title")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/85 sm:text-base">{t("home.season.sub")}</p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900">
              {t("home.season.cta")} <ArrowRight className="h-4 w-4" />
            </span>
          </span>
        </Link>

        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0">
          {visible.map((product) => (
            <div key={product.id} className="w-[220px] shrink-0 snap-start sm:w-[248px] lg:w-auto">
              <ProductCard product={product} boxed />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
