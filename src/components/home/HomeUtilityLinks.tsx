"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Percent, Stethoscope, Truck } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";

const items = [
  { key: "sale", href: "/promotions", icon: Percent },
  { key: "pharmacies", href: "/pharmacies", icon: MapPin },
  { key: "delivery", href: "/delivery", icon: Truck },
  { key: "devices", href: "/catalog/med-pribory-i-izdeliya", icon: Stethoscope },
] as const;

export function HomeUtilityLinks() {
  const { t } = useLang();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <nav aria-label={t("home.utility.label")} className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {items.map(({ key, href, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex min-h-20 items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-100 hover:shadow-card sm:min-h-24 sm:px-5"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 sm:h-12 sm:w-12">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-tight text-slate-900 sm:text-base">{t(`home.utility.${key}`)}</span>
              <span className="mt-1 hidden text-xs text-slate-500 sm:block">{t(`home.utility.${key}.sub`)}</span>
            </span>
            <ArrowRight className="hidden h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600 sm:block" />
          </Link>
        ))}
      </nav>
    </section>
  );
}
