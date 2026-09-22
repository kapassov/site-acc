"use client";

import { useState, useEffect, useRef } from "react";
import { MapPin, ChevronDown, Check } from "lucide-react";
import { CITIES, useCity } from "@/lib/location/CityContext";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cityDisplayName } from "@/lib/i18n/cities";

export function CitySelector({ full = false }: { full?: boolean }) {
  const { city, setCity } = useCity();
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (c: string) => {
    setCity(c);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", full && "w-full")}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1 text-sm text-slate-700 transition hover:text-slate-950",
          full && "w-full justify-between rounded-xl border border-slate-200 px-3.5 py-2.5",
        )}
      >
        <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-brand-600" /> {cityDisplayName(city, lang)}</span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-pop",
            full ? "w-full" : "w-56",
          )}
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("common.selectCity")}</p>
          {CITIES.map((c) => (
            <button
              key={c}
              role="option"
              aria-selected={c === city}
              onClick={() => pick(c)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50",
                c === city ? "font-semibold text-brand-700" : "text-slate-700",
              )}
            >
              {cityDisplayName(c, lang)} {c === city && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
