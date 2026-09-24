import {
  buildCatalogBrands,
  buildCatalogFacets,
  filterAndSortCatalog,
  type CatalogFacets,
  type CatalogQuery,
} from "../catalog-query.ts";
import type { Brand, Category, Product, ProductArtKind } from "../types.ts";
import { CATALOG_DIRECTORY_CATEGORY_IDS } from "../catalog-directory.ts";
import {
  daribarProductId,
  daribarProductSlug,
  daribarVariantId,
  isDaribarSku,
} from "./ids.ts";

export type DaribarRawProduct = {
  sku?: unknown;
  name?: unknown;
  url_key?: unknown;
  categories_ids?: unknown;
  manufacturer?: unknown;
  country_of_manufacturer?: unknown;
  pp_active_substance?: unknown;
  pp_dosage_form?: unknown;
  pp_packing?: unknown;
  recipe_needed?: unknown;
  strong_recipe?: unknown;
  in_stock?: unknown;
  quantity?: unknown;
  min_customer_price?: unknown;
  avg_customer_price?: unknown;
  max_customer_price?: unknown;
  price?: unknown;
  attributes?: unknown;
};

export type DaribarCategoryDefinition = Category & { daribarIds: string[] };

const CATEGORY_DEFINITIONS: readonly DaribarCategoryDefinition[] = [
  { id: "daribar-bady", slug: "bady", name: "БАДы", icon: "Pill", from: "#0f766e", to: "#14b8a6", count: 0, daribarIds: ["7"] },
  { id: "daribar-gigiyena", slug: "gigiyena", name: "Гигиена", icon: "ShowerHead", from: "#166534", to: "#22c55e", count: 0, daribarIds: ["16"] },
  { id: "daribar-kosmetika", slug: "kosmetika", name: "Косметика", icon: "Sparkles", from: "#1d4ed8", to: "#60a5fa", count: 0, daribarIds: ["5"] },
  { id: "daribar-lekarstva", slug: "lekarstva-i-bady", name: "Лекарства", icon: "HeartPulse", from: "#7e22ce", to: "#c084fc", count: 0, daribarIds: ["9"] },
  { id: "daribar-linzy", slug: "linzy", name: "Линзы", icon: "Droplets", from: "#be123c", to: "#fb7185", count: 0, daribarIds: ["136"] },
  { id: "daribar-mama", slug: "mama-i-malysh", name: "Мама и малыш", icon: "Baby", from: "#b45309", to: "#fbbf24", count: 0, daribarIds: ["22"] },
  { id: "daribar-med", slug: "med-pribory-i-izdeliya", name: "Мед. приборы и изделия", icon: "Stethoscope", from: "#0f766e", to: "#2dd4bf", count: 0, daribarIds: ["14"] },
  { id: "daribar-sport", slug: "sport-i-fitnes", name: "Спорт и фитнес", icon: "Dumbbell", from: "#166534", to: "#4ade80", count: 0, daribarIds: ["18", "203"] },
  { id: "daribar-intim", slug: "intim", name: "Товары для взрослых", icon: "ShieldPlus", from: "#9f1239", to: "#fb7185", count: 0, daribarIds: ["47", "48"] },
  { id: "daribar-drugoe", slug: "drugoe", name: "Другие товары", icon: "Package", from: "#475569", to: "#94a3b8", count: 0, daribarIds: [] },
] as const;

const HIDDEN_CATEGORY_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "zagar-i-zashita-ot-solnca": ["92"],
  ...CATALOG_DIRECTORY_CATEGORY_IDS,
});

function text(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:[.,]\d+)?$/.test(value.trim())
      ? Number(value.replace(",", "."))
      : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function positivePrice(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = numberValue(value);
    if (numeric != null && numeric > 0 && numeric <= 100_000_000) return Math.round(numeric);
  }
  return null;
}

