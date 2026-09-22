"use client";

import type { Brand, Product } from "@/lib/types";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";

export function BrandView({ brand, products }: { brand: Brand; products: Product[] }) {
  const { t, plural } = useLang();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("brands.title"), href: "/brands" }, { label: brand.name }]} />

      <div className="mt-6 overflow-hidden rounded-3xl p-8 text-center sm:p-12" style={{ background: `linear-gradient(135deg, hsl(${brand.hue} 60% 96%), hsl(${brand.hue} 55% 89%))` }}>
        <h1 className="font-display text-4xl font-extrabold tracking-tight" style={{ color: `hsl(${brand.hue} 48% 38%)` }}>{brand.name}</h1>
        <p className="mt-2 text-slate-600">{brand.tagline}</p>
      </div>

      <p className="mt-6 text-slate-500">{products.length} {plural(products.length)}</p>

      {products.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">{t("brands.soon")}</p>
      )}
    </div>
  );
}
