"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { CITIES } from "./cities";
export { CITIES } from "./cities";
export type { City } from "./cities";

const KEY = "ass_city";
type Ctx = { city: string; setCity: (c: string) => void; ready: boolean; needsSelection: boolean };
const CityCtx = createContext<Ctx | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCityState] = useState("Алматы");
  const [ready, setReady] = useState(false);
  const [needsSelection, setNeedsSelection] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- гидратация из localStorage после маунта (SSR == первый клиентский рендер)
      if (s && CITIES.includes(s as (typeof CITIES)[number])) setCityState(s);
      else setNeedsSelection(true);
    } catch {
      setNeedsSelection(true);
    }
    setReady(true);
  }, []);

  const setCity = (c: string) => {
    if (!CITIES.includes(c as (typeof CITIES)[number])) return;
    setCityState(c);
    setNeedsSelection(false);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* ignore */
    }
  };

  return <CityCtx.Provider value={{ city, setCity, ready, needsSelection }}>{children}</CityCtx.Provider>;
}

export function useCity() {
  const c = useContext(CityCtx);
  if (!c) throw new Error("useCity must be used within <CityProvider>");
  return c;
}
