import type { Product, ProductArtKind } from "@/lib/types";
import { medusaMediaUrl } from "@/lib/media-url";
import { canonicalProductSlug, normalizeProductIdentity } from "@/lib/product-normalization";
import { guardMedusaProductStock, medusaStockMetadata } from "@/lib/medusa-stock";
import { exactKzt } from "./money.ts";
import { medusaPrescription } from "./prescription.ts";

type CategoryItem = { id?: unknown; handle?: unknown; name?: unknown; is_primary?: unknown };
type ImageItem = { id?: unknown; url?: unknown; position?: unknown };
type VariantItem = {
  id?: unknown;
  title?: unknown;
  sku?: unknown;
  barcode?: unknown;
  price?: unknown;
  original_price?: unknown;
  currency_code?: unknown;
};
type CatalogRow = {
  id: string;
  handle: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  thumbnail_url: string | null;
  brand: string | null;
  manufacturer: string | null;
  country: string | null;
  mnn: string | null;
  atc: string | null;
  rx_otc: string | null;
  metadata: Record<string, unknown> | null;
  source_seen_at: Date | string | null;
  updated_at: Date | string | null;
  min_price: string | number | null;
  max_price: string | number | null;
  currency_code: string | null;
  categories: CategoryItem[] | null;
  images: ImageItem[] | null;
  variants: VariantItem[] | null;
};

type CatalogImportRunRow = {
  status: string;
  expected_products: unknown;
  processed_products: unknown;
  metrics: Record<string, unknown> | null;
};

type CatalogCountRow = { active_count: unknown };

export type LocalCatalogSnapshot = {
  products: Product[];
  sourceCount: number;
  loadedCount: number;
  complete: boolean;
  stale: boolean;
  generatedAt: string;
};

type SnapshotEntry = LocalCatalogSnapshot & { freshUntil: number; verified: true };
type Runtime = { entry: SnapshotEntry | null; inflight: Promise<SnapshotEntry> | null };
type CatalogPool = import("pg").Pool;

export type LocalPharmacyPrice = {
  id: string;
  name: string;
  city: string;
  price: number;
  address?: string;
};

export type LocalPharmacyPriceInfo = {
  min: number | null;
  max: number | null;
  count: number;
  pharmacies: LocalPharmacyPrice[];
};

type PharmacyOfferRow = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  price_amount: string | number;
};

const runtimeRoot = globalThis as typeof globalThis & {
  __inkarLocalCatalog?: Runtime;
  __inkarCatalogPoolPromise?: Promise<CatalogPool>;
  __inkarPharmacyPriceWrites?: Map<string, Promise<void>>;
};
const runtime = runtimeRoot.__inkarLocalCatalog ??= { entry: null, inflight: null };
const pharmacyPriceWrites = runtimeRoot.__inkarPharmacyPriceWrites ??= new Map<string, Promise<void>>();

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function positivePrice(value: unknown): number | null {
  const amount = exactKzt(value);
  return amount > 0 ? amount : null;
}

function placeholderArt(title: string): { kind: ProductArtKind; hue: number } {
  const kinds: ProductArtKind[] = ["bottle", "tube", "jar", "box", "dropper", "spray"];
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return { kind: kinds[hash % kinds.length], hue: hash % 360 };
}

function productVolume(title: string): string | undefined {
  return title.match(/\b\d+(?:[.,]\d+)?\s*(?:мл|мг|г|шт|капс\.?|таб\.?)\b/i)?.[0];
}

