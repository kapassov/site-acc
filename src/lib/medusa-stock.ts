import { exactKzt } from "./money.ts";
import type { Product } from "./types.ts";

/** Standard N stock is authoritative only after a complete, dated Medusa import. */
export const MEDUSA_STOCK_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Cached content and its last known price may remain useful; an expired stock decision never is. */
export function guardMedusaProductStock(product: Product, now = Date.now()): Product {
  if (product.source !== "medusa") return product;
  const observed = Date.parse(`${product.stockSourceDate}T00:00:00Z`);
  const validUntil = product.stockValidUntil === undefined ? Infinity : Date.parse(product.stockValidUntil);
  if (Number.isFinite(observed) && observed >= now - MEDUSA_STOCK_MAX_AGE_MS && observed <= now + 86_400_000 && now < validUntil) return product;
  const hasKnownPrice = Number.isFinite(product.price) && product.price > 0;
  return { ...product, inStock: false, priceTBD: !hasKnownPrice, stockPharmacies: 0, stockStale: true };
}

export function medusaStockMetadata(value: unknown, now = Date.now()) {
  const metadata = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sourceDate = typeof metadata.standard_n_source_date === "string" ? metadata.standard_n_source_date : "";
  const snapshotId = typeof metadata.standard_n_snapshot_id === "string" ? metadata.standard_n_snapshot_id : "";
  const validUntil = typeof metadata.standard_n_valid_until === "string" ? Date.parse(metadata.standard_n_valid_until) : undefined;
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(sourceDate) ? Date.parse(`${sourceDate}T00:00:00Z`) : NaN;
  const fresh = Boolean(snapshotId) && Number.isFinite(timestamp) && timestamp <= now + 86_400_000
    && timestamp >= now - MEDUSA_STOCK_MAX_AGE_MS && (validUntil === undefined || (Number.isFinite(validUntil) && now < validUntil));
  const amount = exactKzt(metadata.standard_n_min_price);
  const knownPrice = amount > 0 ? amount : null;
  const datedPrice = Boolean(snapshotId) && Number.isFinite(timestamp) ? knownPrice : null;
  const exportId = typeof metadata.medusa_price_export_id === "string" ? metadata.medusa_price_export_id.trim() : "";
  const exportedAt = typeof metadata.medusa_price_exported_at === "string"
    ? Date.parse(metadata.medusa_price_exported_at) : NaN;
  const exportedAmount = exactKzt(metadata.medusa_price_export_min);
  const exportedPrice = exportId && Number.isFinite(exportedAt) && exportedAt <= now + 300_000
    && exportedAmount > 0 ? exportedAmount : null;
  const count = Number(metadata.standard_n_pharmacy_count);
  const inStock = fresh && metadata.standard_n_in_stock === true && knownPrice !== null;
  return {
    // Price and stock have different lifetimes. The dated Standard N price is
    // still useful for display while sellability must fail closed when stale.
    price: exportedPrice ?? datedPrice,
    inStock,
    stockPharmacies: inStock && Number.isSafeInteger(count) && count > 0 ? count : 0,
    sourceDate: exportedPrice !== null ? new Date(exportedAt).toISOString().slice(0, 10) : sourceDate || undefined,
    snapshotId: snapshotId || undefined,
    stale: !fresh,
  };
}

/** Last known, dated Standard N price for catalogue display only. */
export function medusaKnownPriceSql(alias = "product"): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("invalid_sql_alias");
  return `coalesce((CASE WHEN coalesce(${alias}.metadata->>'medusa_price_export_id', '') <> ''
    AND ${alias}.metadata->>'medusa_price_exported_at' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$'
    AND (${alias}.metadata->>'medusa_price_exported_at')::timestamptz <= now() + interval '5 minutes'
    AND ${alias}.metadata->>'medusa_price_export_min' ~ '^\\d+(\\.\\d{1,2})?$'
    THEN nullif((${alias}.metadata->>'medusa_price_export_min')::numeric, 0) ELSE NULL END),
    (CASE WHEN coalesce(${alias}.metadata->>'standard_n_snapshot_id', '') <> ''
    AND ${alias}.metadata->>'standard_n_source_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
    AND ${alias}.metadata->>'standard_n_min_price' ~ '^\\d+(\\.\\d{1,2})?$'
    THEN nullif((${alias}.metadata->>'standard_n_min_price')::numeric, 0) ELSE NULL END))`;
}

/** Parameter-free SQL equivalent of the metadata guard; JSON casts are validated first. */
export function medusaStockPriceSql(alias = "product"): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("invalid_sql_alias");
  return `(CASE WHEN ${alias}.metadata->>'standard_n_in_stock' = 'true'
    AND coalesce(${alias}.metadata->>'standard_n_snapshot_id', '') <> ''
    AND ${alias}.metadata->>'standard_n_source_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
    AND (${alias}.metadata->>'standard_n_source_date' || 'T00:00:00Z')::timestamptz >= now() - interval '72 hours'
    AND (${alias}.metadata->>'standard_n_source_date' || 'T00:00:00Z')::timestamptz <= now() + interval '1 day'
    AND (NOT (${alias}.metadata ? 'standard_n_valid_until') OR CASE
      WHEN ${alias}.metadata->>'standard_n_valid_until' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$'
      THEN (${alias}.metadata->>'standard_n_valid_until')::timestamptz > now() ELSE false END)
    AND ${alias}.metadata->>'standard_n_min_price' ~ '^\\d+(\\.\\d{1,2})?$'
    THEN nullif((${alias}.metadata->>'standard_n_min_price')::numeric, 0) ELSE NULL END)`;
}
