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
};

type ProductRow = { product: Product };

export type DaribarDatabaseSnapshot = {
  runId: string;
  generatedAt: string;
  city: string;
  sourceCount: number;
  checksum: string;
  products: Product[];
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
           run.normalized_count, run.checksum
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id
    WHERE state.singleton AND run.status = 'published'
    LIMIT 1
  `);
  const active = state.rows[0];
  if (!active || active.normalized_count < 1 || active.normalized_count > active.source_count) {
    throw new DaribarCatalogDatabaseError("daribar_catalog_database_unavailable");
  }
  const result = await db.query<ProductRow>(`
    SELECT product
    FROM daribar_catalog_products
    WHERE run_id = $1
    ORDER BY sku
  `, [active.run_id]);
  const products = result.rows.map((row) => row.product).filter(validProduct);
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
  };
  if (!database) runtime.__daribarDatabaseSnapshot = { expiresAt: now + 30_000, value };
  return value;
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
