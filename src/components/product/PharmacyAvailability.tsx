"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MapPin, RefreshCw, Store } from "lucide-react";
import { CitySelector } from "@/components/layout/CitySelector";
import { tenge } from "@/lib/format";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useCity } from "@/lib/location/CityContext";
import { isPharmacyStock, type PharmacyStock } from "@/lib/pharmacy-stock";

type AvailabilityPayload = {
  city: string;
  total: number;
  pharmacies: PharmacyStock[];
  partial?: boolean;
  stale?: boolean;
};

const copy = {
  ru: {
    title: "Наличие в аптеках",
    loading: "Проверяем актуальные остатки…",
    empty: "В выбранном городе товар сейчас не найден в наличии.",
    error: "Не удалось загрузить остатки. Попробуйте ещё раз.",
    retry: "Повторить",
    left: "Осталось",
    units: "шт.",
    show: "Показать ещё",
    hide: "Свернуть",
    note: "Цена и остаток подтверждаются при оформлении заказа.",
    stale: "Показаны последние доступные данные.",
    partial: "Часть аптек временно не ответила.",
    pricePending: "Цена уточняется",
  },
  kz: {
    title: "Дәріханалардағы қолжетімділік",
    loading: "Өзекті қалдықтарды тексеріп жатырмыз…",
    empty: "Таңдалған қалада тауар қазір жоқ.",
    error: "Қалдықтарды жүктеу мүмкін болмады. Қайталап көріңіз.",
    retry: "Қайталау",
    left: "Қалды",
    units: "дана",
    show: "Тағы көрсету",
    hide: "Жасыру",
    note: "Баға мен қалдық тапсырыс рәсімделгенде расталады.",
    stale: "Соңғы қолжетімді деректер көрсетілді.",
    partial: "Кейбір дәріханалар уақытша жауап бермеді.",
    pricePending: "Бағасы нақтылануда",
  },
  en: {
    title: "Availability in pharmacies",
    loading: "Checking current stock…",
    empty: "This item is not currently available in the selected city.",
    error: "Stock could not be loaded. Please try again.",
    retry: "Try again",
    left: "Only",
    units: "left",
    show: "Show more",
    hide: "Show less",
    note: "Price and stock are confirmed during checkout.",
    stale: "Showing the latest available data.",
    partial: "Some pharmacies did not respond temporarily.",
    pricePending: "Price pending",
  },
} as const;

const INITIAL_ROWS = 6;

export function PharmacyAvailability({ productId, onAvailabilityChange }: { productId: string; onAvailabilityChange?: (available: boolean | null) => void }) {
  const { city, ready: cityReady } = useCity();
  const { lang, plural } = useLang();
  const text = copy[lang];
  const [requestVersion, setRequestVersion] = useState(0);
  const requestKey = cityReady ? `${productId}\u0000${city}\u0000${requestVersion}` : "city-pending";
  const expansionKey = `${productId}\u0000${city}`;
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [result, setResult] = useState<{
    key: string;
    data: AvailabilityPayload | null;
    error: boolean;
  } | null>(null);
  const loading = result?.key !== requestKey;
  const error = result?.key === requestKey && result.error;
  const data = result?.key === requestKey ? result.data : null;
  const expanded = expandedFor === expansionKey;

  useEffect(() => {
    if (!onAvailabilityChange) return;
    if (loading || error) onAvailabilityChange(null);
    else if (data) onAvailabilityChange(data.pharmacies.length > 0);
  }, [data, error, loading, onAvailabilityChange]);

  useEffect(() => {
    if (!cityReady) return;
    const controller = new AbortController();
    fetch(`/api/availability/${encodeURIComponent(productId)}?city=${encodeURIComponent(city)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("availability_failed");
        const payload = await response.json() as Partial<AvailabilityPayload>;
        const pharmacies = Array.isArray(payload.pharmacies) ? payload.pharmacies.filter(isPharmacyStock) : [];
        setResult({
          key: requestKey,
          error: false,
          data: {
            city: typeof payload.city === "string" ? payload.city : city,
            total: Number.isSafeInteger(payload.total) && Number(payload.total) >= pharmacies.length
              ? Number(payload.total)
              : pharmacies.length,
            pharmacies,
            partial: payload.partial === true,
            stale: payload.stale === true,
          },
        });
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setResult({ key: requestKey, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [city, cityReady, productId, requestKey]);

  const rows = data?.pharmacies ?? [];
  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const hiddenCount = Math.max(0, rows.length - INITIAL_ROWS);

  return (
    <section className="mt-6 overflow-visible rounded-2xl border border-slate-100 bg-white p-4 shadow-soft sm:p-5" aria-labelledby="pharmacy-availability-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="pharmacy-availability-title" className="font-display text-base font-bold text-slate-900">{text.title}</h2>
          {!loading && !error && data && data.total > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">{data.total} {plural(data.total, "pharmacies")}</p>
          )}
        </div>
        <div className="w-full sm:w-52"><CitySelector full /></div>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <div className="mt-4 space-y-2" role="status">
            <p className="sr-only">{text.loading}</p>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex animate-pulse items-center gap-3 rounded-xl bg-slate-50 p-3">
                <span className="h-9 w-9 rounded-lg bg-slate-200" />
                <span className="h-9 flex-1 rounded-lg bg-slate-200" />
                <span className="h-9 w-16 rounded-lg bg-slate-200" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">{text.error}</p>
            <button type="button" onClick={() => setRequestVersion((value) => value + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700">
              <RefreshCw className="h-4 w-4" /> {text.retry}
            </button>
          </div>
        )}

        {!loading && !error && data && rows.length === 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-4">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
            <p className="text-sm leading-relaxed text-slate-600">{text.empty}</p>
          </div>
        )}

        {!loading && !error && visibleRows.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {visibleRows.map((pharmacy) => {
              const lowStock = pharmacy.quantity <= 3;
              return (
                <li key={pharmacy.sourceCode} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700"><Store className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{pharmacy.name}</p>
                    <p className="mt-0.5 text-xs leading-snug text-slate-500">{pharmacy.address || pharmacy.city}</p>
                  </div>
                  <span className={`col-start-2 w-fit rounded-full px-2.5 py-1 text-xs font-semibold sm:col-start-auto ${lowStock ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {lowStock ? `${text.left} ${pharmacy.quantity}` : `${pharmacy.quantity} ${text.units}`}
                  </span>
                  <span className="col-start-2 font-display text-sm font-bold text-slate-900 sm:col-start-auto sm:text-right">
                    {pharmacy.price == null ? text.pricePending : tenge(pharmacy.price)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && !error && hiddenCount > 0 && (
        <button type="button" onClick={() => setExpandedFor((value) => value === expansionKey ? null : expansionKey)} aria-expanded={expanded} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? text.hide : `${text.show} · ${hiddenCount}`}
        </button>
      )}

      {!loading && !error && data && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{data.stale ? `${text.stale} ` : ""}{data.partial ? `${text.partial} ` : ""}{text.note}</p>
      )}
    </section>
  );
}
