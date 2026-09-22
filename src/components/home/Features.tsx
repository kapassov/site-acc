"use client";

import { Truck, ShieldCheck, Coins, Stethoscope } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";

const items = [
  { icon: Truck, k: "delivery" },
  { icon: ShieldCheck, k: "original" },
  { icon: Coins, k: "cashback" },
  { icon: Stethoscope, k: "rx" },
];

export function Features() {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-white p-2.5 sm:gap-4 sm:p-4 lg:grid-cols-4">
        {items.map(({ icon: Icon, k }) => (
          <div key={k} className="flex items-center gap-2 rounded-xl p-2 sm:gap-3.5 sm:p-2.5 transition hover:bg-slate-50">
            <span className="grid h-10 w-10 shrink-0 sm:h-12 sm:w-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <div>
              <p className="text-[13px] font-semibold leading-tight sm:text-sm text-slate-900">{t(`feat.${k}.t`)}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-xs">{t(`feat.${k}.s`)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
