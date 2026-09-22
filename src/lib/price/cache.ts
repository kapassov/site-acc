import { kztMinorUnits } from "../money.ts";

export type PriceCacheEntry = { min: number | null; expiresAt: number };
const MAX_AGE_MS = 60_000;
const MAX_ENTRIES = 1_000;

export function priceCacheEntry(min: unknown, validUntil: unknown, now = Date.now()): PriceCacheEntry | undefined {
  if (min !== null && kztMinorUnits(min) === null) return undefined;
  const sourceExpiry = validUntil == null ? Infinity : typeof validUntil === "string" ? Date.parse(validUntil) : NaN;
  const expiresAt = Math.min(now + MAX_AGE_MS, sourceExpiry);
  return expiresAt > now ? { min: min as number | null, expiresAt } : undefined;
}

export function cachedPrice(cache: Map<string, PriceCacheEntry>, id: string, now = Date.now()): PriceCacheEntry | undefined {
  const entry = cache.get(id);
  if (entry && entry.expiresAt > now) return entry;
  cache.delete(id);
  return undefined;
}

export function rememberPrice(cache: Map<string, PriceCacheEntry>, id: string, entry: PriceCacheEntry): void {
  cache.delete(id);
  cache.set(id, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}
