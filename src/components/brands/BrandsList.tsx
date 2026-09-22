"use client";

import Link from "next/link";
import type { Brand } from "@/lib/types";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";

export function BrandsList({ brands }: { brands: Brand[] }) {
  const { t } = useLang();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("brands.title") }]} />
      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("brands.title")}</h1>
      <p className="mt-1 text-slate-500">{t("brands.sub")}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {brands.map((b) => (
          <Link
            key={b.id}
            href={`/brands/${b.slug}`}
            className="group flex h-36 flex-col items-center justify-center rounded-2xl border border-slate-100 px-3 text-center transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-card"
          >
            <span className="line-clamp-2 font-display text-lg font-extrabold leading-tight tracking-tight transition group-hover:scale-105" style={{ color: `hsl(${b.hue} 48% 42%)` }}>{b.name}</span>
            <span className="mt-1.5 text-xs text-slate-400">{b.tagline}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
