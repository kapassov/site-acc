"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { useLang } from "@/lib/i18n/LanguageContext";
import type { Product } from "@/lib/types";

export function ProductRow({ titleKey, subtitleKey, products }: { titleKey: string; subtitleKey?: string; products: Product[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLang();
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 520, behavior: "smooth" });

  // Никаких пустых каруселей: если бэкенд не отдал товары — секцию не показываем.
  if (!products.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-4 flex items-end justify-between gap-3 sm:mb-6 sm:gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t(titleKey)}</h2>
          {subtitleKey && <p className="mt-1 text-sm leading-relaxed text-slate-500 sm:mt-1.5 sm:text-base">{t(subtitleKey)}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/catalog" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-800 transition hover:text-brand-600 sm:gap-1.5 sm:text-sm">
            {t("common.viewAll")} <ArrowRight className="h-4 w-4" />
          </Link>
          <div className="hidden gap-1.5 md:flex">
            <button onClick={() => scroll(-1)} aria-label="←" className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:border-brand-300 hover:text-brand-800">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={() => scroll(1)} aria-label="→" className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:border-brand-300 hover:text-brand-800">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div ref={ref} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
        {products.map((p) => (
          <div key={p.id} className="w-[206px] shrink-0 snap-start sm:w-[248px] lg:w-[256px]">
            <ProductCard product={p} boxed />
          </div>
        ))}
      </div>
    </section>
  );
}
