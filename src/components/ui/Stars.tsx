"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";

export function Stars({ value, className }: { value: number; className?: string }) {
  const { t } = useLang();
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={cn("relative inline-flex", className)} aria-label={t("a11y.rating", { value })}>
      <span className="flex text-slate-200">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
        ))}
      </span>
      <span className="absolute inset-0 flex overflow-hidden text-amber-400" style={{ width: `${pct}%` }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="h-3.5 w-3.5 shrink-0" fill="currentColor" strokeWidth={0} />
        ))}
      </span>
    </span>
  );
}
