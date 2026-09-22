"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { dict, type Lang } from "./dict";
import { plural as ruPlural } from "@/lib/format";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  plural: (n: number, kind?: "products" | "reviews" | "pharmacies") => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const KEY = "inkar-lang-v1";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function persistLanguage(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.cookie = `${KEY}=${lang}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function LanguageProvider({ children, initialLang = "ru" }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    let active = true;
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved && dict[saved] && saved !== initialLang) {
        persistLanguage(saved);
        queueMicrotask(() => {
          if (active) setLangState(saved);
        });
      }
    } catch {
      /* ignore */
    }
    return () => { active = false; };
  }, [initialLang]);

  useEffect(() => {
    document.documentElement.lang = lang === "kz" ? "kk" : lang;
  }, [lang]);

  useEffect(() => {
    const syncLanguage = (event: StorageEvent) => {
      const next = event.key === KEY ? event.newValue as Lang | null : null;
      if (next && dict[next]) setLangState(next);
    };
    window.addEventListener("storage", syncLanguage);
    return () => window.removeEventListener("storage", syncLanguage);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLanguage(l);
  }, []);

  const t = useCallback((key: string, values?: Record<string, string | number>) => {
    const template = dict[lang][key] ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    ));
  }, [lang]);

  const plural = useCallback(
    (n: number, kind: "products" | "reviews" | "pharmacies" = "products") => {
      if (lang === "ru") {
        if (kind === "reviews") return ruPlural(n, "отзыв", "отзыва", "отзывов");
        if (kind === "pharmacies") return ruPlural(n, "аптека", "аптеки", "аптек");
        return ruPlural(n, "товар", "товара", "товаров");
      }
      if (lang === "kz") return kind === "reviews" ? "пікір" : kind === "pharmacies" ? "дәріхана" : "тауар";
      if (kind === "reviews") return n === 1 ? "review" : "reviews";
      if (kind === "pharmacies") return n === 1 ? "pharmacy" : "pharmacies";
      return n === 1 ? "item" : "items";
    },
    [lang],
  );

  return <LanguageContext.Provider value={{ lang, setLang, t, plural }}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within <LanguageProvider>");
  return ctx;
}
