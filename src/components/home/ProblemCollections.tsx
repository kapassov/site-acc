"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useContent } from "@/lib/content/ContentContext";
import { cmsTr } from "@/lib/content/cmsI18n";
import { CollectionIcon } from "@/components/ui/CollectionIcon";

export function ProblemCollections() {
  const { t, lang } = useLang();
  const { content } = useContent();
  const items = content.collections.slice(0, 6);
  if (!items.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-4 max-w-2xl sm:mb-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("prob.title")}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500 sm:text-base">{t("prob.subtitle")}</p>
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto no-scrollbar pb-1 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible lg:grid-cols-3">
        {items.map((it) => (
          <Link
            key={it.id}
            href={it.href}
            className={`group relative flex h-[132px] min-w-[78%] flex-shrink-0 snap-start overflow-hidden rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card sm:min-w-0 sm:p-5 ${it.img ? "border-brand-100/80 bg-white text-slate-900 shadow-sm" : "border-transparent text-white shadow-soft"}`}
            style={!it.img ? { background: `linear-gradient(150deg, ${it.from}, ${it.to})` } : undefined}
          >
            {it.img && (
              <>
                <Image src={it.img} alt="" fill sizes="(min-width: 1024px) 300px, (min-width: 640px) 50vw, 78vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{ background: "linear-gradient(90deg, rgba(255,255,255,.99) 0%, rgba(255,255,255,.96) 38%, rgba(255,255,255,.54) 67%, rgba(255,255,255,.08) 100%)" }}
                />
              </>
            )}
            <span className="relative z-10 flex max-w-[68%] flex-col items-start">
              <span className={`grid h-8 w-8 place-items-center rounded-full ${it.img ? "bg-brand-50 text-brand-700" : "bg-white/15 text-white"}`}>
                <CollectionIcon name={it.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="mt-2 font-display text-base font-bold leading-tight sm:text-[17px]">{cmsTr(lang, it.id, "title", it.title)}</span>
              <span className={`mt-auto inline-flex items-center gap-1 pt-2 text-xs font-semibold ${it.img ? "text-brand-700" : "text-white/90"}`}>
                {t("prob.cta")} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
