"use client";

import Link from "next/link";
import { Leaf, ShieldCheck, Truck, HeartHandshake, Sparkles } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";
import { staticPagesCopy } from "@/lib/i18n/static-pages";

export default function AboutPage() {
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  const stats = [
    { id: "pharmacies", big: "8", label: copy["about.stat.pharmacies"] },
    { id: "delivery", big: copy["about.stat.deliveryValue"], label: copy["about.stat.delivery"] },
    { id: "products", big: "10 000+", label: copy["about.stat.products"] },
    { id: "rating", big: "4.9", label: copy["about.stat.rating"] },
  ];
  const values = [
    { id: "original", icon: ShieldCheck, title: copy["about.value.original.title"], text: copy["about.value.original.text"] },
    { id: "care", icon: Leaf, title: copy["about.value.care.title"], text: copy["about.value.care.text"] },
    { id: "fast", icon: Truck, title: copy["about.value.fast.title"], text: copy["about.value.fast.text"] },
    { id: "bonus", icon: HeartHandshake, title: copy["about.value.bonus.title"], text: copy["about.value.bonus.text"] },
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("f.company.1") }]} />

      <div className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-8 text-white sm:p-12">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium"><Sparkles className="h-4 w-4" /> Аптека со склада</span>
        <h1 className="mt-4 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">{copy["about.hero.title"]}</h1>
        <p className="mt-4 max-w-xl text-brand-50/90">{copy["about.hero.sub"]}</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.id} className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-soft">
            <p className="font-display text-2xl font-extrabold text-brand-700">{s.big}</p>
            <p className="mt-1 text-xs font-medium text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-display text-2xl font-bold text-slate-900">{copy["about.beliefs"]}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {values.map((v) => (
          <div key={v.id} className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-soft">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600"><v.icon className="h-6 w-6" /></span>
            <div>
              <h3 className="font-semibold text-slate-900">{v.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{v.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-start gap-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">{copy["about.cta.title"]}</h2>
          <p className="mt-1 text-slate-500">{copy["about.cta.sub"]}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/catalog" className="inline-flex h-12 items-center rounded-2xl bg-brand-600 px-6 font-semibold text-white transition hover:bg-brand-700">{copy["about.cta.catalog"]}</Link>
          <Link href="/pharmacies" className="inline-flex h-12 items-center rounded-2xl border border-slate-200 px-6 font-semibold text-slate-700 transition hover:border-brand-300">{copy["about.cta.pharmacies"]}</Link>
        </div>
      </div>
    </div>
  );
}
