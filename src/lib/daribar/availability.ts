import { daribarJson } from "./client.ts";
import { daribarKeywordCity, responseProducts } from "./catalog.ts";
import { daribarSkuFromProductId, isDaribarSku } from "./ids.ts";
import { getDaribarPharmacies, type DaribarPharmacyDto } from "./pharmacies.ts";
import { DaribarV3SearchError, searchDaribarProductsV3 } from "./product-search-v3.ts";

const MAX_PUBLIC_PHARMACIES = 50;
const FRESH_MS = 20_000;
const STALE_MS = 60_000;
const MAX_CACHE_ENTRIES = 256;
const PHARMACY_CONCURRENCY = 4;
const MAX_QUANTITY = 1_000_000;
const MAX_PRICE_KZT = 100_000_000;
const SOURCE_CODE = /^[A-Za-z0-9._:-]{1,128}$/;

const SUPPORTED_CITIES = new Map<string, string>([
  ["алматы", "Алматы"],
  ["астана", "Астана"],
  ["шымкент", "Шымкент"],
  ["караганда", "Караганда"],
  ["актобе", "Актобе"],
  ["тараз", "Тараз"],
  ["павлодар", "Павлодар"],
  ["усть-каменогорск", "Усть-Каменогорск"],
  ["семей", "Семей"],
  ["атырау", "Атырау"],
  ["костанай", "Костанай"],
  ["кызылорда", "Кызылорда"],
  ["уральск", "Уральск"],
  ["актау", "Актау"],
]);

export type DaribarPharmacyAvailability = {
  sourceCode: string;
  name: string;
  city: string;
  address?: string;
  lat: number;
  lon: number;
  hours: string;
  quantity: number;
  price: number;
};

export type DaribarAvailability = {
  city: string;
  total: number;
  pharmacies: DaribarPharmacyAvailability[];
  generatedAt: string;
  checkedPharmacies: number;
  partial: boolean;
  stale: boolean;
};

export type DaribarExactStockRequest = {
  sku: string;
  quantity: number;
};

export type DaribarExactStockLine = {
  sku: string;
  availableQuantity: number;
  unitPrice: number;
};

type CacheEntry = {
  value: DaribarAvailability;
  freshUntil: number;
  staleUntil: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DaribarAvailability>>();

export class DaribarAvailabilityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DaribarAvailabilityError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeAvailabilityCity(value: unknown): string | null {
  const city = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!city) return "Алматы";
  return SUPPORTED_CITIES.get(city.toLocaleLowerCase("ru-RU")) ?? null;
}

function remember(key: string, value: DaribarAvailability): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const now = Date.now();
  cache.set(key, { value, freshUntil: now + FRESH_MS, staleUntil: now + STALE_MS });
}

async function fetchAvailability(productId: string, city: string): Promise<DaribarAvailability> {
  const sku = daribarSkuFromProductId(productId);
  if (!sku) throw new DaribarAvailabilityError(400, "invalid_product");
  const allowedPharmacies = (await getDaribarPharmacies(city))
    .filter((pharmacy) => Boolean(pharmacy.sourceCode))
    .slice(0, MAX_PUBLIC_PHARMACIES);
  if (allowedPharmacies.length === 0) {
    return {
      city,
      total: 0,
      pharmacies: [],
      generatedAt: new Date().toISOString(),
      checkedPharmacies: 0,
      partial: false,
      stale: false,
    };
  }

  const results: Array<{ ok: boolean; pharmacy: DaribarPharmacyDto; stock?: DaribarPharmacyAvailability }> = [];
  for (let offset = 0; offset < allowedPharmacies.length; offset += PHARMACY_CONCURRENCY) {
    const batch = allowedPharmacies.slice(offset, offset + PHARMACY_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(async (pharmacy) => {
      const payload = await daribarJson<{ matching_products?: unknown }>("/api/v1/search/in_pharmacy", {
        method: "POST",
        origin: "auth",
        auth: false,
        body: {
          product_name: sku,
          code: pharmacy.sourceCode,
          city: daribarKeywordCity(city),
          filter_by_ip: false,
          hide_recipe: false,
          sorting: true,
          use_adjustment: true,
        },
        timeoutMs: 6_000,
        maxBytes: 1024 * 1024,
      });
      const exact = responseProducts(payload).find((product) => product.sku === sku);
      const quantity = positiveInteger(exact?.quantity, MAX_QUANTITY);
      const price = positivePrice(
        exact?.min_customer_price,
        exact?.avg_customer_price,
        exact?.max_customer_price,
        exact?.price,
      );
      return {
        ok: true,
        pharmacy,
        ...(quantity && price ? {
          stock: {
            sourceCode: pharmacy.sourceCode!,
            name: pharmacy.name,
            city: pharmacy.city || city,
            address: pharmacy.address,
            lat: pharmacy.lat,
            lon: pharmacy.lon,
            hours: pharmacy.hours,
            quantity,
            price,
          } satisfies DaribarPharmacyAvailability,
        } : {}),
      };
    }));
    settled.forEach((result, index) => {
      results.push(result.status === "fulfilled"
        ? result.value
        : { ok: false, pharmacy: batch[index] });
    });
  }
  const checkedPharmacies = results.filter((result) => result.ok).length;
  if (checkedPharmacies === 0) throw new DaribarAvailabilityError(503, "availability_unavailable");
  const pharmacies = results.flatMap((result) => result.stock ? [result.stock] : [])
    .sort((left, right) => left.price - right.price || left.name.localeCompare(right.name, "ru"));
  return {
    city,
    total: pharmacies.length,
    pharmacies,
    generatedAt: new Date().toISOString(),
    checkedPharmacies,
    partial: checkedPharmacies !== allowedPharmacies.length,
    stale: false,
  };
}

