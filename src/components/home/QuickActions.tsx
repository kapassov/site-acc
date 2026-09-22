"use client";

import { Gift, ArrowRight } from "lucide-react";
import { useScanner } from "@/lib/ui/ScannerContext";
import { useLang } from "@/lib/i18n/LanguageContext";

export function QuickActions() {
  const { open } = useScanner();
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid gap-4">
        <button onClick={open} className="group relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 text-left transition hover:shadow-card">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{t("quick.scan.badge")}</span>
          <h3 className="mt-3 font-display text-xl font-bold text-slate-900">{t("quick.scan.t")}</h3>
          <p className="mt-1.5 max-w-xs text-sm text-slate-500">{t("quick.scan.s")}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">{t("quick.scan.cta")} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
          <Gift className="absolute -bottom-3 -right-3 h-28 w-28 text-slate-100" />
        </button>
      </div>
    </section>
  );
}
