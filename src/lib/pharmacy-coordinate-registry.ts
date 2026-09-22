import { allPharmacies } from "./pharmacies.ts";

type CoordinateCandidate = {
  city: string;
  address: string;
  hours?: string;
  lat?: number;
  lon?: number;
};

function normalized(value: unknown): string {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\\/g, "/")
    .replace(/(?<!\p{L})(?:г|город)\.?\s*[\p{L}-]+(?=\s|,|$)/gu, " ")
    .replace(/(?<!\p{L})(?:улица|ул|микрорайон|мкрн|мкр)\.?(?=\s|\d|$)/gu, " ")
    .replace(/(?<!\p{L})(?:дом|д)\.?(?=\s|\d|$)\s*/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function numberTokens(value: string): string[] {
  return normalized(value).match(/\d+[а-яa-z]?/gu) || [];
}

function validCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

/**
 * Fill missing map coordinates only from a unique, high-confidence match in
 * the previously verified pharmacy registry. The Medusa location id remains
 * authoritative and is never inferred from a human-readable address.
 */
export function withRegistryCoordinates<T extends CoordinateCandidate>(point: T): T {
  if (validCoordinate(point.lat, 90) && validCoordinate(point.lon, 180)
      && !(point.lat === 0 && point.lon === 0)) return point;

  const city = normalized(point.city);
  const address = normalized(point.address);
  if (!city || address.length < 3) return point;
  const exact = allPharmacies.filter((candidate) => (
    normalized(candidate.city) === city && normalized(candidate.address) === address
  ));
  let matches = exact;

  if (matches.length === 0 && address.length >= 5) {
    const numbers = numberTokens(address).join("|");
    matches = allPharmacies.filter((candidate) => {
      if (normalized(candidate.city) !== city) return false;
      const candidateAddress = normalized(candidate.address);
      return candidateAddress.length >= 5
        && (candidateAddress.includes(address) || address.includes(candidateAddress))
        && numberTokens(candidateAddress).join("|") === numbers;
    });
  }

  if (matches.length !== 1) return point;
  const match = matches[0];
  return {
    ...point,
    lat: match.lat,
    lon: match.lon,
    hours: point.hours || match.hours,
  };
}
