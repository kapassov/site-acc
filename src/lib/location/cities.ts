/**
 * Canonical city values sent to Daribar and stored in the user's preferences.
 * Keep these values independent from the language used to render the UI.
 */
export const CITIES = [
  "Алматы",
  "Астана",
  "Шымкент",
  "Караганда",
  "Актобе",
  "Тараз",
  "Павлодар",
  "Усть-Каменогорск",
  "Семей",
  "Атырау",
  "Костанай",
  "Кызылорда",
  "Уральск",
  "Актау",
] as const;

export type City = (typeof CITIES)[number];
