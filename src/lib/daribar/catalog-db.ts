import type { Pool } from "pg";
import type { Product } from "../types.ts";
import { ordersDatabasePool } from "../orders/store.ts";

type StateRow = {
  run_id: string;
  generated_at: Date | string;
  city: string;
  source_count: number;
  normalized_count: number;
  checksum: string;
  availability_run_id: string | null;
  availability_generated_at: Date | string | null;
  availability_valid_until: Date | string | null;
};

type ProductRow = {
  product: Product;
  availability_in_stock: boolean | null;
  availability_min_price: string | number | null;
  availability_pharmacy_count: string | number | null;
  availability_checked_at: Date | string | null;
};

export type DaribarDatabaseSnapshot = {
  runId: string;
  generatedAt: string;
  city: string;
  sourceCount: number;
  checksum: string;
  products: Product[];
  availabilityRunId?: string;
  availabilityGeneratedAt?: string;
  availabilityValidUntil?: string;
  availabilityStale: boolean;
};

export type DaribarStoredPharmacyAvailability = {
  sourceCode: string;
  name: string;
  city: string;
  address: string;
  lat?: number;
  lon?: number;
  hours?: string;
  quantity: number;
  price: number;
  paymentOnSite?: boolean;
  paymentByCard?: boolean;
};

export type DaribarStoredAvailability = {
  generatedAt: string;
  validUntil: string;
  stale: boolean;
  pharmacies: DaribarStoredPharmacyAvailability[];
};

export class DaribarCatalogDatabaseError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "DaribarCatalogDatabaseError";
  }
}

const runtime = globalThis as typeof globalThis & {
  __daribarDatabaseSnapshot?: { expiresAt: number; value: DaribarDatabaseSnapshot };
};

function validProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Partial<Product>;
  return product.source === "daribar"
    && typeof product.sku === "string"
    && typeof product.id === "string"
    && typeof product.variantId === "string"
    && typeof product.slug === "string"
    && typeof product.name === "string";
}

export function applyDaribarIndexedAvailability(
  product: Product,
  row: Pick<ProductRow, "availability_in_stock" | "availability_min_price" |
    "availability_pharmacy_count" | "availability_checked_at">,
  validUntil?: string,
  now = Date.now(),
): Product {
  if (typeof row.availability_in_stock !== "boolean" || !row.availability_checked_at || !validUntil) {
    return { ...product, inStock: false, stockPharmacies: 0, stockStale: true };
  }
  const checkedAt = new Date(row.availability_checked_at).toISOString();
  const stale = Date.parse(validUntil) <= now;
  const price = Number(row.availability_min_price);
  const pharmacies = Number(row.availability_pharmacy_count);
  const inStock = row.availability_in_stock === true
    && Number.isFinite(price) && price > 0
    && Number.isSafeInteger(pharmacies) && pharmacies > 0;
  return {
    ...product,
    ...(inStock ? { price, priceTBD: false } : {}),
    inStock,
    stockPharmacies: inStock ? pharmacies : 0,
    stockSourceDate: checkedAt,
    stockValidUntil: validUntil,
    stockStale: stale,
    variants: product.variants?.map((variant) => ({
      ...variant,
      ...(inStock ? { price } : {}),
    })),
  };
}

