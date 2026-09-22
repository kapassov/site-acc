"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, TrendingUp } from "lucide-react";
import { useCatalogData } from "@/lib/content/CatalogData";
import { useLang } from "@/lib/i18n/LanguageContext";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics/client";
import type { Product } from "@/lib/types";
import { useCity } from "@/lib/location/CityContext";
import { SearchFeedback } from "@/components/search/SearchFeedback";
import { readSearchFeedback, searchResultsHref, type SearchFeedbackMeta } from "@/components/search/search-feedback";

type SearchResponseState = {
  requestKey: string;
  products: Product[];
  metadata: SearchFeedbackMeta | null;
  failed: boolean;
};

/** Умный поиск с выпадашкой: «Часто ищут» (реальные бренды) + автодополнение по живому каталогу. */
export function SearchBar({
  className,
  onNavigate,
  placeholder,
}: {
  className?: string;
  onNavigate?: () => void;
  placeholder?: string;
}) {
  const router = useRouter();
  const { brands } = useCatalogData();
  const { city, ready: cityReady } = useCity();
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [serverState, setServerState] = useState<SearchResponseState | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const term = q.trim();
  const requestKey = JSON.stringify({ query: term, city, retryAttempt });
  const currentResponse = serverState?.requestKey === requestKey ? serverState : null;
  const popular = brands.slice(0, 6).map((b) => b.name);
  const matches = currentResponse?.products ?? [];
  const searching = term.length >= 2 && !currentResponse;
  const optionCount = term ? matches.length : popular.length;
  const selectedIndex = selection?.key === requestKey && selection.index < optionCount ? selection.index : -1;

  useEffect(() => {
    if (!open || selectedIndex < 0) return;
    document.getElementById(`${listboxId}-${selectedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [listboxId, open, selectedIndex]);

  useEffect(() => {
    if (term.length < 2 || !cityReady) return;
    const controller = new AbortController();
    let requestTimeout: number | undefined;
    const timer = window.setTimeout(() => {
      requestTimeout = window.setTimeout(() => {
        controller.abort();
        setServerState({ requestKey, products: [], metadata: null, failed: true });
      }, 15_000);
      const params = new URLSearchParams({ q: term, city, limit: "6" });
      fetch(`/api/search?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("search_failed")))
        .then((payload) => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(payload?.products)) throw new Error("search_invalid");
          setServerState({
            requestKey,
            products: payload.products.filter((product: Partial<Product> | null) => product && typeof product.id === "string" && typeof product.slug === "string" && typeof product.name === "string"),
            metadata: readSearchFeedback(payload.meta?.search, term),
            failed: false,
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setServerState({ requestKey, products: [], metadata: null, failed: true });
        })
        .finally(() => window.clearTimeout(requestTimeout));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [city, cityReady, requestKey, term]);

  const close = () => {
    setOpen(false);
    setSelection(null);
    onNavigate?.();
  };

  const go = (text: string) => {
    const v = text.trim();
    if (!v) return;
    // Поисковый текст может раскрывать данные о здоровье, поэтому в CDP
    // передаём только техническую длину запроса, без самого содержимого.
    trackEvent("search_performed", { queryLength: v.length, location: "header" });
    close();
    router.push(searchResultsHref(v, { city }));
  };

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <div className={cn("flex items-center rounded-full border-2 bg-white pl-4 transition sm:pl-5", open ? "border-brand-500 shadow-pop" : "border-brand-200")}>
          <input
            type="search"
            name="q"
            role="combobox"
            aria-label={t("search.btn")}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open && optionCount > 0 ? listboxId : undefined}
            aria-activedescendant={open && selectedIndex >= 0 ? `${listboxId}-${selectedIndex}` : undefined}
            autoComplete="off"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelection(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setSelection(null);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                if (!optionCount) return;
                const index = event.key === "ArrowDown"
                  ? (selectedIndex + 1) % optionCount
                  : selectedIndex <= 0 ? optionCount - 1 : selectedIndex - 1;
                setSelection({ key: requestKey, index });
              } else if (event.key === "Enter" && open && selectedIndex >= 0) {
                event.preventDefault();
                if (term) {
                  close();
                  router.push(`/product/${matches[selectedIndex].slug}`);
                } else {
                  go(popular[selectedIndex]);
                }
              }
            }}
            placeholder={placeholder ?? t("search.ph")}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button type="submit" aria-label={t("search.btn")} className="m-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 sm:w-12">
            <Search className="h-5 w-5" />
          </button>
        </div>
      </form>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-[min(65dvh,32rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 bg-white p-2 shadow-pop">
          {term ? (
            matches.length > 0 ? (
              <>
                <SearchFeedback metadata={currentResponse?.metadata ?? null} originalHref={searchResultsHref(term, { city, exact: true })} compact onNavigate={close} />
                <ul id={listboxId} role="listbox" aria-label={t("search.suggestions")}>
                {matches.map((p, index) => (
                  <li key={p.id} role="none">
                    <Link
                      id={`${listboxId}-${index}`}
                      role="option"
                      aria-selected={selectedIndex === index}
                      tabIndex={-1}
                      href={`/product/${p.slug}`}
                      prefetch={false}
                      onClick={close}
                      onMouseDown={(event) => event.preventDefault()}
                      className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-50", selectedIndex === index && "bg-brand-50")}
                    >
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-800">{p.name}</span>
                        <span className="text-xs text-slate-400">{p.brand}</span>
                      </span>
                      {!p.priceTBD && <span className="shrink-0 text-sm font-semibold text-slate-900">{tenge(p.price)}</span>}
                    </Link>
                  </li>
                ))}
                </ul>
                <button type="button" onClick={() => go(q)} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-brand-700 transition hover:bg-brand-50">
                  <Search className="h-4 w-4 shrink-0" /> <span>{t("search.allResults")} «{term}»</span>
                </button>
              </>
            ) : searching ? (
              <div className="space-y-2 px-3 py-3" aria-live="polite" aria-busy="true">
                <p className="text-sm font-medium text-slate-500">{t("search.loading")}</p>
                <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
              </div>
            ) : currentResponse?.failed ? (
              <div className="px-3 py-3 text-sm" role="alert">
                <p className="text-slate-600">{t("search.error")}</p>
                <button type="button" onClick={() => setRetryAttempt((attempt) => attempt + 1)} className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand-700">{t("search.retry")}</button>
              </div>
            ) : term.length < 2 ? (
              <p className="px-3 py-4 text-sm text-slate-500" role="status">{t("search.minLength")}</p>
            ) : (
              <>
                <SearchFeedback metadata={currentResponse?.metadata ?? null} originalHref={searchResultsHref(term, { city, exact: true })} compact onNavigate={close} />
                <p className="px-3 py-4 text-sm text-slate-500" role="status">{t("search.noHint")}</p>
                <button type="button" onClick={() => go(q)} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium text-brand-700 hover:bg-brand-50">{t("search.allResults")} «{term}»</button>
              </>
            )
          ) : popular.length > 0 ? (
            <>
              <p className="px-3 py-2 text-sm font-bold text-slate-900">{t("search.popular")}</p>
              <ul id={listboxId} role="listbox" aria-label={t("search.popular")}>
                {popular.map((name, index) => (
                  <li key={name} role="none">
                    <button id={`${listboxId}-${index}`} type="button" role="option" aria-selected={selectedIndex === index} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => go(name)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50", selectedIndex === index && "bg-brand-50")}>
                      <TrendingUp className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="text-sm text-slate-700">{name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="px-3 py-4 text-sm text-slate-400">{t("search.hint")}</p>
          )}
        </div>
      )}
    </div>
  );
}
