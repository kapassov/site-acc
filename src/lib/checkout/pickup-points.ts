import type { PharmacyPoint } from "../pharmacies.ts";

/** A verified pickup location may be selectable before its map coordinates exist. */
export type PickupPoint = Omit<PharmacyPoint, "lat" | "lon"> & { lat?: number; lon?: number };

export function isMedusaPickupPoint(value: unknown): value is PickupPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<PickupPoint>;
  return typeof point.sourceCode === "string" && /^sloc_[A-Za-z0-9]+$/.test(point.sourceCode)
    && typeof point.address === "string" && Boolean(point.address.trim())
    && typeof point.city === "string" && Boolean(point.city.trim())
    && typeof point.hours === "string";
}

export function hasPickupCoordinates(point: PickupPoint): point is PharmacyPoint {
  return typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lon === "number" && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180
    && !(point.lat === 0 && point.lon === 0);
}
