"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { medusaDirectory } from "@/lib/medusa-directory";
import type { CatNode } from "@/lib/types";
import { useLang } from "@/lib/i18n/LanguageContext";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { catalogCategoryName } from "@/lib/i18n/catalog-categories";

function categoryHref(handle: string) {
  return `/catalog/${handle}`;
}

export function CatalogDirectory({ tree }: { tree: CatNode[] }) {
  const { t, lang } = useLang();
  const groups = medusaDirectory(tree);
  if (!groups.length) return null;

  return (
    <section
      className="border-y border-slate-200/80 bg-white/75 py-8 backdrop-blur-[2px] sm:py-10"
      aria-labelledby="catalog-directory-title"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 id="catalog-directory-title" className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              {t("home.directory.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              {t("home.directory.sub")}
            </p>
          </div>
          <Link
            href="/catalog"
            className="hidden min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-brand-700 transition hover:text-brand-900 sm:inline-flex"
          >
            {t("home.directory.all")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <nav className="mt-7 sm:mt-8" aria-label={t("home.directory.aria")}>
          <div className="divide-y divide-slate-200 border-y border-slate-200 md:hidden">
            {groups.map((group) => (
              <details key={group.id} className="group/details">
                <summary className="flex min-h-16 list-none items-center gap-3 py-3 text-left marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <CategoryIcon name={group.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-base font-bold leading-tight text-slate-900">{catalogCategoryName(group.handle, group.name, lang)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {group.children.length} {t("home.directory.sections")}
                    </span>
                  </span>
                  <ChevronDown
                    className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 group-open/details:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="pb-4 pl-[52px]">
                  <Link
                    href={categoryHref(group.handle)}
                    className="flex min-h-11 items-center gap-2 border-b border-slate-100 pr-2 text-sm font-semibold text-brand-700"
                  >
                    {t("home.directory.groupAll")}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <ul className="pt-1">
                    {group.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={categoryHref(child.handle)}
                          className="flex min-h-11 items-center pr-2 text-sm leading-5 text-slate-700 transition active:text-brand-700"
                        >
                          {catalogCategoryName(child.handle, child.name, lang)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>

          <div className="hidden gap-x-7 gap-y-9 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groups.map((group) => (
              <section key={group.id} className="border-t border-slate-200 pt-5" aria-labelledby={`${group.id}-title`}>
                <h3 id={`${group.id}-title`}>
                  <Link
                    href={categoryHref(group.handle)}
                    className="group/link flex min-h-11 items-center gap-3 font-display text-base font-bold text-slate-950 transition hover:text-brand-700"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover/link:bg-brand-100">
                      <CategoryIcon name={group.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">{catalogCategoryName(group.handle, group.name, lang)}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition group-hover/link:translate-x-0 group-hover/link:opacity-100" aria-hidden="true" />
                  </Link>
                </h3>
                <ul className="mt-3 space-y-0.5 pl-[52px]">
                  {group.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={categoryHref(child.handle)}
                        className="inline-flex min-h-8 items-center py-1 text-sm leading-5 text-slate-600 transition hover:text-brand-700"
                      >
                        {catalogCategoryName(child.handle, child.name, lang)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </nav>

        <Link
          href="/catalog"
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 border border-brand-600 bg-brand-600 px-5 text-sm font-semibold text-white transition active:bg-brand-700 sm:hidden"
        >
          {t("home.directory.all")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