function quantity(value: unknown): number {
  const numeric = numberValue(value);
  return numeric != null && numeric > 0 ? Math.min(100_000_000, Math.floor(numeric)) : 0;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function artKind(name: string): ProductArtKind {
  const value = name.toLocaleLowerCase("ru");
  if (/крем|мазь|гель/.test(value)) return "tube";
  if (/капл|сыворот|масл/.test(value)) return "dropper";
  if (/спрей|аэрозоль/.test(value)) return "spray";
  if (/банка|порош/.test(value)) return "jar";
  if (/сироп|раствор|шампун/.test(value)) return "bottle";
  return "box";
}

function hue(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result % 360;
}

export function daribarRawCategoryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim().slice(0, 80) : "")
    .filter(Boolean))].slice(0, 30);
}

function envCategoryMap(): Record<string, string[]> {
  const raw = String(process.env.DARIBAR_CATEGORY_MAP || "").trim();
  if (!raw || raw.length > 20_000) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [handle, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[a-z0-9_-]{1,120}$/i.test(handle)) continue;
      const candidates = Array.isArray(value) ? value : [value];
      const ids = [...new Set(candidates.map((item) => text(item, 80)).filter(Boolean))].slice(0, 30);
      if (ids.length > 0) result[handle] = ids;
    }
    return result;
  } catch {
    return {};
  }
}

export function daribarCategoryDefinitions(): DaribarCategoryDefinition[] {
  const overrides = envCategoryMap();
  return CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    daribarIds: overrides[category.slug] || [...category.daribarIds],
  }));
}

export function daribarCategoryIds(handle: string | null | undefined): string[] {
  if (!handle) return [];
  return daribarCategoryDefinitions().find((category) => category.slug === handle)?.daribarIds
    || [...(HIDDEN_CATEGORY_IDS[handle] || [])];
}

export function daribarCategoryId(handle: string | null | undefined): string | null {
  return daribarCategoryIds(handle)[0] || null;
}

function canonicalCategoryHandles(ids: string[]): string[] {
  const source = new Set(ids);
  const hiddenHandles = Object.entries(HIDDEN_CATEGORY_IDS)
    .filter(([, categoryIds]) => categoryIds.some((id) => source.has(id)))
    .map(([handle]) => handle);
  const handles = daribarCategoryDefinitions()
    .filter((category) => category.slug !== "drugoe" && category.daribarIds.some((id) => source.has(id)))
    .map((category) => category.slug);
  const combined = [...new Set([...hiddenHandles, ...handles])];
  return combined.length > 0 ? combined : ["drugoe"];
}

function attributes(value: unknown): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!Array.isArray(value)) return result;
  for (const entry of value.slice(0, 200)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const code = text(item.code, 100).toLowerCase();
    const values = Array.isArray(item.values)
      ? item.values.map((candidate) => text(candidate, 2_000)).filter(Boolean).slice(0, 20)
      : [];
    if (code && values.length > 0) result.set(code, values);
  }
  return result;
}

function attributeValue(map: Map<string, string[]>, ...codes: string[]): string {
  for (const code of codes) {
    const value = map.get(code)?.[0];
    if (value) return value;
  }
  return "";
}

function plainText(value: string, max: number): string {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, max);
}

function canonicalBrandName(value: string): string {
  const compact = value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, "");
  return /^(?:тд)?пептидбио$/.test(compact) || /^(?:td)?pept(?:id|ide)bio$/.test(compact)
    ? "Пептид Био"
    : value;
}

