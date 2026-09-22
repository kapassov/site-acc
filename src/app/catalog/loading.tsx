"use client";

import { useLang } from "@/lib/i18n/LanguageContext";

function PulseLine({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

export default function CatalogLoading() {
  const { t } = useLang();
  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-6" aria-label={t("catalog.loadingCategories")} aria-busy="true">
      <div className="hidden sm:block"><PulseLine className="h-4 w-32" /></div>
      <div className="mt-2 sm:mt-5">
        <PulseLine className="h-9 w-40" />
        <PulseLine className="mt-2 h-4 w-56" />
      </div>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-hidden px-4 sm:mx-0 sm:px-0">
        {[92, 76, 88, 112, 96, 82, 132, 176].map((width, index) => (
          <span key={`${width}-${index}`} className="block h-10 shrink-0 animate-pulse rounded-lg bg-slate-200/70" style={{ width }} />
        ))}
      </div>

      <div className="mt-3 flex justify-end gap-2 border-y border-slate-100 py-2 xl:border-0 xl:py-0">
        <PulseLine className="h-10 w-28 xl:hidden" />
        <PulseLine className="h-10 w-44" />
      </div>

      <div className="mt-4 grid items-start gap-5 sm:mt-6 xl:grid-cols-[272px_minmax(0,1fr)] xl:gap-6">
        <aside className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white xl:block">
          <div className="flex h-14 items-center border-b border-slate-100 px-4">
            <PulseLine className="h-4 w-20" />
          </div>
          <div className="space-y-3 p-4">
            <PulseLine className="mb-4 h-3 w-24" />
            {[84, 70, 78, 92, 74, 88, 64, 80].map((width, index) => (
              <div key={`${width}-${index}`} className="flex h-9 items-center gap-3">
                <PulseLine className="h-4 w-4 shrink-0" />
                <span className="block h-3 animate-pulse rounded-lg bg-slate-200/70" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        </aside>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="rounded-2xl border border-slate-200/70 bg-white p-3 sm:p-4">
              <PulseLine className="aspect-square w-full" />
              <PulseLine className="mt-4 h-3 w-20" />
              <PulseLine className="mt-2 h-4 w-full" />
              <PulseLine className="mt-2 h-4 w-3/4" />
              <PulseLine className="mt-5 h-5 w-24" />
              <PulseLine className="mt-4 h-11 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
