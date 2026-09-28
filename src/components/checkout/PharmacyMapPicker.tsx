"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Navigation, Check, MapPin, Search, Store } from "lucide-react";
import { cityCenter, yandexRoute } from "@/lib/pharmacies";
import { hasPickupCoordinates, type PickupPoint } from "@/lib/checkout/pickup-points";
import { loadYandexMaps } from "@/lib/yandexMaps";
import { useLang } from "@/lib/i18n/LanguageContext";
import { checkoutExtra, checkoutText } from "@/lib/i18n/checkout-extra";
import { tenge } from "@/lib/format";

// Карта выбора аптеки для самовывоза на Яндекс Картах (ключ NEXT_PUBLIC_YANDEX_MAPS_KEY).
// Список и выбор работают и без карты (fallback), чекаут не ломается. Зеркалит PharmacyMapScreen во Flutter.
const YANDEX_MAPS_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY || "";

export function PharmacyMapPicker({
  open, initialIndex, city, points, mode = "pickup", onClose, onPick,
}: {
  open: boolean;
  initialIndex: number;
  city: string;
  points: Array<PickupPoint & { total?: number }>;
  mode?: "pickup" | "courier";
  onClose: () => void;
  onPick: (p: PickupPoint, index: number) => void;
}) {
  const { lang } = useLang();
  const copy = checkoutExtra[lang].map;
  const pts = points;
  const mappedPoints = useMemo(() => points.flatMap((point, index) => hasPickupCoordinates(point) ? [{ point, index }] : []), [points]);
  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObj = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clustererRef = useRef<any>(null);
  const [sel, setSel] = useState(initialIndex);
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const filteredPoints = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru-RU");
    return points.flatMap((point, index) => !needle || `${point.address} ${point.name || ""}`.toLocaleLowerCase("ru-RU").includes(needle)
      ? [{ point, index }] : []);
  }, [points, search]);
  const selectedVisible = filteredPoints.some(({ index }) => index === sel);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [open, onClose]);

  // Загрузка Яндекс Карт с CDN один раз для всех компонентов сайта.
  useEffect(() => {
    if (!open || !YANDEX_MAPS_KEY || !mappedPoints.length) return;
    let cancelled = false;
    loadYandexMaps(YANDEX_MAPS_KEY)
      .then(() => {
        if (!cancelled) {
          setMapError(false);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => { cancelled = true; };
  }, [open, mappedPoints.length]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { setSel(initialIndex); setSearch(""); }, 0);
    return () => clearTimeout(timer);
  }, [open, initialIndex]);

  // Инициализация карты с метками.
  useEffect(() => {
    if (!open || !ready || !mappedPoints.length || !mapEl.current || mapObj.current || !window.ymaps) return;
    const map = new window.ymaps.Map(
      mapEl.current,
      { center: cityCenter(city), zoom: 11, controls: ["zoomControl"] },
      { suppressMapOpenBlock: true },
    );
    map.behaviors.disable("scrollZoom");
    const nextMarkers = mappedPoints.map(({ point: p, index: i }) => {
      const marker = new window.ymaps.Placemark(
        [p.lat, p.lon],
        { hintContent: p.address, balloonContentHeader: p.address, balloonContentBody: p.hours },
        { preset: "islands#greenIcon" },
      );
      marker.events.add("click", () => setSel(i));
      return marker;
    });
    const nextClusterer = new window.ymaps.Clusterer({
      preset: "islands#greenClusterIcons",
      groupByCoordinates: false,
      clusterDisableClickZoom: false,
    });
    nextClusterer.add(nextMarkers);
    map.geoObjects.add(nextClusterer);
    markersRef.current = nextMarkers;
    clustererRef.current = nextClusterer;
    mapObj.current = map;
    return () => {
      markersRef.current = [];
      clustererRef.current = null;
      map.geoObjects.removeAll();
      map.destroy();
      mapObj.current = null;
    };
  }, [city, open, mappedPoints, ready]);

  // Центрирование на выбранной аптеке.
  useEffect(() => {
    if (!mapObj.current) return;
    const p = pts[sel];
    markersRef.current.forEach((marker, index) => {
      marker.options.set("preset", mappedPoints[index]?.index === sel ? "islands#redIcon" : "islands#greenIcon");
    });
    if (!p || !hasPickupCoordinates(p)) return;
    mapObj.current.setCenter([p.lat, p.lon], 15, { checkZoomRange: true, duration: 250 });
  }, [pts, mappedPoints, ready, sel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-0 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="pharmacy-picker-title">
      <button type="button" onClick={onClose} aria-label={copy.close} className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm" />
      <div className="relative flex h-full max-h-[860px] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(90vh,860px)] sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 id="pharmacy-picker-title" className="font-display text-xl font-extrabold text-slate-900 sm:text-2xl">{mode === "courier" ? copy.courierTitle : copy.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{city} · {checkoutText(copy.available, { count: pts.length })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={copy.close} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="order-2 flex min-h-0 flex-1 flex-col md:order-1 md:w-1/2">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" autoComplete="off" placeholder={copy.search} aria-label={copy.search} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500" />
              </label>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
              {filteredPoints.map(({ point, index }) => {
                const selected = sel === index;
                return <div key={point.sourceCode || `${point.address}-${index}`} className={`flex items-stretch gap-2 rounded-2xl border p-2 transition ${selected ? "border-brand-500 bg-brand-50 shadow-sm" : "border-slate-200 bg-white hover:border-brand-200"}`}>
                  <button type="button" onClick={() => setSel(index)} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${selected ? "bg-brand-600 text-white" : "bg-slate-100 text-brand-700"}`}><Store className="h-5 w-5" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5 text-slate-900">{point.address}</span>
                      <span className="mt-1 block text-xs text-slate-500">{point.hours}</span>
                      {point.total !== undefined && <span className="mt-1 block text-sm font-bold tabular-nums text-brand-800">{tenge(point.total)}</span>}
                    </span>
                    {selected && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white"><Check className="h-4 w-4" aria-hidden /></span>}
                  </button>
                  {hasPickupCoordinates(point) && <a href={yandexRoute(point)} target="_blank" rel="noopener noreferrer" aria-label={`${copy.route}: ${point.address}`} className="grid w-10 shrink-0 place-items-center rounded-xl text-brand-700 transition hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><Navigation className="h-4 w-4" aria-hidden /></a>}
                </div>;
              })}
              {filteredPoints.length === 0 && <p role="status" className="rounded-2xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-600">{copy.noMatches}</p>}
            </div>
          </div>
          <div className="order-1 relative h-48 shrink-0 bg-slate-100 md:order-2 md:h-auto md:w-1/2">
            {mappedPoints.length > 0 && <div ref={mapEl} className="h-full w-full" />}
            {(!YANDEX_MAPS_KEY || mappedPoints.length === 0 || mapError) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-brand-50 to-slate-100 px-6 text-center text-sm text-slate-600">
                <MapPin className="h-8 w-8 text-brand-600" aria-hidden />
                {mappedPoints.length === 0 && <span>{copy.coordinatesUnavailable}</span>}
                {mappedPoints.length > 0 && mapError && <span>{copy.loadError}</span>}
                {mappedPoints.length > 0 && !mapError && !YANDEX_MAPS_KEY && <span>{copy.notConfigured}</span>}
                {selectedVisible && pts[sel] && hasPickupCoordinates(pts[sel]) && <a href={yandexRoute(pts[sel])} target="_blank" rel="noopener noreferrer" className="mt-1 rounded-xl bg-white px-4 py-2 font-semibold text-brand-700 shadow-sm hover:bg-brand-50">{copy.route}</a>}
              </div>
            )}
            {YANDEX_MAPS_KEY && mappedPoints.length > 0 && !ready && !mapError && <div className="absolute inset-0 grid place-items-center bg-slate-100 text-sm text-slate-600">{copy.loading}</div>}
          </div>
        </div>
        <div className="border-t border-slate-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <button type="button" disabled={!pts[sel] || !selectedVisible} onClick={() => { if (pts[sel] && selectedVisible) { onPick(pts[sel], sel); onClose(); } }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            <Check className="h-5 w-5 shrink-0" aria-hidden /> <span className="truncate">{mode === "courier" ? copy.confirmCourier : checkoutText(copy.pickHere, { address: pts[sel]?.address ?? "" })}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
