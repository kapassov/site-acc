import type { Lang } from "./dict.ts";
import type { City } from "../location/cities.ts";

type CityLabels = Record<Lang, string>;

/** Additional cities currently present in the static pharmacy directory. */
type DirectoryCity =
  | City
  | "Жезказган"
  | "Иссык"
  | "Кокшетау"
  | "Петропавловск"
  | "Талдыкорган"
  | "Туркестан"
  | "Экибастуз";

/**
 * Display labels indexed by the canonical city value used by APIs and storage.
 * `satisfies` makes a missing language or supported city a type error.
 */
export const CITY_LABELS = {
  Алматы: { ru: "Алматы", kz: "Алматы", en: "Almaty" },
  Астана: { ru: "Астана", kz: "Астана", en: "Astana" },
  Шымкент: { ru: "Шымкент", kz: "Шымкент", en: "Shymkent" },
  Караганда: { ru: "Караганда", kz: "Қарағанды", en: "Karaganda" },
  Актобе: { ru: "Актобе", kz: "Ақтөбе", en: "Aktobe" },
  Тараз: { ru: "Тараз", kz: "Тараз", en: "Taraz" },
  Павлодар: { ru: "Павлодар", kz: "Павлодар", en: "Pavlodar" },
  "Усть-Каменогорск": { ru: "Усть-Каменогорск", kz: "Өскемен", en: "Oskemen" },
  Семей: { ru: "Семей", kz: "Семей", en: "Semey" },
  Атырау: { ru: "Атырау", kz: "Атырау", en: "Atyrau" },
  Костанай: { ru: "Костанай", kz: "Қостанай", en: "Kostanay" },
  Кызылорда: { ru: "Кызылорда", kz: "Қызылорда", en: "Kyzylorda" },
  Уральск: { ru: "Уральск", kz: "Орал", en: "Oral" },
  Актау: { ru: "Актау", kz: "Ақтау", en: "Aktau" },
  Жезказган: { ru: "Жезказган", kz: "Жезқазған", en: "Zhezkazgan" },
  Иссык: { ru: "Иссык", kz: "Есік", en: "Esik" },
  Кокшетау: { ru: "Кокшетау", kz: "Көкшетау", en: "Kokshetau" },
  Петропавловск: { ru: "Петропавловск", kz: "Петропавл", en: "Petropavl" },
  Талдыкорган: { ru: "Талдыкорган", kz: "Талдықорған", en: "Taldykorgan" },
  Туркестан: { ru: "Туркестан", kz: "Түркістан", en: "Turkistan" },
  Экибастуз: { ru: "Экибастуз", kz: "Екібастұз", en: "Ekibastuz" },
} as const satisfies Record<DirectoryCity, CityLabels>;

const CITY_ENTRIES = Object.entries(CITY_LABELS) as Array<[DirectoryCity, CityLabels]>;
const NORMALIZED_CITY_NAMES = new Map<string, DirectoryCity>();

function normalizeCityName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

for (const [canonical, labels] of CITY_ENTRIES) {
  NORMALIZED_CITY_NAMES.set(normalizeCityName(canonical), canonical);
  for (const label of Object.values(labels)) {
    NORMALIZED_CITY_NAMES.set(normalizeCityName(label), canonical);
  }
}

/** Returns a localized label without changing the canonical value. */
export function cityDisplayName(city: string, lang: Lang): string {
  const canonical = NORMALIZED_CITY_NAMES.get(normalizeCityName(city));
  return canonical ? CITY_LABELS[canonical][lang] : city;
}

/**
 * Resolves a translated label back to the API-safe canonical value. Unknown
 * input is kept verbatim so checkout's free-form city field remains editable.
 */
export function canonicalCityName(value: string): string {
  return NORMALIZED_CITY_NAMES.get(normalizeCityName(value)) ?? value;
}
