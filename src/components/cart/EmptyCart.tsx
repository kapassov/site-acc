"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cartExtraCopy } from "@/lib/i18n/cart-extra";

export function EmptyCart({ title, text, backHref = "/", notice }: { title?: string; text?: string; backHref?: string; notice?: ReactNode }) {
  const { lang, t } = useLang();
  const copy = cartExtraCopy[lang];
  return (
    <div className="relative z-0 mx-auto min-h-screen max-w-5xl px-3 pb-16 sm:px-6 before:fixed before:inset-0 before:-z-10 before:bg-slate-50">
      <div className="-mx-3 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:-mx-6 sm:px-6">
        <Link href={backHref} aria-label={copy.back} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 active:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="font-semibold text-slate-800">{copy.back}</span>
      </div>
      {notice}
      <div className="flex flex-col items-center py-20 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-slate-50 text-slate-300">
          <ShoppingBag className="h-10 w-10" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">{title ?? t("cart.empty.t")}</h1>
        <p className="mt-2 max-w-sm text-slate-500">{text ?? t("cart.empty.s")}</p>
        <Link href="/catalog" className="mt-6 inline-flex h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white transition hover:bg-brand-700">
          {t("common.toCatalog")}
        </Link>
      </div>
    </div>
  );
}
