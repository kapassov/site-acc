"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/LanguageContext";

export function SectionHeader({
  title,
  subtitle,
  href = "/catalog",
}: {
  title: string;
  subtitle?: string;
  href?: string;
}) {
  const { t } = useLang();
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-1.5 text-slate-500">{subtitle}</p>}
      </div>
      <Link href={href} className="shrink-0 text-sm font-semibold text-brand-700 transition hover:text-brand-800">
        {t("common.viewAll")}
      </Link>
    </div>
  );
}
