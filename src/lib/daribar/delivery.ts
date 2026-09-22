import { createHash } from "node:crypto";
import { kztMinorUnits } from "../money.ts";
import { DaribarHttpError, daribarJson } from "./client.ts";
import { isDaribarDeliveryEnabled } from "./config.ts";

export type DaribarDeliveryMode = "city" | "pharmacy";
export type DaribarDeliveryProvider = "yandex" | "choco" | "wolt";
export type DaribarDeliveryType = "on_demand" | "pedestrian" | "slot";
export type DaribarDeliveryDestination = { address?: string; lat?: number; lng?: number };
export type DaribarDeliveryItem = { sku: string; countDesired: number };
export type DaribarDeliveryOrderItem = { sku: string; countDesired: number; pharmacyCount: number };
export type DaribarDeliveryOption = {
  provider: DaribarDeliveryProvider; deliveryType: DaribarDeliveryType;
  price: number; eta: number; distance: number;
};
export type DaribarDeliveryPharmacy = {
  code: string; name: string; city: string; address: string; lat?: number; lon?: number;
};
export type DaribarDeliveryOffer = {
  pharmacy: DaribarDeliveryPharmacy; itemsPrice: number;
  orderItems: DaribarDeliveryOrderItem[]; options: DaribarDeliveryOption[];
  bestDelivery: DaribarDeliveryOption; total: number;
};

const PROVIDERS = new Set<DaribarDeliveryProvider>(["yandex", "choco", "wolt"]);
const TYPES = new Set<DaribarDeliveryType>(["on_demand", "pedestrian", "slot"]);

