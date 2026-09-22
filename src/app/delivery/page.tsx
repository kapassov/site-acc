"use client";

import Link from "next/link";
import { Truck, Store, Package, CreditCard, Wallet, Sparkles, Clock, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";
import { staticPagesCopy } from "@/lib/i18n/static-pages";

export default function DeliveryPage() {
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  const delivery = [
    { id: "courier", icon: Truck, title: copy["delivery.courier.title"], time: copy["delivery.courier.time"], text: copy["delivery.courier.text"] },
    { id: "pickup", icon: Store, title: copy["delivery.pickup.title"], time: copy["delivery.pickup.time"], text: copy["delivery.pickup.text"] },
    { id: "post", icon: Package, title: copy["delivery.post.title"], time: copy["delivery.post.time"], text: copy["delivery.post.text"] },
  ];
  const payment = [
    { id: "card", icon: CreditCard, title: copy["delivery.card.title"], text: copy["delivery.card.text"] },
    { id: "cash", icon: Wallet, title: copy["delivery.cash.title"], text: copy["delivery.cash.text"] },
    { id: "points", icon: Sparkles, title: copy["delivery.points.title"], text: copy["delivery.points.text"] },
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("f.buyers.1") }]} />
      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("f.buyers.1")}</h1>
      <p className="mt-1 text-slate-500">{copy["delivery.intro"]}</p>

      <h2 className="mt-8 font-display text-xl font-bold text-slate-900">{copy["delivery.section.delivery"]}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {delivery.map((d) => (
          <div key={d.id} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-soft">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><d.icon className="h-6 w-6" /></span>
            <h3 className="mt-4 font-semibold text-slate-900">{d.title}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-brand-700"><Clock className="h-4 w-4" /> {d.time}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{d.text}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-slate-900">{copy["delivery.section.payment"]}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {payment.map((p) => (
          <div key={p.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-50 text-slate-700"><p.icon className="h-5 w-5" /></span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">{p.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{p.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-start gap-4 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-bold">{copy["delivery.rx.title"]}</h2>
            <p className="mt-1 max-w-md text-sm text-brand-50/90">{copy["delivery.rx.text"]}</p>
          </div>
        </div>
        <Link href="/catalog" className="inline-flex h-12 shrink-0 items-center rounded-2xl bg-white px-6 font-semibold text-brand-700 transition hover:bg-brand-50">{copy["delivery.catalog"]}</Link>
      </div>
    </div>
  );
}