export function mapDaribarProduct(raw: DaribarRawProduct): Product | null {
  const sku = text(raw.sku, 96);
  const name = text(raw.name, 300);
  if (!isDaribarSku(sku) || !name || name.toLocaleLowerCase("ru") === "конфиг-рацион") return null;
  const attrs = attributes(raw.attributes);
  const price = positivePrice(raw.min_customer_price, raw.avg_customer_price, raw.max_customer_price, raw.price);
  const stockQuantity = quantity(raw.quantity);
  const inStock = stockQuantity > 0 || bool(raw.in_stock);
  const prescription = bool(raw.recipe_needed) || bool(raw.strong_recipe);
  const rawCategoryIds = daribarRawCategoryIds(raw.categories_ids);
  const categoryHandles = canonicalCategoryHandles(rawCategoryIds);
  const brand = canonicalBrandName(text(raw.manufacturer, 160)
    || text(attributeValue(attrs, "manufacturer", "manufacturer_name", "brand"), 160)
    || "—");
  const packing = text(raw.pp_packing, 120) || text(attributeValue(attrs, "pp_packing", "packing"), 120);
  const dosage = text(raw.pp_dosage_form, 120) || text(attributeValue(attrs, "pp_dosage_form", "dosage_form"), 120);
  const volume = [dosage, packing].filter(Boolean).join(" · ").slice(0, 160) || undefined;
  const image = `/api/media/daribar?sku=${encodeURIComponent(sku)}`;
  const description = plainText(attributeValue(attrs, "description", "short_description"), 8_000);
  const country = text(raw.country_of_manufacturer, 120)
    || text(attributeValue(attrs, "country_of_manufacturer", "country"), 120);
  const activeSubstance = text(raw.pp_active_substance, 180)
    || text(attributeValue(attrs, "pp_active_substance", "active_substance", "mnn"), 180);
  const barcode = text(attributeValue(attrs, "barcode", "ean", "ean13"), 100);
  const variantId = daribarVariantId(sku);
  return {
    id: daribarProductId(sku),
    source: "daribar",
    sku,
    slug: daribarProductSlug(text(raw.url_key, 180) || name, sku),
    name,
    brand,
    categorySlug: categoryHandles[0],
    categoryHandles: [...new Set([...categoryHandles, ...rawCategoryIds])],
    price: price ?? 0,
    priceTBD: price == null,
    rating: 0,
    reviews: 0,
    ...(volume ? { volume } : {}),
    badges: prescription ? ["rx"] : [],
    art: { kind: artKind(name), hue: hue(sku) },
    image,
    images: [image],
    ...(description ? { description } : {}),
    inStock,
    stockPharmacies: inStock ? 1 : 0,
    prescription,
    variantId,
    variants: [{ id: variantId, title: volume || name, sku, ...(price ? { price } : {}) }],
    manufacturer: brand === "—" ? undefined : brand,
    country: country || undefined,
    mnn: activeSubstance || undefined,
    barcode: barcode || undefined,
  };
}

export function dedupeDaribarProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  const result: Product[] = [];
  for (const product of products) {
    const key = product.sku || product.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(product);
  }
  return result;
}

export type DaribarCatalogProjection = {
  products: Product[];
  matched: Product[];
  categories: Category[];
  brands: Brand[];
  facets: CatalogFacets | null;
};

export function projectDaribarCatalog(
  sourceProducts: Product[],
  query: CatalogQuery,
  searchAlreadyApplied = false,
): DaribarCatalogProjection {
  const normalizedQuery = searchAlreadyApplied ? { ...query, q: "" } : query;
  const matched = filterAndSortCatalog(sourceProducts, normalizedQuery, {
    visibleOnly: true,
    // Typesense/native search has already ranked medical name, dosage and form.
    // Never let catalogue merchandising displace an exact search match.
    prioritizeOrderableOtc: !(searchAlreadyApplied && query.sort === "relevance"),
  });
  if (!query.includeFacets) {
    return {
      products: matched.slice(query.offset, query.offset + query.limit),
      matched,
      categories: [],
      brands: [],
      facets: null,
    };
  }
  const baseCategories = daribarCategoryDefinitions().map((category): Category => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    from: category.from,
    to: category.to,
    count: category.count,
  }));
  const facets = buildCatalogFacets(matched, baseCategories);
  const counts = new Map(facets.categories.map((category) => [category.slug, category.count]));
  const categories = baseCategories.map((category) => ({ ...category, count: counts.get(category.slug) || 0 }));
  return {
    products: matched.slice(query.offset, query.offset + query.limit),
    matched,
    categories,
    brands: buildCatalogBrands(matched),
    facets,
  };
}
