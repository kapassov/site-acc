"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/cn";
import type { Product } from "@/lib/types";

type TabKey = "popular" | "deals" | "new";

export function FeaturedProductsTabs({ popular, deals, newArrivals }: { popular: Product[]; deals: Product[]; newArrivals: Product[] }) {
  const { t } = useLang();
  const rail = useRef<HTMLDivElement>(null);
  const tabs = useMemo(() => [
    { key: "popular" as const, products: popular, href: "/catalog" },
    ...(deals.length ? [{ key: "deals" as const, products: deals, href: "/promotions" }] : []),
    { key: "new" as const, products: newArrivals, href: "/catalog?sort=new" },
  ].filter((tab) => tab.products.length), [deals, newArrivals, popular]);
  const [active, setActive] = useState<TabKey>(tabs[0]?.key ?? "popular");
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  if (!current) return null;

  const scroll = (direction: number) => rail.current?.scrollBy({ left: direction * 520, behavior: "smooth" });

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-4 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("home.featured.title")}</h2>
          <p className="mt-1 text-sm text-slate-500 sm:text-base">{t("home.featured.sub")}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              aria-pressed={tab.key === current.key}
              className={cn(
                "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition",
                tab.key === current.key ? "bg-brand-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-700",
              )}
            >
              {t(`home.featured.${tab.key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex justify-end gap-2">
        <Link href={current.href} className="mr-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-800 hover:text-brand-600">
          {t("common.viewAll")} <ArrowRight className="h-4 w-4" />
        </Link>
        <button type="button" onClick={() => scroll(-1)} aria-label={t("common.previous")} className="hidden h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:border-brand-200 hover:text-brand-700 md:grid">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => scroll(1)} aria-label={t("common.next")} className="hidden h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:border-brand-200 hover:text-brand-700 md:grid">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div ref={rail} key={current.key} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
        {current.products.map((product) => (
          <div key={product.id} className="w-[206px] shrink-0 snap-start sm:w-[248px] lg:w-[256px]">
            <ProductCard product={product} boxed />
          </div>
        ))}
      </div>
    </section>
  );
}