function positiveInteger(value: unknown, max: number): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= max ? numeric : null;
}

function positivePrice(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:[.,]\d+)?$/.test(value.trim())
        ? Number(value.replace(",", "."))
        : Number.NaN;
    if (!Number.isFinite(numeric)) continue;
    const price = Math.round(numeric);
    if (Number.isSafeInteger(price) && price > 0 && price <= MAX_PRICE_KZT) return price;
  }
  return null;
}

/**
 * Revalidates every requested SKU against one production Daribar pharmacy.
 * Calls are intentionally limited to the same small concurrency used by the
 * public PDP availability lookup. Daribar decides only whether the exact SKU
 * has sufficient quantity; its product price is not a checkout authority.
 */
export async function getDaribarExactPharmacyStock(input: {
  sourceCode: string;
  city: string;
  items: DaribarExactStockRequest[];
}): Promise<DaribarExactStockLine[]> {
  const sourceCode = String(input.sourceCode || "").trim();
  const city = String(input.city || "").trim() || "Алматы";
  if (!SOURCE_CODE.test(sourceCode)
      || !Array.isArray(input.items)
      || input.items.length === 0
      || input.items.length > 30
      || input.items.some((item) => (
        !isDaribarSku(item?.sku)
        || !Number.isSafeInteger(item.quantity)
        || item.quantity < 1
        || item.quantity > 99
      ))) {
    throw new DaribarAvailabilityError(400, "invalid_exact_stock_request");
  }

  let pharmacies;
  try {
    pharmacies = await searchDaribarProductsV3({
      sourceCode,
      city,
      items: input.items.map((item, index) => ({
        sku: item.sku,
        countDesired: item.quantity,
        priority: input.items.length - index,
      })),
      availability: "all",
      replacements: false,
      limit: 1,
    });
  } catch (error) {
    if (error instanceof DaribarV3SearchError) {
      throw new DaribarAvailabilityError(error.status, error.code);
    }
    throw error;
  }
  const pharmacy = pharmacies.find((item) => item.sourceCode === sourceCode);
  if (!pharmacy) throw new DaribarAvailabilityError(409, "cart_item_unavailable");
  const exactBySku = new Map(pharmacy.products.map((item) => [item.sku, item]));
  return input.items.map((item) => {
    const exact = exactBySku.get(item.sku);
    if (!exact || exact.quantity < item.quantity) {
      throw new DaribarAvailabilityError(409, "cart_item_unavailable");
    }
    return { sku: item.sku, availableQuantity: exact.quantity, unitPrice: exact.price };
  });
}

/**
 * Returns exact Daribar stock for a single SKU in pharmacies of the selected
 * city. Fresh values are briefly coalesced; a value up to one minute old is
 * used only if Daribar is temporarily unavailable.
 */
export async function getDaribarAvailability(productId: string, city: string): Promise<DaribarAvailability> {
  const key = `${city}\u0000${productId}`;
  const existing = cache.get(key);
  const now = Date.now();
  if (existing && existing.freshUntil > now) return existing.value;

  const pending = inflight.get(key) ?? fetchAvailability(productId, city)
    .then((value) => {
      if (!value.partial) remember(key, value);
      return value;
    })
    .catch((error) => {
      if (existing && existing.staleUntil > Date.now()) return { ...existing.value, stale: true };
      throw error;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}
