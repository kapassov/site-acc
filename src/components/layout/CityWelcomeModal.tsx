"use client";

import { MapPin } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCity, CITIES } from "@/lib/location/CityContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cityDisplayName } from "@/lib/i18n/cities";

const copy = {
  ru: { title: "Выберите город", hint: "Покажем актуальное наличие в аптеках вашего города. Город можно поменять в шапке сайта." },
  kz: { title: "Қаланы таңдаңыз", hint: "Қалаңыздағы дәріханалардың өзекті қалдығын көрсетеміз. Қаланы сайттың жоғарғы бөлігінде өзгертуге болады." },
  en: { title: "Choose your city", hint: "We will show current stock in pharmacies in your city. You can change the city in the site header." },
} as const;

export function CityWelcomeModal() {
  const pathname = usePathname();
  const { ready, needsSelection, setCity } = useCity();
  const { lang } = useLang();
  if (!ready || !needsSelection || pathname.startsWith("/payment") || pathname.startsWith("/admin")) return null;
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="city-welcome-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-pop sm:p-7">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><MapPin className="h-6 w-6" /></span>
        <h2 id="city-welcome-title" className="font-display text-2xl font-bold text-slate-900">{copy[lang].title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{copy[lang].hint}</p>
        <div className="mt-5 grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto" role="listbox" aria-label={copy[lang].title}>
          {CITIES.map((city) => (
            <button key={city} type="button" role="option" aria-selected="false" onClick={() => setCity(city)}
              className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {cityDisplayName(city, lang)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
