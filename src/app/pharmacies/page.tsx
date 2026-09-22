"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigation, Clock, LocateFixed } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useLang } from "@/lib/i18n/LanguageContext";
import { allPharmacies, pharmaciesForCity, cityCenter, yandexRoute, distanceKm, nearestCity, type PharmacyPoint } from "@/lib/pharmacies";
import { cn } from "@/lib/cn";
import { loadYandexMaps } from "@/lib/yandexMaps";
import { formatStaticCopy, staticPagesCopy } from "@/lib/i18n/static-pages";
import { cityDisplayName } from "@/lib/i18n/cities";

// Яндекс Карты + геолокация пользователя: аптеки сортируются по близости,
// показывается расстояние и пин «вы здесь». Ключ — NEXT_PUBLIC_YANDEX_MAPS_KEY.
const YANDEX_MAPS_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY || "";

function fmtKm(km: number, lang: "ru" | "kz" | "en", meter: string, kilometer: string): string {
  const locale = lang === "kz" ? "kk-KZ" : lang === "en" ? "en-US" : "ru-RU";
  return km < 1
    ? `${Math.round(km * 1000).toLocaleString(locale)} ${meter}`
    : `${km.toLocaleString(locale, { maximumFractionDigits: 1 })} ${kilometer}`;
}

type GeoMessage = "" | "unavailable" | "locating" | "denied" | "failed";

function localizeHours(value: string, daily: string): string {
  // JavaScript's `\b` recognises ASCII word characters only, so it does not
  // create a boundary after the Cyrillic word "ежедневно".
  return value.replace(/^ежедневно(?=\s|$)/i, daily);
}

type PtWithKm = PharmacyPoint & { km?: number };

