import { secureMedusaBaseUrl } from "./medusaUrl.ts";
import { pharmacyCoordinate } from "./pharmacy-stock.ts";
import { withRegistryCoordinates } from "./pharmacy-coordinate-registry.ts";

export type MedusaPharmacyPoint = {
  sourceCode: string; name: string; city: string; address: string; hours: string;
  lat?: number; lon?: number;
};

/** Expose only public location fields. Never infer a location id from an address. */
export function normalizeMedusaPharmacies(value: unknown): MedusaPharmacyPoint[] {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (!Array.isArray(payload.pharmacies)) throw new Error("medusa_pharmacies_invalid");
  if (Number(payload.count) > payload.pharmacies.length) throw new Error("medusa_pharmacies_incomplete");
  return payload.pharmacies.flatMap((raw): MedusaPharmacyPoint[] => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sourceCode = String(row.location_id || row.id || "");
    if (!/^sloc_[A-Za-z0-9]+$/.test(sourceCode) || row.active === false || row.is_active === false) return [];
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const address = row.address && typeof row.address === "object" ? row.address as Record<string, unknown> : {};
    const name = String(row.name || "Аптека со склада");
    const city = String(row.city || address.city || metadata.city || name.match(/г\.?\s*([А-ЯЁA-Z][А-Яа-яёЁA-Za-z-]+)/)?.[1] || "");
    const latitude = row.lat ?? row.latitude ?? metadata.lat ?? metadata.latitude;
    const longitude = row.lon ?? row.longitude ?? metadata.lon ?? metadata.longitude;
    return [withRegistryCoordinates({ sourceCode, name, city,
      address: typeof row.address === "string" ? row.address : String(address.address_1 || metadata.address || name),
      hours: String(row.hours || metadata.hours || ""),
      lat: pharmacyCoordinate(latitude, 90),
      lon: pharmacyCoordinate(longitude, 180),
    })];
  });
}

export async function getMedusaPharmacies(city?: string): Promise<MedusaPharmacyPoint[]> {
  const base = secureMedusaBaseUrl(process.env.MEDUSA_URL);
  const key = process.env.MEDUSA_PUBLISHABLE_KEY || "";
  if (!base || !key || process.env.MEDUSA_ENABLED === "false") throw new Error("medusa_pharmacies_unavailable");
  const url = new URL("/store/pharmacies", base);
  url.searchParams.set("limit", "2000");
  const response = await fetch(url, {
    headers: { "x-publishable-api-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("medusa_pharmacies_unavailable");
  const pharmacies = normalizeMedusaPharmacies(await response.json());
  return city ? pharmacies.filter((pharmacy) => pharmacy.city.toLocaleLowerCase("ru") === city.trim().toLocaleLowerCase("ru")) : pharmacies;
}