export async function readDaribarCatalogDatabase(
  database?: Pick<Pool, "query">,
  now = Date.now(),
): Promise<DaribarDatabaseSnapshot> {
  const cached = runtime.__daribarDatabaseSnapshot;
  if (!database && cached && cached.expiresAt > now) {
    return cached.value;
  }
  const db = database || await ordersDatabasePool();
  const state = await db.query<StateRow>(`
    SELECT run.id AS run_id, run.generated_at, run.city, run.source_count,
           run.normalized_count, run.checksum,
           availability.id AS availability_run_id,
           availability.finished_at AS availability_generated_at,
           availability.valid_until AS availability_valid_until
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id
    LEFT JOIN daribar_availability_state availability_state ON availability_state.singleton
    LEFT JOIN daribar_availability_runs availability
      ON availability.id = availability_state.active_run_id
     AND availability.status = 'published'
     AND availability.catalog_run_id = run.id
    WHERE state.singleton AND run.status = 'published'
    LIMIT 1
  `);
  const active = state.rows[0];
  if (!active || active.normalized_count < 1 || active.normalized_count > active.source_count) {
    throw new DaribarCatalogDatabaseError("daribar_catalog_database_unavailable");
  }
  const result = await db.query<ProductRow>(`
    SELECT catalog.product,
           availability.in_stock AS availability_in_stock,
           availability.min_price AS availability_min_price,
           availability.pharmacy_count AS availability_pharmacy_count,
           availability.checked_at AS availability_checked_at
    FROM daribar_catalog_products catalog
    LEFT JOIN daribar_product_availability availability
      ON availability.run_id = $2::uuid AND availability.sku = catalog.sku
    WHERE catalog.run_id = $1
    ORDER BY catalog.sku
  `, [active.run_id, active.availability_run_id]);
  const availabilityValidUntil = active.availability_valid_until
    ? new Date(active.availability_valid_until).toISOString() : undefined;
  const products = result.rows
    .filter((row) => validProduct(row.product))
    .map((row) => applyDaribarIndexedAvailability(row.product, row, availabilityValidUntil, now));
  if (products.length !== active.normalized_count) {
    throw new DaribarCatalogDatabaseError("daribar_catalog_database_incomplete");
  }
  const value = {
    runId: active.run_id,
    generatedAt: new Date(active.generated_at).toISOString(),
    city: active.city,
    sourceCount: active.source_count,
    checksum: active.checksum,
    products,
    ...(active.availability_run_id ? { availabilityRunId: active.availability_run_id } : {}),
    ...(active.availability_generated_at
      ? { availabilityGeneratedAt: new Date(active.availability_generated_at).toISOString() } : {}),
    ...(availabilityValidUntil ? { availabilityValidUntil } : {}),
    availabilityStale: !availabilityValidUntil || Date.parse(availabilityValidUntil) <= now,
  };
  if (!database) runtime.__daribarDatabaseSnapshot = { expiresAt: now + 30_000, value };
  return value;
}

type AvailabilityOfferRow = {
  generated_at: Date | string;
  valid_until: Date | string;
  source_code: string | null;
  pharmacy_id: string | null;
  name: string | null;
  city: string | null;
  address: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  pharmacy_hours: string | null;
  opening_hours: string | null;
  price_amount: string | number | null;
  stock_quantity: string | number | null;
  payment_on_site: boolean | null;
  payment_by_card: boolean | null;
};

export async function readDaribarProductAvailability(
  sku: string,
  city = "",
  database?: Pick<Pool, "query">,
  now = Date.now(),
): Promise<DaribarStoredAvailability> {
  const db = database || await ordersDatabasePool();
  const result = await db.query<AvailabilityOfferRow>(`
    WITH active AS (
      SELECT availability.id, availability.finished_at AS generated_at, availability.valid_until
      FROM daribar_catalog_state catalog_state
      JOIN daribar_catalog_runs catalog_run
        ON catalog_run.id = catalog_state.active_run_id AND catalog_run.status = 'published'
      JOIN daribar_availability_state availability_state ON availability_state.singleton
      JOIN daribar_availability_runs availability
        ON availability.id = availability_state.active_run_id
       AND availability.status = 'published'
       AND availability.catalog_run_id = catalog_run.id
      WHERE catalog_state.singleton
      LIMIT 1
    )
    SELECT active.generated_at, active.valid_until,
           offer.source_code, pharmacy.id AS pharmacy_id,
           pharmacy.name, pharmacy.city, pharmacy.address,
           pharmacy.latitude, pharmacy.longitude,
           pharmacy.metadata->>'hours' AS pharmacy_hours,
           offer.opening_hours, offer.price_amount, offer.stock_quantity,
           offer.payment_on_site, offer.payment_by_card
    FROM active
    LEFT JOIN daribar_pharmacy_offers offer
      ON offer.run_id = active.id AND offer.sku = $1
    LEFT JOIN daribar_pharmacy_mappings mapping
      ON mapping.source_code = offer.source_code AND mapping.enabled
    LEFT JOIN catalog_pharmacies pharmacy
      ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
     AND ($2::text = '' OR lower(coalesce(pharmacy.city, '')) = lower($2))
    ORDER BY offer.price_amount, pharmacy.name, offer.source_code
  `, [sku, city.trim()]);
  const first = result.rows[0];
  if (!first?.generated_at || !first.valid_until) {
    throw new DaribarCatalogDatabaseError("daribar_availability_database_unavailable");
  }
  const validUntil = new Date(first.valid_until).toISOString();
  const pharmacies = result.rows.flatMap((row): DaribarStoredPharmacyAvailability[] => {
    const sourceCode = row.pharmacy_id?.trim() || "";
    const name = row.name?.trim() || "";
    const pharmacyCity = row.city?.trim() || "";
    const address = row.address?.trim() || name;
    const price = Number(row.price_amount);
    const quantity = Number(row.stock_quantity);
    if (!sourceCode || !name || !pharmacyCity || !address
        || !Number.isFinite(price) || price <= 0
        || !Number.isFinite(quantity) || quantity <= 0) return [];
    const lat = row.latitude == null ? undefined : Number(row.latitude);
    const lon = row.longitude == null ? undefined : Number(row.longitude);
    return [{
      sourceCode,
      name,
      city: pharmacyCity,
      address,
      ...(lat !== undefined && Number.isFinite(lat) && Math.abs(lat) <= 90 ? { lat } : {}),
      ...(lon !== undefined && Number.isFinite(lon) && Math.abs(lon) <= 180 ? { lon } : {}),
      ...((row.opening_hours || row.pharmacy_hours)?.trim()
        ? { hours: (row.opening_hours || row.pharmacy_hours)!.trim() } : {}),
      quantity,
      price,
      ...(row.payment_on_site !== null ? { paymentOnSite: row.payment_on_site } : {}),
      ...(row.payment_by_card !== null ? { paymentByCard: row.payment_by_card } : {}),
    }];
  });
  return {
    generatedAt: new Date(first.generated_at).toISOString(),
    validUntil,
    stale: Date.parse(validUntil) <= now,
    pharmacies,
  };
}