export default function PharmaciesPage() {
  const { lang, plural, t } = useLang();
  const copy = staticPagesCopy[lang];

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allPharmacies) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const [city, setCity] = useState("Алматы");
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<GeoMessage>("");
  const [sel, setSel] = useState(-1);

  // Аптеки города; при известной геопозиции — отсортированы по близости с полем km.
  const pts: PtWithKm[] = useMemo(() => {
    const base = pharmaciesForCity(city);
    if (!userPos) return base;
    return base
      .map((p) => ({ ...p, km: distanceKm(userPos.lat, userPos.lon, p.lat, p.lon) }))
      .sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  }, [city, userPos]);

  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObj = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterer = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarker = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  // Определить местоположение пользователя.
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoMsg("unavailable"); return; }
    setGeoMsg("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        const nc = nearestCity(lat, lon);
        if (nc) setCity(nc);
        setUserPos({ lat, lon });
        setGeoMsg("");
      },
      (e) => setGeoMsg(e.code === 1 ? "denied" : "failed"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);
  // Авто-попытка при заходе (на http тихо не сработает — тогда работает кнопка/выбор города).
  useEffect(() => {
    const timer = setTimeout(locate, 0);
    return () => clearTimeout(timer);
  }, [locate]);

  // Загрузка Яндекс Карт один раз для всех компонентов сайта.
  useEffect(() => {
    if (!YANDEX_MAPS_KEY) return;
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
  }, []);

  // Инициализация карты.
  useEffect(() => {
    if (!ready || !mapEl.current || mapObj.current || !window.ymaps) return;
    const c = cityCenter("Алматы");
    const map = new window.ymaps.Map(
      mapEl.current,
      { center: c, zoom: 11, controls: ["zoomControl", "geolocationControl"] },
      { suppressMapOpenBlock: true },
    );
    map.behaviors.disable("scrollZoom");
    mapObj.current = map;
    return () => {
      markers.current = [];
      clusterer.current = null;
      userMarker.current = null;
      map.geoObjects.removeAll();
      map.destroy();
      mapObj.current = null;
    };
  }, [ready]);

  // Метки аптек при смене города/сортировки.
  useEffect(() => {
    if (!ready || !mapObj.current || !window.ymaps) return;
    if (clusterer.current) mapObj.current.geoObjects.remove(clusterer.current);
    const nextMarkers = pts.map((p, i) => {
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
      clusterOpenBalloonOnClick: true,
    });
    nextClusterer.add(nextMarkers);
    mapObj.current.geoObjects.add(nextClusterer);
    markers.current = nextMarkers;
    clusterer.current = nextClusterer;
    if (!userPos) {
      mapObj.current.setCenter(cityCenter(city), 11, { checkZoomRange: true, duration: 250 });
    }
    setSel(-1);
  }, [city, ready, pts, userPos]);

  // Пин пользователя + центрирование на нём.
  useEffect(() => {
    if (!ready || !mapObj.current || !window.ymaps) return;
    if (userMarker.current) {
      mapObj.current.geoObjects.remove(userMarker.current);
      userMarker.current = null;
    }
    if (!userPos) return;
    userMarker.current = new window.ymaps.Placemark(
      [userPos.lat, userPos.lon],
      { hintContent: copy["pharmacies.map.youHere"] },
      { preset: "islands#blueCircleDotIcon", zIndex: 1000 },
    );
    mapObj.current.geoObjects.add(userMarker.current);
    mapObj.current.setCenter([userPos.lat, userPos.lon], 13, { checkZoomRange: true, duration: 250 });
  }, [copy, userPos, ready]);

  // Центрирование на выбранной аптеке.
  useEffect(() => {
    if (sel < 0 || !mapObj.current) return;
    const p = pts[sel];
    if (!p) return;
    markers.current.forEach((marker, index) => {
      marker.options.set("preset", index === sel ? "islands#redIcon" : "islands#greenIcon");
    });
    mapObj.current.setCenter([p.lat, p.lon], 16, { checkZoomRange: true, duration: 250 });
  }, [sel, pts]);

  const geoMessage = geoMsg ? {
    unavailable: copy["pharmacies.geo.unavailable"],
    locating: copy["pharmacies.geo.locating"],
    denied: copy["pharmacies.geo.denied"],
    failed: copy["pharmacies.geo.failed"],
  }[geoMsg] : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("top.map") }]} />
      <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("top.map")}</h1>
      <p className="mt-1 text-slate-500">
        {formatStaticCopy(copy["pharmacies.intro"], { pharmacies: allPharmacies.length, cities: cities.length })}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={locate}
          className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <LocateFixed className="h-4 w-4" /> {copy["pharmacies.nearMe"]}
        </button>
        {geoMessage && <span className="text-sm text-slate-500">{geoMessage}</span>}
        {userPos && !geoMsg && <span className="text-sm font-medium text-brand-700">{formatStaticCopy(copy["pharmacies.nearestShown"], { city: cityDisplayName(city, lang) })}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {cities.map(([c, n]) => (
          <button
            key={c}
            onClick={() => { setUserPos(null); setCity(c); }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              c === city ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
            )}
          >
            {cityDisplayName(c, lang)} <span className="text-xs opacity-60">{n}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="relative h-[380px] w-full overflow-hidden rounded-2xl border border-slate-100 bg-slate-100 lg:h-[600px]">
          <div ref={mapEl} className="h-full w-full" />
          {!YANDEX_MAPS_KEY && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-500">
              {copy["pharmacies.map.notConfigured"]}
            </div>
          )}
          {YANDEX_MAPS_KEY && !ready && !mapError && (
            <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">{copy["pharmacies.map.loading"]}</div>
          )}
          {mapError && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-500">{copy["pharmacies.map.failed"]}</div>
          )}
        </div>

        <div className="flex max-h-[600px] flex-col gap-2 overflow-y-auto pr-1">
          <p className="px-1 text-sm font-semibold text-slate-500">
            {userPos ? copy["pharmacies.nearest"] : cityDisplayName(city, lang)}: {pts.length} {plural(pts.length, "pharmacies")}
          </p>
          {pts.map((p, i) => (
            <button
              key={p.address}
              onClick={() => setSel(i)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition",
                sel === i ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{p.address}</span>
                {p.km != null && <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{fmtKm(p.km, lang, copy["pharmacies.unit.m"], copy["pharmacies.unit.km"])}</span>}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> {localizeHours(p.hours, copy["pharmacies.daily"])}</span>
              <a
                href={yandexRoute(p)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800"
              >
                <Navigation className="h-3.5 w-3.5" /> {copy["pharmacies.route"]}
              </a>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
