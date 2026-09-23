import type { Brand } from "@/lib/types";

/** Бренды Inkar из ТЗ (Larimide, SelfieLab, Ivatherm, Deo). */
export const brands: Brand[] = [
  { id: "b1", slug: "larimide", name: "Larimide", tagline: "Дерматокосметика", hue: 168 },
  { id: "b2", slug: "selfielab", name: "SelfieLab", tagline: "Корейский уход", hue: 280 },
  { id: "b3", slug: "ivatherm", name: "Ivatherm", tagline: "Термальный уход", hue: 200 },
  { id: "b4", slug: "deo", name: "Deo", tagline: "Гигиена каждый день", hue: 220 },
];
