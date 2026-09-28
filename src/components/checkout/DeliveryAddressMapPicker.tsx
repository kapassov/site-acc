"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MapPin, Search, X } from "lucide-react";
import { cityCenter } from "@/lib/pharmacies";
import { loadYandexMaps, type YandexMapsApi } from "@/lib/yandexMaps";
import { useLang } from "@/lib/i18n/LanguageContext";

const KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY || "";
const copy = {
  ru: { title: "Укажите адрес доставки", hint: "Найдите дом по адресу или нажмите на нужную точку карты. Затем проверьте номер дома.", search: "Найти на карте", placeholder: "Улица и номер дома", apply: "Использовать этот адрес", close: "Закрыть", loading: "Загружаем карту…", unavailable: "Карта сейчас недоступна. Укажите адрес и номер дома вручную.", noResult: "Адрес не найден. Уточните улицу и номер дома.", wrongCity: "Точка не относится к выбранному городу. Укажите адрес в городе доставки.", needHouse: "Укажите улицу и точный номер дома.", searching: "Ищем адрес…" },
  kz: { title: "Жеткізу мекенжайын көрсетіңіз", hint: "Үйді мекенжай бойынша табыңыз немесе картадан нүкте таңдаңыз. Үй нөмірін тексеріңіз.", search: "Картадан табу", placeholder: "Көше және үй нөмірі", apply: "Осы мекенжайды қолдану", close: "Жабу", loading: "Карта жүктелуде…", unavailable: "Карта қазір қолжетімсіз. Мекенжай мен үй нөмірін қолмен жазыңыз.", noResult: "Мекенжай табылмады. Көше мен үй нөмірін нақтылаңыз.", wrongCity: "Нүкте таңдалған қалада емес. Жеткізу қаласындағы мекенжайды көрсетіңіз.", needHouse: "Көше мен нақты үй нөмірін көрсетіңіз.", searching: "Мекенжай ізделуде…" },
  en: { title: "Choose delivery address", hint: "Search for the building or tap a point on the map. Check the house number before continuing.", search: "Find on map", placeholder: "Street and house number", apply: "Use this address", close: "Close", loading: "Loading map…", unavailable: "The map is unavailable. Enter the street and house number manually.", noResult: "Address not found. Check the street and house number.", wrongCity: "The point is outside the selected city. Choose an address in the delivery city.", needHouse: "Enter the street and exact house number.", searching: "Searching…" },
} as const;

