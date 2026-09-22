"use client";

import Link from "next/link";
import { Home, LayoutGrid } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";

export default function NotFound() {
  const { t } = useLang();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center sm:px-6">
      <p className="font-display text-8xl font-extrabold tracking-tight text-brand-600">404</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">{t("nf.title")}</h1>
      <p className="mt-2 text-slate-500">{t("nf.sub")}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 font-semibold text-white transition hover:bg-brand-700">
          <Home className="h-5 w-5" /> {t("nf.home")}
        </Link>
        <Link href="/catalog" className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 px-6 font-semibold text-slate-700 transition hover:border-brand-300">
          <LayoutGrid className="h-5 w-5" /> {t("nf.catalog")}
        </Link>
      </div>
    </div>
  );
}