export type DaribarSelectedPharmacyAvailability = {
  minPrice: number;
  pharmacyCount: number;
};

/** Read selected local-pharmacy availability from the same published run as the catalogue. */
export async function readDaribarSelectedPharmacyAvailability(
  skus: string[],
  pharmacyIds: string[],
  city = "",
  database?: Pick<Pool, "query">,
): Promise<Map<string, DaribarSelectedPharmacyAvailability>> {
  if (!skus.length || !pharmacyIds.length) return new Map();
  const db = database || await ordersDatabasePool();
  const result = await db.query<{ sku: string; min_price: string | number; pharmacy_count: string | number }>(`
    WITH active AS (
      SELECT availability.id
      FROM daribar_catalog_state catalog_state
      JOIN daribar_catalog_runs catalog_run
        ON catalog_run.id = catalog_state.active_run_id AND catalog_run.status = 'published'
      JOIN daribar_availability_state availability_state ON availability_state.singleton
      JOIN daribar_availability_runs availability
        ON availability.id = availability_state.active_run_id
       AND availability.status = 'published'
       AND availability.catalog_run_id = catalog_run.id
      WHERE catalog_state.singleton AND availability.valid_until > now()
      LIMIT 1
    )
    SELECT offer.sku, min(offer.price_amount) AS min_price,
           count(DISTINCT pharmacy.id)::integer AS pharmacy_count
    FROM active
    JOIN daribar_pharmacy_offers offer ON offer.run_id = active.id
    JOIN daribar_pharmacy_mappings mapping
      ON mapping.source_code = offer.source_code AND mapping.enabled
    JOIN catalog_pharmacies pharmacy
      ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
    WHERE offer.sku = ANY($1::text[])
      AND pharmacy.id = ANY($2::text[])
      AND ($3::text = '' OR lower(coalesce(pharmacy.city, '')) = lower($3))
    GROUP BY offer.sku
  `, [skus, pharmacyIds, city.trim()]);
  return new Map(result.rows.flatMap((row): [string, DaribarSelectedPharmacyAvailability][] => {
    const price = Number(row.min_price);
    const count = Number(row.pharmacy_count);
    return row.sku && Number.isFinite(price) && price > 0 && Number.isSafeInteger(count) && count > 0
      ? [[row.sku, { minPrice: price, pharmacyCount: count }]] : [];
  }));
}

export async function readDaribarCatalogProductPrice(
  sku: string,
  database?: Pick<Pool, "query">,
): Promise<number | null> {
  const db = database || await ordersDatabasePool();
  const result = await db.query<{ price_amount: string | number | null }>(`
    SELECT product.price_amount
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
    JOIN daribar_catalog_products product ON product.run_id = run.id
    WHERE state.singleton AND product.sku = $1
    LIMIT 1
  `, [sku]);
  const value = Number(result.rows[0]?.price_amount);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Prescription status comes from the active, server-owned catalogue, never from cart JSON. */
export async function readDaribarCatalogPrescriptionFlags(
  skus: string[],
  database?: Pick<Pool, "query">,
): Promise<Map<string, boolean>> {
  if (!skus.length) return new Map();
  const db = database || await ordersDatabasePool();
  const result = await db.query<{ sku: string; prescription: boolean }>(`
    SELECT product.sku, product.prescription
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
    JOIN daribar_catalog_products product ON product.run_id = run.id
    WHERE state.singleton AND product.sku = ANY($1::text[])
  `, [skus]);
  return new Map(result.rows.map((row) => [row.sku, row.prescription === true]));
}