export class DaribarDeliveryError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = "DaribarDeliveryError"; this.status = status; this.code = code; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}
function number(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function integer(value: unknown, min: number, max: number): number | null {
  const parsed = number(value, min, max);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}
function money(value: unknown): number | null {
  const minor = kztMinorUnits(value);
  return minor !== null && minor >= 0 && minor <= 100_000_000 ? minor / 100 : null;
}
function parseOption(value: unknown): DaribarDeliveryOption | null {
  const raw = record(value);
  if (!raw) return null;
  const provider = text(raw.provider, 32) as DaribarDeliveryProvider;
  const upstreamType = text(raw.delivery_type, 32);
  const deliveryType = (upstreamType === "ondemand" ? "on_demand" : upstreamType) as DaribarDeliveryType;
  const price = money(raw.price), eta = number(raw.eta, 1, 24 * 60), distance = number(raw.distance, 0, 1_000_000);
  return PROVIDERS.has(provider) && TYPES.has(deliveryType) && price !== null && eta !== null && distance !== null
    ? { provider, deliveryType, price, eta, distance } : null;
}
function configuredOrderMethod(provider: DaribarDeliveryProvider): string {
  if (provider === "yandex") return "delivery_yandex";
  const value = text(process.env[`DARIBAR_DELIVERY_METHOD_${provider.toUpperCase()}`], 100);
  return /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : "";
}
export function daribarDeliveryOrderMethod(provider: DaribarDeliveryProvider): string {
  const method = configuredOrderMethod(provider);
  if (!method) throw new DaribarDeliveryError(409, "delivery_provider_not_orderable");
  return method;
}
function orderableOffer(offer: DaribarDeliveryOffer): DaribarDeliveryOffer | null {
  // Slot pricing is not orderable until Daribar supplies a start/end interval.
  const options = offer.options.filter(option => option.deliveryType !== "slot" && Boolean(configuredOrderMethod(option.provider)));
  if (!options.length) return null;
  options.sort((left, right) => left.price - right.price || left.eta - right.eta || left.provider.localeCompare(right.provider));
  const bestDelivery = options[0];
  return { ...offer, options, bestDelivery, total: offer.itemsPrice + bestDelivery.price };
}
function parsePharmacy(value: unknown): DaribarDeliveryPharmacy | null {
  const raw = record(value);
  if (!raw) return null;
  const code = text(raw.code, 128), name = text(raw.name, 300), city = text(raw.city, 100), address = text(raw.address, 500);
  const lat = raw.lat == null ? undefined : number(raw.lat, -90, 90) ?? undefined;
  const lon = raw.lon == null ? undefined : number(raw.lon, -180, 180) ?? undefined;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(code) || !name || !city) return null;
  return { code, name, city, address, ...(lat !== undefined ? { lat } : {}), ...(lon !== undefined ? { lon } : {}) };
}
function parseOrderItems(value: unknown, pharmacyCode: string, itemsPrice: number, expected: DaribarDeliveryItem[]): DaribarDeliveryOrderItem[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = new Map<string, DaribarDeliveryOrderItem>();
  let totalMinor = 0;
  for (const item of value) {
    const raw = record(item), sku = text(raw?.sku, 160), sourceCode = text(raw?.source_code, 128);
    const countDesired = integer(raw?.quantity_desired, 1, 99), pharmacyCount = integer(raw?.quantity, 0, 10_000_000);
    const unitPrice = money(raw?.price_with_warehouse_discount) ?? money(raw?.base_price);
    if (!raw || !/^[A-Za-z0-9._-]{1,160}$/.test(sku) || parsed.has(sku) || sourceCode !== pharmacyCode
        || countDesired === null || pharmacyCount === null || pharmacyCount < countDesired || unitPrice === null) return null;
    const unitMinor = kztMinorUnits(unitPrice);
    if (unitMinor === null || !Number.isSafeInteger(unitMinor * countDesired)) return null;
    totalMinor += unitMinor * countDesired;
    if (!Number.isSafeInteger(totalMinor)) return null;
    parsed.set(sku, { sku, countDesired, pharmacyCount });
  }
  if (kztMinorUnits(itemsPrice) !== totalMinor || parsed.size !== expected.length) return null;
  const ordered: DaribarDeliveryOrderItem[] = [];
  for (const item of expected) {
    const mapped = parsed.get(item.sku);
    if (!mapped || mapped.countDesired !== item.countDesired) return null;
    ordered.push(mapped);
  }
  return ordered;
}
export function parseDaribarDeliveryOffer(value: unknown, expected: DaribarDeliveryItem[]): DaribarDeliveryOffer | null {
  const raw = record(value), pharmacy = parsePharmacy(raw?.pharmacy), itemsPrice = money(raw?.items_price);
  const options = Array.isArray(raw?.delivery) ? raw!.delivery.map(parseOption).filter(Boolean) as DaribarDeliveryOption[] : [];
  if (!raw || !pharmacy || itemsPrice === null || !options.length) return null;
  const orderItems = parseOrderItems(raw.items, pharmacy.code, itemsPrice, expected);
  if (!orderItems) return null;
  options.sort((left, right) => left.price - right.price || left.eta - right.eta || left.provider.localeCompare(right.provider));
  const bestDelivery = options[0], total = itemsPrice + bestDelivery.price;
  const declaredTotal = raw.total == null ? null : money(raw.total);
  if (declaredTotal !== null && kztMinorUnits(declaredTotal) !== kztMinorUnits(total)) return null;
  return { pharmacy, itemsPrice, orderItems, options, bestDelivery, total };
}
function unwrap(value: unknown): Record<string, unknown> {
  const raw = record(value);
  if (!raw || raw.status !== "success" || !("result" in raw)) throw new DaribarDeliveryError(502, "delivery_invalid_response");
  return raw;
}
function normalizedItems(items: DaribarDeliveryItem[]): Array<{ sku: string; count_desired: number }> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new DaribarDeliveryError(400, "invalid_delivery_items");
  const seen = new Set<string>();
  return items.map(item => {
    const sku = text(item?.sku, 160);
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(sku) || seen.has(sku) || !Number.isSafeInteger(item?.countDesired)
        || item.countDesired < 1 || item.countDesired > 99) throw new DaribarDeliveryError(409, "delivery_product_mapping_ambiguous");
    seen.add(sku); return { sku, count_desired: item.countDesired };
  });
}
export function normalizeDeliveryDestination(value: DaribarDeliveryDestination): DaribarDeliveryDestination {
  const address = text(value?.address, 500);
  const lat = value?.lat == null ? undefined : number(value.lat, -90, 90) ?? undefined;
  const lng = value?.lng == null ? undefined : number(value.lng, -180, 180) ?? undefined;
  if (!address && (lat === undefined || lng === undefined)) throw new DaribarDeliveryError(400, "delivery_destination_required");
  return { ...(address ? { address } : {}), ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) };
}
export function deliveryDestinationHash(city: string, address: string): string {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  return createHash("sha256").update(`${normalize(city)}\u0000${normalize(address)}`).digest("hex");
}
async function call(path: "/api/v2/delivery/prices" | "/api/v2/delivery/alternatives", body: unknown): Promise<unknown> {
  if (!isDaribarDeliveryEnabled()) throw new DaribarDeliveryError(503, "delivery_not_enabled");
  try {
    return await daribarJson(path, { method: "POST", origin: "commerce", auth: false, body,
      query: { enable_on_site: false }, timeoutMs: 20_000, maxBytes: 512 * 1024 });
  } catch (error) {
    if (error instanceof DaribarHttpError) {
      if (error.status === 404) throw new DaribarDeliveryError(409, "selected_pharmacy_unavailable");
      if (error.status === 409) throw new DaribarDeliveryError(409, "no_delivery_available");
      throw new DaribarDeliveryError(error.status >= 400 ? error.status : 502, "delivery_service_unavailable");
    }
    throw error;
  }
}
export async function deliveryForPharmacy(input: { sourceCode: string; items: DaribarDeliveryItem[]; destination: DaribarDeliveryDestination }): Promise<DaribarDeliveryOffer> {
  const sourceCode = text(input.sourceCode, 128), items = normalizedItems(input.items);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sourceCode)) throw new DaribarDeliveryError(400, "invalid_delivery_pharmacy");
  const response = unwrap(await call("/api/v2/delivery/prices", { source_code: sourceCode, items, dst: normalizeDeliveryDestination(input.destination) }));
  if (response.result === null) throw new DaribarDeliveryError(409, "selected_pharmacy_unavailable");
  const parsed = parseDaribarDeliveryOffer(response.result, items.map(item => ({ sku: item.sku, countDesired: item.count_desired })));
  const offer = parsed ? orderableOffer(parsed) : null;
  if (!offer || offer.pharmacy.code !== sourceCode) throw new DaribarDeliveryError(502, "delivery_invalid_response");
  return offer;
}
export async function bestDeliveryInCity(input: { city: string; items: DaribarDeliveryItem[]; destination: DaribarDeliveryDestination; sourceCode: string }): Promise<{ best: DaribarDeliveryOffer; alternatives: DaribarDeliveryOffer[] }> {
  const city = text(input.city, 100), sourceCode = text(input.sourceCode, 128), items = normalizedItems(input.items);
  if (!city) throw new DaribarDeliveryError(400, "delivery_city_required");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sourceCode)) throw new DaribarDeliveryError(400, "invalid_delivery_pharmacy");
  const response = unwrap(await call("/api/v2/delivery/alternatives", { source_code: sourceCode, items, dst: normalizeDeliveryDestination(input.destination) }));
  if (!Array.isArray(response.result)) throw new DaribarDeliveryError(502, "delivery_invalid_response");
  const expected = items.map(item => ({ sku: item.sku, countDesired: item.count_desired }));
  const offers = response.result.map(value => parseDaribarDeliveryOffer(value, expected));
  if (offers.some(offer => !offer)) throw new DaribarDeliveryError(502, "delivery_invalid_response");
  const normalizedCity = city.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  const valid = (offers as DaribarDeliveryOffer[]).map(orderableOffer).filter((offer): offer is DaribarDeliveryOffer => Boolean(offer))
    .filter(offer => offer.pharmacy.city.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ") === normalizedCity);
  // Product prices are owned by Medusa and are identical for every fulfilment
  // candidate. Rank the city-wide alternatives only by courier price and ETA.
  valid.sort((left, right) => left.bestDelivery.price - right.bestDelivery.price
    || left.bestDelivery.eta - right.bestDelivery.eta
    || left.pharmacy.code.localeCompare(right.pharmacy.code));
  if (!valid[0]) throw new DaribarDeliveryError(409, "no_delivery_available");
  return { best: valid[0], alternatives: valid.slice(1) };
}