export function DeliveryAddressMapPicker({ city, address, onClose, onPick }: {
  city: string; address: string; onClose: () => void; onPick: (address: string) => void;
}) {
  const { lang } = useLang();
  const c = copy[lang];
  const [query, setQuery] = useState(address);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [unresolvedHouse, setUnresolvedHouse] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(!KEY);
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<YandexMapsApi>(null);
  const marker = useRef<YandexMapsApi>(null);
  const geocodeSequence = useRef(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", escape); };
  }, [onClose]);

  useEffect(() => {
    if (!KEY) return;
    let alive = true;
    loadYandexMaps(KEY).then(() => { if (alive) setReady(true); }).catch(() => { if (alive) setMapUnavailable(true); });
    return () => { alive = false; };
  }, []);

  const selectCoordinates = useCallback(async (ymaps: YandexMapsApi, instance: YandexMapsApi, coordinates: [number, number]) => {
    const sequence = ++geocodeSequence.current;
    setSearching(true); setError("");
    try {
      const result = await ymaps.geocode(coordinates, { results: 1 });
      if (sequence !== geocodeSequence.current) return;
      const item = result.geoObjects.get(0);
      const line = String(item?.getAddressLine?.() || "").trim();
      if (!line) { setError(c.noResult); return; }
      if (!line.toLocaleLowerCase("ru-RU").includes(city.toLocaleLowerCase("ru-RU"))) {
        setError(c.wrongCity); return;
      }
      if (marker.current) instance.geoObjects.remove(marker.current);
      const placemark = new ymaps.Placemark(coordinates, {}, { preset: "islands#greenDotIcon" });
      instance.geoObjects.add(placemark);
      marker.current = placemark;
      instance.setCenter(coordinates, 17, { checkZoomRange: true });
      setQuery(line);
      const hasHouse = Boolean(item?.getPremiseNumber?.());
      setUnresolvedHouse(!hasHouse);
      if (!hasHouse) setError(c.needHouse);
    } catch { if (sequence === geocodeSequence.current) setError(c.noResult); }
    finally { if (sequence === geocodeSequence.current) setSearching(false); }
  }, [c, city]);

  useEffect(() => {
    if (!ready || !mapElement.current || map.current || !window.ymaps) return;
    const ymaps = window.ymaps;
    const instance = new ymaps.Map(mapElement.current, { center: cityCenter(city), zoom: 13, controls: ["zoomControl"] }, { suppressMapOpenBlock: true });
    instance.behaviors.disable("scrollZoom");
    instance.events.add("click", (event: YandexMapsApi) => {
      const coordinates = event.get("coords") as [number, number];
      void selectCoordinates(ymaps, instance, coordinates);
    });
    map.current = instance;
    return () => { geocodeSequence.current += 1; marker.current = null; instance.destroy(); map.current = null; };
  }, [ready, city, selectCoordinates]);

  async function searchAddress() {
    const exact = query.trim();
    if (!exact || !/\d/.test(exact)) { setError(c.needHouse); return; }
    if (!window.ymaps || !map.current) { setError(c.unavailable); return; }
    const sequence = ++geocodeSequence.current;
    setSearching(true); setError("");
    try {
      const result = await window.ymaps.geocode(`${city}, ${exact}`, { results: 1 });
      if (sequence !== geocodeSequence.current) return;
      const item = result.geoObjects.get(0);
      const coords = item?.geometry?.getCoordinates?.() as [number, number] | undefined;
      const line = String(item?.getAddressLine?.() || "").trim();
      if (!coords || !line || !item?.getPremiseNumber?.()) { setError(c.noResult); return; }
      if (!line.toLocaleLowerCase("ru-RU").includes(city.toLocaleLowerCase("ru-RU"))) { setError(c.wrongCity); return; }
      if (marker.current) map.current.geoObjects.remove(marker.current);
      marker.current = new window.ymaps.Placemark(coords, {}, { preset: "islands#greenDotIcon" });
      map.current.geoObjects.add(marker.current);
      map.current.setCenter(coords, 17, { checkZoomRange: true });
      setQuery(line);
      setUnresolvedHouse(false);
    } catch { if (sequence === geocodeSequence.current) setError(c.noResult); }
    finally { if (sequence === geocodeSequence.current) setSearching(false); }
  }

  const confirm = () => {
    const exact = query.trim();
    if (!exact || !/\d/.test(exact) || unresolvedHouse) { setError(c.needHouse); return; }
    if (mapUnavailable && !exact.toLocaleLowerCase("ru-RU").includes(city.toLocaleLowerCase("ru-RU"))) {
      onPick(`${city}, ${exact}`);
    } else {
      onPick(exact);
    }
    onClose();
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="delivery-address-map-title">
    <button type="button" className="absolute inset-0 bg-slate-950/60" onClick={onClose} aria-label={c.close} />
    <div className="relative flex h-full max-h-[800px] w-full max-w-3xl flex-col bg-white shadow-2xl sm:h-[min(90vh,800px)] sm:rounded-3xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5"><div><h2 id="delivery-address-map-title" className="font-display text-xl font-bold text-slate-900">{c.title}</h2><p className="mt-1 text-sm text-slate-500">{c.hint}</p></div><button type="button" onClick={onClose} aria-label={c.close} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200"><X className="h-5 w-5" /></button></div>
    <div className="flex gap-2 p-4 sm:p-5"><div className="relative min-w-0 flex-1"><MapPin className="absolute left-3 top-3 h-5 w-5 text-brand-600" /><input value={query} onChange={(event) => { setQuery(event.target.value); setUnresolvedHouse(false); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchAddress(); } }} aria-label={c.placeholder} placeholder={c.placeholder} autoComplete="street-address" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-brand-500" /></div><button type="button" onClick={() => void searchAddress()} disabled={searching || mapUnavailable} className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand-200 px-3 text-sm font-semibold text-brand-700 disabled:opacity-50"><Search className="h-4 w-4" /><span className="hidden sm:inline">{c.search}</span></button></div>
      <div className="relative min-h-52 flex-1 bg-slate-100"><div ref={mapElement} className="h-full w-full" />{(!ready || mapUnavailable) && <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-600">{mapUnavailable ? c.unavailable : c.loading}</div>}</div>
      <div className="border-t border-slate-100 p-4 sm:p-5">{(error || searching) && <p role="status" className="mb-3 text-sm text-amber-800">{searching ? c.searching : error}</p>}<button type="button" onClick={confirm} disabled={searching} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50"><Check className="h-5 w-5" />{c.apply}</button></div>
    </div>
  </div>;
}
