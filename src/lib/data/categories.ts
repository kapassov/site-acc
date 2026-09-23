import type { Category } from "@/lib/types";

export const categories: Category[] = [
  { id: "c1", slug: "face-care",        name: "Уход за лицом",         icon: "Sparkles",   from: "#eafaf6", to: "#c9efe3", count: 1248 },
  { id: "c2", slug: "body-care",        name: "Уход за телом",         icon: "Droplets",   from: "#eef4ff", to: "#dbe7ff", count: 864 },
  { id: "c3", slug: "mom-baby",         name: "Мама и малыш",          icon: "Baby",       from: "#fff0f5", to: "#ffdfeb", count: 612 },
  { id: "c4", slug: "vitamins",         name: "Витамины и БАДы",       icon: "Pill",       from: "#fff6e6", to: "#ffe7bc", count: 1530 },
  { id: "c5", slug: "medicines",        name: "Лекарства",             icon: "HeartPulse", from: "#eafaf6", to: "#d2efe7", count: 3120 },
  { id: "c6", slug: "hygiene",          name: "Гигиена",               icon: "ShowerHead", from: "#e9fbff", to: "#d1f2fb", count: 742 },
  { id: "c7", slug: "sun",              name: "Солнцезащита",          icon: "Sun",        from: "#fff4e0", to: "#ffe4b3", count: 318 },
  { id: "c8", slug: "makeup",           name: "Красота и макияж",      icon: "Brush",      from: "#f6efff", to: "#e7d8ff", count: 980 },
  { id: "c9", slug: "medical-products", name: "Медицинская продукция", icon: "Stethoscope", from: "#edf9f5", to: "#d3eee4", count: 0 },
];
