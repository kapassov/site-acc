"use client";

import { useState } from "react";
import { ChevronDown, Phone, Mail, MessageCircle, Clock } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";
import { staticPagesCopy } from "@/lib/i18n/static-pages";

export default function HelpPage() {
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  const faq = [
    { id: "order", q: copy["help.faq.order.q"], a: copy["help.faq.order.a"] },
    { id: "delivery", q: copy["help.faq.delivery.q"], a: copy["help.faq.delivery.a"] },
    { id: "payment", q: copy["help.faq.payment.q"], a: copy["help.faq.payment.a"] },
    { id: "bonus", q: copy["help.faq.bonus.q"], a: copy["help.faq.bonus.a"] },
    { id: "return", q: copy["help.faq.return.q"], a: copy["help.faq.return.a"] },
    { id: "rx", q: copy["help.faq.rx.q"], a: copy["help.faq.rx.a"] },
    { id: "stock", q: copy["help.faq.stock.q"], a: copy["help.faq.stock.a"] },
  ];
  const [open, setOpen] = useState(0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("top.help") }]} />
      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("top.help")}</h1>
      <p className="mt-1 text-slate-500">{copy["help.intro"]}</p>

      <div className="mt-6 space-y-2.5">
        {faq.map((item, i) => {
          const on = i === open;
          return (
            <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-soft">
              <button onClick={() => setOpen(on ? -1 : i)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
                <span className="font-semibold text-slate-900">{item.q}</span>
                <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${on ? "rotate-180" : ""}`} />
              </button>
              {on && <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</p>}
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white sm:p-8">
        <h2 className="font-display text-xl font-bold">{copy["help.support.title"]}</h2>
        <p className="mt-1 text-brand-50/90">{copy["help.support.hours"]}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <a href="tel:+77000000000" className="flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3 transition hover:bg-white/20">
            <Phone className="h-5 w-5" /> <span className="text-sm font-semibold">+7 700 000 00 00</span>
          </a>
          <a href="mailto:help@darihana.kz" className="flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3 transition hover:bg-white/20">
            <Mail className="h-5 w-5" /> <span className="text-sm font-semibold">help@darihana.kz</span>
          </a>
          <div className="flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3">
            <MessageCircle className="h-5 w-5" /> <span className="text-sm font-semibold">{copy["help.support.chat"]}</span>
          </div>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-brand-50/80"><Clock className="h-3.5 w-3.5" /> {copy["help.support.response"]}</p>
      </div>
    </div>
  );
}
