import { kztMinorUnits } from "./money.ts";

export type PharmacyStock = {
  sourceCode: string; name: string; city: string; address?: string;
  lat?: number; lon?: number; hours?: string; quantity: number; price?: number;
};

/** Availability exposes whole sellable packs, but KZT prices may include tiyn. */
export function isPharmacyStock(value: unknown): value is PharmacyStock {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const minor = row.price === undefined ? null : kztMinorUnits(row.price);
  return typeof row.sourceCode === "string" && typeof row.name === "string" && typeof row.city === "string"
    && (row.address == null || typeof row.address === "string")
    && Number.isSafeInteger(row.quantity) && Number(row.quantity) > 0
    && (row.price === undefined || (minor !== null && minor > 0));
}

/** Missing coordinates are unknown, not the numeric value Number(null) === 0. */
export function pharmacyCoordinate(value: unknown, limit: 90 | 180): number | undefined {
  if ((typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !value.trim())) return undefined;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && Math.abs(coordinate) <= limit ? coordinate : undefined;
}
