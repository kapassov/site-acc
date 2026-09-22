"use client";

import { cn } from "@/lib/cn";
import type { ProductBadge } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageContext";

const cls: Record<ProductBadge, string> = {
  sale: "bg-accent-500 text-white",
  hit: "bg-brand-600 text-white",
  new: "bg-gold-500 text-white",
  rx: "bg-white text-slate-600 ring-1 ring-slate-200",
};

export function ProductBadgeChip({ badge, sale }: { badge: ProductBadge; sale?: number | null }) {
  const { t } = useLang();
  const label = badge === "sale" && sale ? `−${sale}%` : t(`badge.${badge}`);
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold tracking-tight", cls[badge])}>
      {label}
    </span>
  );
}
