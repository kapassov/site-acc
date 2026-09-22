import { daribarJson, DaribarHttpError } from "./client.ts";
import { daribarIntegrationCode } from "./config.ts";
import { isDaribarSku } from "./ids.ts";

const SOURCE_CODE = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ITEMS = 30;
const MAX_DESIRED = 1_000_000;
const MAX_PRICE = 100_000_000;

export type DaribarV3SearchItem = {
  sku: string;
  countDesired: number;
  priority?: number;
  replacements?: Array<{ sku: string; countDesired: number; priority?: number }>;
};

export type DaribarV3Product = {
  sourceCode: string;
  sku: string;
  wareId?: string;
  name: string;
  basePrice: number;
  price: number;
  quantity: number;
  quantityDesired: number;
  analogs: DaribarV3Product[];
};

export type DaribarV3Pharmacy = {
  sourceCode: string;
  networkCode?: string;
  name: string;
  city: string;
  address: string;
  lat?: number;
  lon?: number;
  openingHours?: string;
  workingToday?: boolean;
  products: DaribarV3Product[];
  distance?: number;
};

export class DaribarV3SearchError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DaribarV3SearchError";
    this.status = status;
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : null;
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE
    ? value : null;
}

function coordinate(value: unknown, limit: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit
    ? value : undefined;
}

function normalizeItems(items: DaribarV3SearchItem[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new DaribarV3SearchError(400, "invalid_product_search_items");
  }
  const seen = new Set<string>();
  return items.map((item) => {
    const sku = text(item?.sku, 160);
    const countDesired = integer(item?.countDesired, 1, MAX_DESIRED);
    const priority = item?.priority == null ? 0 : integer(item.priority, 0, 1_000_000);
    if (!isDaribarSku(sku) || countDesired === null || priority === null || seen.has(sku)) {
      throw new DaribarV3SearchError(400, "invalid_product_search_items");
    }
    seen.add(sku);
    const replacementSeen = new Set<string>();
    const replacements = (item.replacements || []).map((replacement) => {
      const replacementSku = text(replacement?.sku, 160);
      const replacementCount = integer(replacement?.countDesired, 1, MAX_DESIRED);
      const replacementPriority = replacement?.priority == null
        ? 0 : integer(replacement.priority, 0, 1_000_000);
      if (!isDaribarSku(replacementSku) || replacementCount === null || replacementPriority === null
          || replacementSeen.has(replacementSku)) {
        throw new DaribarV3SearchError(400, "invalid_product_search_replacements");
      }
      replacementSeen.add(replacementSku);
      return { sku: replacementSku, count_desired: replacementCount, priority: replacementPriority };
    });
    return { sku, count_desired: countDesired, priority, replacements };
  });
}

function parseProduct(value: unknown, depth = 0): DaribarV3Product | null {
  const raw = record(value);
  if (!raw) return null;
  const sourceCode = text(raw.source_code, 128);
  const sku = text(raw.sku, 160);
  const quantity = integer(raw.quantity, 0, MAX_DESIRED);
  const quantityDesired = integer(raw.quantity_desired, 1, MAX_DESIRED);
  const basePrice = money(raw.base_price);
  const price = money(raw.price_with_warehouse_discount);
  if (!SOURCE_CODE.test(sourceCode) || !isDaribarSku(sku) || quantity === null
      || quantityDesired === null || basePrice === null || price === null
      || quantity > quantityDesired) return null;
  const analogs = depth === 0 && Array.isArray(raw.analogs)
    ? raw.analogs.map((item) => parseProduct(item, 1)).filter((item): item is DaribarV3Product => Boolean(item))
    : [];
  return {
    sourceCode,
    sku,
    ...(text(raw.ware_id, 160) ? { wareId: text(raw.ware_id, 160) } : {}),
    name: text(raw.name, 500),
    basePrice,
    price,
    quantity,
    quantityDesired,
    analogs,
  };
}

function parsePharmacy(value: unknown): DaribarV3Pharmacy | null {
  const raw = record(value);
  const source = record(raw?.source);
  if (!raw || !source || !Array.isArray(raw.products)) return null;
  const sourceCode = text(source.code, 128);
  if (!SOURCE_CODE.test(sourceCode)) return null;
  const products = raw.products.map((item) => parseProduct(item))
    .filter((item): item is DaribarV3Product => item !== null && item.sourceCode === sourceCode);
  if (!products.length) return null;
  const lat = coordinate(source.lat, 90), lon = coordinate(source.lon, 180);
  const distance = typeof raw.haversine_distance === "number" && Number.isFinite(raw.haversine_distance)
    && raw.haversine_distance >= 0 && raw.haversine_distance < Number.MAX_SAFE_INTEGER
    ? raw.haversine_distance : undefined;
  return {
    sourceCode,
    ...(text(source.network_code, 128) ? { networkCode: text(source.network_code, 128) } : {}),
    name: text(source.name, 500) || sourceCode,
    city: text(source.city, 100),
    address: text(source.address, 500),
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
    ...(text(source.opening_hours, 500) ? { openingHours: text(source.opening_hours, 500) } : {}),
    ...(typeof source.working_today === "boolean" ? { workingToday: source.working_today } : {}),
    products,
    ...(distance !== undefined ? { distance } : {}),
  };
}

export async function searchDaribarProductsV3(input: {
  city?: string;
  sourceCode?: string;
  lat?: number;
  lon?: number;
  items: DaribarV3SearchItem[];
  availability?: "all" | "full" | "analogs" | "partial";
  replacements?: boolean;
  /** false keeps only pharmacies that can accept online card payment. */
  enableOnSite?: boolean;
  limit?: number;
  offset?: number;
}): Promise<DaribarV3Pharmacy[]> {
  const city = text(input.city, 100);
  const sourceCode = text(input.sourceCode, 128);
  if ((!city && !sourceCode) || (sourceCode && !SOURCE_CODE.test(sourceCode))) {
    throw new DaribarV3SearchError(400, "city_or_source_code_required");
  }
  const products = normalizeItems(input.items);
  const limit = integer(input.limit ?? 100, 1, 1_000) ?? 100;
  const offset = integer(input.offset ?? 0, 0, 1_000_000) ?? 0;
  const lat = coordinate(input.lat, 90), lon = coordinate(input.lon, 180);
  try {
    const payload = await daribarJson<{ status?: unknown; result?: unknown }>("/api/v3/products/search", {
      method: "POST",
      origin: "commerce",
      auth: false,
      headers: { "X-Integration-Code": daribarIntegrationCode() },
      query: {
        city: city || undefined,
        source_code: sourceCode || undefined,
        sort: lat !== undefined && lon !== undefined ? "distance_close" : "recommended",
        availability: input.availability || "all",
        replacements: input.replacements === true,
        enable_on_site: input.enableOnSite === true,
        use_adjustment: true,
        limit,
        offset,
      },
      body: {
        ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
        products,
      },
      timeoutMs: 15_000,
      maxBytes: 4 * 1024 * 1024,
    });
    if (!payload || payload.status !== "success" || !Array.isArray(payload.result)) {
      throw new DaribarV3SearchError(502, "daribar_product_search_invalid_response");
    }
    const parsed = payload.result.map(parsePharmacy);
    if (parsed.some((row) => !row)) {
      throw new DaribarV3SearchError(502, "daribar_product_search_invalid_response");
    }
    return parsed as DaribarV3Pharmacy[];
  } catch (error) {
    if (error instanceof DaribarV3SearchError) throw error;
    if (error instanceof DaribarHttpError) {
      throw new DaribarV3SearchError(error.status, error.code);
    }
    throw error;
  }
}
