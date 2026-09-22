"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";

export function QuantityStepper({
  qty,
  onChange,
  size = "md",
}: {
  qty: number;
  onChange: (next: number) => void;
  size?: "sm" | "md";
}) {
  const { t } = useLang();
  const h = "h-11";
  const btn = "w-11";
  const num = size === "sm" ? "w-9 text-sm" : "w-10 text-base";
  const atMinimum = qty <= 1;

  return (
    <div className={cn("inline-flex items-center rounded-xl border border-slate-200 bg-white", h)}>
      <button
        type="button"
        onClick={() => { if (!atMinimum) onChange(qty - 1); }}
        disabled={atMinimum}
        aria-disabled={atMinimum}
        aria-label={t("common.decrease")}
        className={cn("grid h-full place-items-center rounded-l-xl text-slate-500 transition hover:bg-slate-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-500", btn)}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className={cn("text-center font-semibold tabular-nums text-slate-900", num)}>{qty}</span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label={t("common.increase")}
        className={cn("grid h-full place-items-center rounded-r-xl text-slate-500 transition hover:bg-slate-50 hover:text-brand-700", btn)}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
