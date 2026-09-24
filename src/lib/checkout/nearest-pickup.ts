import { nearestCity, type PharmacyPoint } from "../pharmacies.ts";
import type { CanonicalCheckoutItem } from "../checkoutItems.ts";
import { findNearestPharmacy, type DeviceLocation } from "./pickup-geolocation.ts";
import { isMedusaPickupPoint } from "./pickup-points.ts";

export type NearestPickup = {
  pharmacy: PharmacyPoint;
  city: string;
  points: PharmacyPoint[];
  distanceKm: number;
};

export class PickupLookupFailure extends Error {
  readonly code: "unavailable" | "empty" | "coordinates_unavailable" | "timeout";

  constructor(code: "unavailable" | "empty" | "coordinates_unavailable" | "timeout") {
    super(code === "coordinates_unavailable"
      ? "У доступных аптек пока нет подтверждённых координат. Выберите аптеку из списка."
      : code === "empty"
      ? "Не нашли аптеки с подтверждёнными координатами. Выберите аптеку на карте."
      : code === "timeout"
        ? "Аптеки не успели загрузиться. Попробуйте ещё раз или выберите аптеку на карте."
        : "Не удалось загрузить актуальный список аптек. Попробуйте ещё раз или выберите аптеку на карте.");
    this.name = "PickupLookupFailure";
    this.code = code;
  }
}

function isSelectablePickupPoint(value: unknown): value is Omit<PharmacyPoint, "lat" | "lon"> & { lat?: number; lon?: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<PharmacyPoint>;
  return typeof point.sourceCode === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(point.sourceCode)
    && typeof point.address === "string" && Boolean(point.address.trim())
    && typeof point.city === "string" && Boolean(point.city.trim())
    && typeof point.hours === "string";
}

function isPickupPoint(value: unknown): value is PharmacyPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<PharmacyPoint>;
  return typeof point.sourceCode === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(point.sourceCode)
    && typeof point.address === "string" && Boolean(point.address.trim())
    && typeof point.city === "string" && Boolean(point.city.trim())
    && typeof point.hours === "string"
    && typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lon === "number" && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180
    && !(point.lat === 0 && point.lon === 0);
}

export function nearestPickupFromPayload(
  payload: unknown,
  location: DeviceLocation,
  expectedSource: "daribar_v3" | "medusa" = "daribar_v3",
): NearestPickup {
  if (!payload || typeof payload !== "object") throw new PickupLookupFailure("unavailable");
  const data = payload as { source?: unknown; degraded?: unknown; pharmacies?: unknown };
  // A stale/static registry must never be presented as a confirmed nearest pickup point.
  if (data.source !== expectedSource || data.degraded !== false || !Array.isArray(data.pharmacies)) {
    throw new PickupLookupFailure("unavailable");
  }
  const selectable = data.pharmacies.filter((value) => {
    if (!isSelectablePickupPoint(value)) return false;
    if (expectedSource === "medusa") return true;
    const total = (value as { total?: unknown }).total;
    return isMedusaPickupPoint(value) && typeof total === "number" && Number.isFinite(total) && total > 0;
  });
  if (!selectable.length) throw new PickupLookupFailure("empty");
  const points = selectable.filter(isPickupPoint);
  if (!points.length) throw new PickupLookupFailure("coordinates_unavailable");
  const nearest = findNearestPharmacy(points, location);
  if (!nearest) throw new PickupLookupFailure("empty");
  const city = nearest.pharmacy.city.trim();
  const cityKey = city.toLocaleLowerCase("ru");
  return {
    pharmacy: nearest.pharmacy,
    city,
    points: points.filter((point) => point.city.trim().toLocaleLowerCase("ru") === cityKey),
    distanceKm: nearest.distanceKm,
  };
}

export async function loadNearestPickup(
  location: DeviceLocation,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  items?: CanonicalCheckoutItem[],
): Promise<NearestPickup> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12_000);
  try {
    // GPS stays on the device. With a cart, the server receives only product
    // identities and quantities and returns locations able to fulfil it.
    const pickupCity = items?.length ? nearestCity(location.lat, location.lon) : null;
    if (items?.length && !pickupCity) throw new PickupLookupFailure("empty");
    const response = items?.length
      ? await request("/api/checkout/pickup-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items, city: pickupCity }),
          signal: controller.signal,
        })
      : await request("/api/pharmacies?scope=all", { signal: controller.signal });
    if (!response.ok) throw new PickupLookupFailure("unavailable");
    const payload: unknown = await response.json();
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return nearestPickupFromPayload(payload, location, items?.length ? "daribar_v3" : "medusa");
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new PickupLookupFailure("timeout");
    if (error instanceof PickupLookupFailure) throw error;
    throw new PickupLookupFailure("unavailable");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function pickupDistanceLabel(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.max(10, Math.round(distanceKm * 100) * 10)} м`;
  return `${distanceKm.toLocaleString("ru-RU", { maximumFractionDigits: distanceKm < 10 ? 1 : 0 })} км`;
}
