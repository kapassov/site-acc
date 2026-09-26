"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Navigation, Check } from "lucide-react";
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
  open, initialIndex, city, points, onClose, onPick,
}: {
  open: boolean;
  initialIndex: number;
  city: string;
  points: Array<PickupPoint & { total?: number }>;
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
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);

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
    const timer = setTimeout(() => setSel(initialIndex), 0);
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-pop">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-display text-lg font-bold text-slate-900">{copy.title} · {city}</h3>
          <button type="button" onClick={onClose} aria-label={copy.close} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {mappedPoints.length > 0 ? <div className="relative h-64 w-full shrink-0 bg-slate-100">
          <div ref={mapEl} className="h-full w-full" />
          {!YANDEX_MAPS_KEY && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-xs text-slate-500">
              <span>{copy.notConfigured}</span>
              {pts[sel] && hasPickupCoordinates(pts[sel]) && (
                <a href={yandexRoute(pts[sel])} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg border border-brand-300 bg-white px-3 py-2 font-semibold text-brand-700 hover:bg-brand-50">
                  {copy.route}
                </a>
              )}
            </div>
          )}
          {YANDEX_MAPS_KEY && !ready && !mapError && (
            <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">{copy.loading}</div>
          )}
          {mapError && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-slate-500">{copy.loadError}</div>
          )}
        </div> : <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">{copy.coordinatesUnavailable}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {pts.map((p, i) => (
            <div key={p.sourceCode || p.address}
              className={`mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${sel === i ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"}`}>
              <button type="button" onClick={() => setSel(i)} aria-pressed={sel === i} className="min-w-0 flex-1 py-1 text-left">
                <span className="block text-sm font-semibold text-slate-900">{p.address}</span>
                <span className="block text-xs text-slate-500">{p.hours}</span>
                {p.total !== undefined && <span className="block text-xs font-semibold text-brand-700">{tenge(p.total)}</span>}
              </button>
              {hasPickupCoordinates(p) && <a href={yandexRoute(p)} target="_blank" rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 py-2 text-xs font-medium text-brand-700 hover:text-brand-800"><Navigation className="h-3.5 w-3.5" />{copy.route}</a>}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 p-3">
          <button type="button" disabled={!pts[sel]} onClick={() => { if (pts[sel]) { onPick(pts[sel], sel); onClose(); } }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 font-semibold text-white transition hover:bg-brand-700">
            <Check className="h-5 w-5 shrink-0" /> <span className="truncate">{checkoutText(copy.pickHere, { address: pts[sel]?.address ?? "" })}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