function rowsToProducts(rows: CatalogRow[]): Product[] {
  return rows.map((row) => {
    const categories = Array.isArray(row.categories) ? row.categories : [];
    const primary = categories.find((category) => category.is_primary === true) || categories[0];
    const categoryHandles = categories.map((category) => optionalText(category.handle)).filter(Boolean) as string[];
    const rawImages = (Array.isArray(row.images) ? row.images : [])
      .map((image) => medusaMediaUrl(image.url))
      .filter(Boolean) as string[];
    const imageUrls = [...new Set([medusaMediaUrl(row.thumbnail_url), ...rawImages].filter(Boolean) as string[])];
    const variants = (Array.isArray(row.variants) ? row.variants : [])
      .map((variant) => {
        const id = optionalText(variant.id);
        if (!id) return null;
        const price = positivePrice(variant.price);
        return {
          id,
          title: optionalText(variant.title) || row.title,
          sku: optionalText(variant.sku),
          barcode: optionalText(variant.barcode),
          price: price ?? undefined,
          originalPrice: positivePrice(variant.original_price),
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        title: string;
        sku?: string;
        barcode?: string;
        price?: number;
        originalPrice?: number | null;
      }>;
    const stock = medusaStockMetadata(row.metadata);
    const price = stock.price;
    const pricedVariant = variants.find((variant) => variant.price === price);
    const oldPrice = pricedVariant?.originalPrice && price && pricedVariant.originalPrice > price
      ? pricedVariant.originalPrice
      : undefined;
    const prescription = medusaPrescription(row.rx_otc);
    const rx = prescription === true;
    const firstVariant = variants[0];
    const identity = normalizeProductIdentity({
      name: row.title,
      brand: optionalText(row.brand),
      barcode: firstVariant?.barcode,
      slug: row.handle,
    });
    return {
      id: row.id,
      source: "medusa",
      sku: firstVariant?.sku,
      wareId: optionalText(row.metadata?.ware_id),
      stockSourceDate: stock.sourceDate,
      stockValidUntil: optionalText(row.metadata?.standard_n_valid_until),
      stockStale: stock.stale,
      slug: canonicalProductSlug(identity.name, row.handle),
      name: identity.name,
      brand: identity.brand || "—",
      categorySlug: optionalText(primary?.handle) || "",
      categoryHandles,
      price: price ?? 0,
      oldPrice,
      priceTBD: price === null,
      rating: 0,
      reviews: 0,
      volume: productVolume(identity.name),
      badges: rx ? ["rx"] : [],
      art: placeholderArt(identity.name),
      image: imageUrls[0],
      images: imageUrls.length ? imageUrls : undefined,
      description: optionalText(row.description),
      inStock: stock.inStock,
      stockPharmacies: stock.stockPharmacies,
      prescription,
      manufacturer: optionalText(row.manufacturer),
      country: optionalText(row.country),
      mnn: optionalText(row.mnn),
      atc: optionalText(row.atc),
      barcode: firstVariant?.barcode,
      variantId: firstVariant?.id,
      variants: variants.length
        ? variants.map((variant) => ({
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            barcode: variant.barcode,
            price: variant.price,
          }))
        : undefined,
    };
  });
}

async function createDatabasePool(connectionString: string): Promise<CatalogPool> {
  const { Pool } = await import("pg");
  const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(connectionString)
    ? { rejectUnauthorized: true }
    : undefined;
  const pool = new Pool({
    connectionString,
    ssl,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
    application_name: "inkar-catalog-read",
  });
  pool.on("error", (error) => {
    console.error("Unexpected error from an idle catalog database client", error);
  });
  return pool;
}

function databasePool(): Promise<CatalogPool> {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!connectionString) return Promise.reject(new Error("catalog_database_not_configured"));
  if (runtimeRoot.__inkarCatalogPoolPromise) return runtimeRoot.__inkarCatalogPoolPromise;

  const poolPromise = createDatabasePool(connectionString);
  runtimeRoot.__inkarCatalogPoolPromise = poolPromise;
  void poolPromise.catch(() => {
    if (runtimeRoot.__inkarCatalogPoolPromise === poolPromise) {
      delete runtimeRoot.__inkarCatalogPoolPromise;
    }
  });
  return poolPromise;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function verifiedExpectedCount(run: CatalogImportRunRow | undefined): number | null {
  if (!run || run.status !== "completed") return null;
  const expected = nonnegativeInteger(run.expected_products);
  const processed = nonnegativeInteger(run.processed_products);
  const metrics = run.metrics;
  if (expected === null
      || processed !== expected
      || !metrics
      || Array.isArray(metrics)
      || metrics.complete !== true
      || metrics.start_offset !== 0
      || metrics.started_offset !== 0
      || metrics.limit !== null) {
    return null;
  }
  return expected;
}

async function refresh(): Promise<SnapshotEntry> {
  const db = await databasePool();
  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;

    const runResult = await client.query<CatalogImportRunRow>(`
      SELECT status, expected_products, processed_products, metrics
      FROM catalog_import_runs
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `);
    const expectedCount = verifiedExpectedCount(runResult.rows[0]);
    if (expectedCount === null) throw new Error("catalog_snapshot_incomplete");

    const countResult = await client.query<CatalogCountRow>(`
      SELECT count(*)::integer AS active_count
      FROM catalog_product_read_model
      WHERE active
    `);
    if (nonnegativeInteger(countResult.rows[0]?.active_count) !== expectedCount) {
      throw new Error("catalog_snapshot_incomplete");
    }

    const result = await client.query<CatalogRow>(`
      SELECT id, handle, title, subtitle, description, thumbnail_url, brand,
             manufacturer, country, mnn, atc, rx_otc, metadata, source_seen_at,
             updated_at, min_price, max_price, currency_code, categories, images, variants
      FROM catalog_product_read_model
      WHERE active
      ORDER BY id
    `);
    if (result.rows.length !== expectedCount) throw new Error("catalog_snapshot_incomplete");

    const products = rowsToProducts(result.rows);
    const generatedAt = result.rows.reduce((latest, row) => {
      const timestamp = new Date(row.source_seen_at || row.updated_at || 0).valueOf();
      return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
    }, 0);
    const entry: SnapshotEntry = {
      products,
      sourceCount: products.length,
      loadedCount: products.length,
      complete: true,
      stale: false,
      generatedAt: generatedAt > 0 ? new Date(generatedAt).toISOString() : new Date().toISOString(),
      freshUntil: Date.now() + 5 * 60_000,
      verified: true,
    };

    await client.query("COMMIT");
    transactionOpen = false;
    runtime.entry = entry;
    return entry;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back catalog snapshot transaction", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function publicSnapshot(entry: SnapshotEntry, stale: boolean): LocalCatalogSnapshot {
  return {
    products: entry.products.map((product) => guardMedusaProductStock(product)),
    sourceCount: entry.sourceCount,
    loadedCount: entry.loadedCount,
    complete: entry.complete,
    stale,
    generatedAt: entry.generatedAt,
  };
}

export async function getLocalCatalogSnapshot(): Promise<LocalCatalogSnapshot> {
  const now = Date.now();
  if (runtime.entry?.verified && runtime.entry.freshUntil > now) return publicSnapshot(runtime.entry, false);
  if (!runtime.inflight) {
    runtime.inflight = refresh().finally(() => { runtime.inflight = null; });
  }
  try {
    return publicSnapshot(await runtime.inflight, false);
  } catch (error) {
    if (runtime.entry?.verified) return publicSnapshot(runtime.entry, true);
    throw error;
  }
}

type PharmacyPriceCacheState = { databaseUnavailableUntil: number };
const pharmacyPriceCacheRoot = globalThis as typeof globalThis & {
  __inkarPharmacyPriceCacheState?: PharmacyPriceCacheState;
};
const pharmacyPriceCacheState = pharmacyPriceCacheRoot.__inkarPharmacyPriceCacheState ??= {
  databaseUnavailableUntil: 0,
};

const PRODUCT_ID_PATTERN = /^prod_[A-Za-z0-9]+$/;
const MAX_CACHED_PHARMACIES = 2_000;

function boundedMilliseconds(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function pharmacyPriceCacheEnabled(): boolean {
  return process.env.CATALOG_READ_SOURCE?.trim().toLowerCase() === "postgres"
    && Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function validProductId(productId: string): boolean {
  return productId.length <= 128 && PRODUCT_ID_PATTERN.test(productId);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizedPharmacyPrices(prices: LocalPharmacyPrice[]): LocalPharmacyPrice[] {
  const unique = new Map<string, LocalPharmacyPrice>();
  for (const item of prices.slice(0, MAX_CACHED_PHARMACIES)) {
    const id = boundedText(item?.id, 256);
    const roundedPrice = Math.round(Number(item?.price));
    if (!id || !Number.isSafeInteger(roundedPrice) || roundedPrice <= 0) continue;
    const candidate: LocalPharmacyPrice = {
      id,
      name: boundedText(item?.name, 512) || id,
      city: boundedText(item?.city, 256),
      price: roundedPrice,
      ...(boundedText(item?.address, 1_024) ? { address: boundedText(item.address, 1_024) } : {}),
    };
    const existing = unique.get(id);
    if (!existing || candidate.price < existing.price) unique.set(id, candidate);
  }
  return [...unique.values()].sort((left, right) => left.price - right.price || left.name.localeCompare(right.name));
}

async function withPriceReadDeadline<T>(work: Promise<T>): Promise<T> {
  const timeoutMs = boundedMilliseconds(process.env.CATALOG_PRICE_DB_TIMEOUT_MS, 500, 100, 2_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("catalog_price_database_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Reads the per-pharmacy price cache only when the local catalogue read path is
 * explicitly enabled. Database outages fail open to Medusa after a short
 * deadline and enter a cooldown so visible product cards do not queue behind a
 * broken local connection.
 */
export async function getCachedPharmacyPrices(
  productId: string,
  options: { allowStale?: boolean } = {},
): Promise<LocalPharmacyPriceInfo | null> {
  if (!pharmacyPriceCacheEnabled() || !validProductId(productId)) return null;
  if (pharmacyPriceCacheState.databaseUnavailableUntil > Date.now()) return null;

  const maxAgeMs = options.allowStale
    ? boundedMilliseconds(process.env.CATALOG_PRICE_CACHE_STALE_MS, 24 * 60 * 60_000, 60_000, 7 * 24 * 60 * 60_000)
    : boundedMilliseconds(process.env.CATALOG_PRICE_CACHE_FRESH_MS, 2 * 60_000, 15_000, 60 * 60_000);
  try {
    const db = await databasePool();
    const result = await withPriceReadDeadline(db.query<PharmacyOfferRow>(`
      SELECT pharmacy.id,
             pharmacy.name,
             pharmacy.city,
             pharmacy.address,
             offer.price_amount
      FROM catalog_pharmacy_offers offer
      JOIN catalog_pharmacies pharmacy ON pharmacy.id = offer.pharmacy_id
      WHERE offer.product_id = $1
        AND offer.in_stock
        AND offer.price_amount > 0
        AND offer.updated_at >= $2
        AND pharmacy.active
      ORDER BY offer.price_amount, pharmacy.name, pharmacy.id
      LIMIT $3
    `, [productId, new Date(Date.now() - maxAgeMs), MAX_CACHED_PHARMACIES]));
    pharmacyPriceCacheState.databaseUnavailableUntil = 0;
    const pharmacies = normalizedPharmacyPrices(result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city || "",
      price: Number(row.price_amount),
      ...(row.address ? { address: row.address } : {}),
    })));
    if (pharmacies.length === 0) return null;
    return {
      min: pharmacies[0].price,
      max: pharmacies[pharmacies.length - 1].price,
      count: pharmacies.length,
      pharmacies,
    };
  } catch {
    const cooldownMs = boundedMilliseconds(process.env.CATALOG_PRICE_DB_COOLDOWN_MS, 15_000, 1_000, 5 * 60_000);
    pharmacyPriceCacheState.databaseUnavailableUntil = Date.now() + cooldownMs;
    return null;
  }
}

const PHARMACY_WRITE_TRANSACTION_ATTEMPTS = 5;
const RETRYABLE_PHARMACY_WRITE_CODES = new Set(["40P01", "40001"]);

function retryablePharmacyWrite(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RETRYABLE_PHARMACY_WRITE_CODES.has(code);
}

function pharmacyWriteRetryDelay(attempt: number): Promise<void> {
  const delay = Math.min(2_000, 100 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 100);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function persistPharmacyPrices(productId: string, prices: LocalPharmacyPrice[]): Promise<void> {
  const db = await databasePool();
  const client = await db.connect();
  const orderedPrices = [...prices].sort((left, right) => left.id.localeCompare(right.id));
  const payload = JSON.stringify(orderedPrices);
  try {
    for (let attempt = 1; attempt <= PHARMACY_WRITE_TRANSACTION_ATTEMPTS; attempt += 1) {
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        // Serialize writers for one product before taking shared pharmacy or
        // offer locks. The backfill worker uses this exact lock order.
        const product = await client.query<{ id: string }>(
          "SELECT id FROM catalog_products WHERE id = $1 AND active FOR NO KEY UPDATE",
          [productId],
        );
        if (product.rowCount !== 1) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return;
        }

        if (orderedPrices.length > 0) {
          await client.query(`
            WITH incoming AS (
              SELECT id, name, nullif(city, '') AS city, nullif(address, '') AS address
              FROM jsonb_to_recordset($1::jsonb)
                AS item(id text, name text, city text, address text, price bigint)
            )
            INSERT INTO catalog_pharmacies (id, name, city, address, active, updated_at)
            SELECT id, name, city, address, true, clock_timestamp()
            FROM incoming
            ORDER BY id
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              city = coalesce(EXCLUDED.city, catalog_pharmacies.city),
              address = coalesce(EXCLUDED.address, catalog_pharmacies.address),
              active = true,
              updated_at = clock_timestamp()
          `, [payload]);
        }

        // A successful upstream response is a full product/pharmacy snapshot.
        // Offers omitted by Medusa are retained for auditability but no longer
        // considered in stock. This happens after pharmacy locks in every writer.
        await client.query(`
          UPDATE catalog_pharmacy_offers
          SET in_stock = false, updated_at = clock_timestamp()
          WHERE product_id = $1 AND in_stock
        `, [productId]);

        if (orderedPrices.length > 0) {
          await client.query(`
            WITH incoming AS (
              SELECT id, price
              FROM jsonb_to_recordset($2::jsonb)
                AS item(id text, name text, city text, address text, price bigint)
            )
            INSERT INTO catalog_pharmacy_offers (
              product_id, pharmacy_id, price_amount, currency_code,
              in_stock, source_updated_at, updated_at
            )
            SELECT $1, id, price, 'kzt', true, clock_timestamp(), clock_timestamp()
            FROM incoming
            ORDER BY id
            ON CONFLICT (product_id, pharmacy_id) DO UPDATE SET
              price_amount = EXCLUDED.price_amount,
              currency_code = EXCLUDED.currency_code,
              in_stock = true,
              source_updated_at = EXCLUDED.source_updated_at,
              updated_at = EXCLUDED.updated_at
          `, [productId, payload]);
        }

        await client.query("COMMIT");
        transactionOpen = false;
        pharmacyPriceCacheState.databaseUnavailableUntil = 0;
        return;
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Best-effort cache writes never replace or delay the Medusa response.
          }
        }
        if (!retryablePharmacyWrite(error) || attempt >= PHARMACY_WRITE_TRANSACTION_ATTEMPTS) throw error;
        await pharmacyWriteRetryDelay(attempt);
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Coalesced best-effort write used after a valid Medusa response. Callers can
 * intentionally detach this promise so database latency never blocks the UI.
 */
export function cachePharmacyPrices(
  productId: string,
  prices: LocalPharmacyPrice[],
): Promise<void> {
  if (!pharmacyPriceCacheEnabled() || !validProductId(productId)) return Promise.resolve();
  const normalized = normalizedPharmacyPrices(prices);
  // An empty public response has no snapshot/version marker and may be
  // transient. Never let it deactivate a last-known-good offer snapshot.
  if (normalized.length === 0) return Promise.resolve();
  const existing = pharmacyPriceWrites.get(productId);
  if (existing) return existing;
  const task = persistPharmacyPrices(productId, normalized)
    .catch((error) => {
      const cooldownMs = boundedMilliseconds(process.env.CATALOG_PRICE_DB_COOLDOWN_MS, 15_000, 1_000, 5 * 60_000);
      pharmacyPriceCacheState.databaseUnavailableUntil = Date.now() + cooldownMs;
      throw error;
    })
    .finally(() => {
      if (pharmacyPriceWrites.get(productId) === task) pharmacyPriceWrites.delete(productId);
    });
  pharmacyPriceWrites.set(productId, task);
  return task;
}
