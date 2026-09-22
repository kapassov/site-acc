import { randomInt, randomUUID } from "node:crypto";
import { exactKzt } from "../money.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { ORDER_STATUSES, type Order } from "../content/defaults.ts";
import { orderCreatedOutboxKey, ordersStorageMode, orderStatusOutboxKey } from "./model.ts";

export { orderCreatedOutboxKey, ordersStorageMode, orderStatusOutboxKey } from "./model.ts";

export type StoredOrder = Order & {
  createdAt: string;
  idempotencyKey: string;
  sourceSystem: "medusa" | "daribar" | "storefront";
  sourceOrderId: string;
  customerId?: string;
  demo?: boolean;
  metadata?: Record<string, unknown>;
  statusVersion: number;
};

type CreateOrderInput = {
  id: string;
  sourceSystem: StoredOrder["sourceSystem"];
  sourceOrderId: string;
  idempotencyKey: string;
  n: number;
  createdAt: string;
  sum: number;
  status: string;
  items: number;
  code?: string;
  delivery: string;
  currencyCode?: string;
  customerId?: string;
  demo?: boolean;
  metadata?: Record<string, unknown>;
};

type SiteOrderRow = {
  id: string;
  source_system: StoredOrder["sourceSystem"];
  source_order_id: string;
  idempotency_key: string;
  display_number: number;
  placed_at: Date | string;
  total_amount: number | string;
  currency_code: string;
  status: string;
  status_version: number;
  item_count: number;
  pickup_code: string | null;
  delivery_method: string;
  customer_id: string | null;
  is_demo: boolean;
  metadata: Record<string, unknown> | null;
};

export type CompletedMedusaOrderLike = {
  id?: unknown;
  display_id?: unknown;
  created_at?: unknown;
  total?: unknown;
  currency_code?: unknown;
  customer_id?: unknown;
  cart_id?: unknown;
  items?: unknown;
};

export type RecordCompletedMedusaOrderInput = {
  order: CompletedMedusaOrderLike;
  delivery: string;
  fallbackTotal?: number;
  fallbackItems: Array<{
    product_id?: string;
    variant_id: string;
    sku?: string;
    quantity: number;
    unit_price?: number;
  }>;
  customerId?: string;
  demo?: boolean;
  metadata?: Record<string, unknown>;
};

export type RecordCompletedStorefrontOrderInput = {
  idempotencyKey: string;
  total: number;
  delivery: string;
  items: Array<{
    product_id?: string;
    variant_id: string;
    quantity: number;
  }>;
  customerId?: string;
  demo?: boolean;
  metadata?: Record<string, unknown>;
};

export type RecordCompletedDaribarOrderInput = {
  providerOrderId: string; providerStatus?: string; total: number; delivery: string;
  items: Array<{ product_id?: string; variant_id: string; sku?: string; quantity: number; unit_price?: number }>;
  customerId?: string; metadata?: Record<string, unknown>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "orders.json");
const MAX_ORDERS = 500;
const MAX_METADATA_BYTES = 256 * 1024;
let fileCache: StoredOrder[] | null = null;
let fileWriteChain: Promise<void> = Promise.resolve();

type Runtime = { poolPromise: Promise<Pool> | null };
const runtimeRoot = globalThis as typeof globalThis & { __inkarOrdersDatabase?: Runtime };
const runtime = runtimeRoot.__inkarOrdersDatabase ??= { poolPromise: null };

function databaseUrl(): string {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

function text(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.round(Number(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeDate(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isFinite(date.valueOf()) ? date.toISOString() : new Date().toISOString();
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("order_metadata_too_large");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function rowToOrder(row: SiteOrderRow): StoredOrder {
  const createdAt = safeDate(row.placed_at);
  return {
    id: row.id,
    n: Number(row.display_number),
    date: new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(createdAt)),
    sum: Number(row.total_amount),
    status: row.status,
    items: Number(row.item_count),
    ...(row.pickup_code ? { code: row.pickup_code } : {}),
    delivery: row.delivery_method,
    createdAt,
    idempotencyKey: row.idempotency_key,
    sourceSystem: row.source_system,
    sourceOrderId: row.source_order_id,
    ...(row.customer_id ? { customerId: row.customer_id } : {}),
    ...(row.is_demo ? { demo: true } : {}),
    ...(row.metadata && Object.keys(row.metadata).length ? { metadata: row.metadata } : {}),
    statusVersion: Number(row.status_version),
  };
}

async function databasePool(): Promise<Pool> {
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error("orders_database_not_configured");
  if (!runtime.poolPromise) {
    runtime.poolPromise = (async () => {
      const parsed = new URL(connectionString);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        throw new Error("orders_database_url_invalid");
      }
      const { Pool: PgPool } = await import("pg");
      const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(connectionString)
        ? { rejectUnauthorized: true }
        : undefined;
      const pool = new PgPool({
        connectionString,
        ssl,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        application_name: "inkar-orders",
      });
      pool.on("error", (error) => console.error("[orders/database] idle client error", error));
      return pool;
    })().catch((error) => {
      runtime.poolPromise = null;
      throw error;
    });
  }
  return runtime.poolPromise;
}

// Payment adapters share the same bounded server-side pool as the order store.
// Keep this as a function (rather than exporting the mutable runtime object) so
// callers cannot replace or reconfigure the singleton.
export async function ordersDatabasePool(): Promise<Pool> {
  return databasePool();
}

async function fileLoad(): Promise<StoredOrder[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    fileCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}

async function filePersist(orders: StoredOrder[]): Promise<void> {
  fileCache = orders;
  fileWriteChain = fileWriteChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(orders, null, 2), "utf8");
  });
  await fileWriteChain;
}

async function fileCreateOrder(input: CreateOrderInput): Promise<StoredOrder> {
  const orders = await fileLoad();
  const existing = orders.find((order) => order.idempotencyKey === input.idempotencyKey
    || (order.sourceSystem === input.sourceSystem && order.sourceOrderId === input.sourceOrderId));
  if (existing) return existing;
  const row: SiteOrderRow = {
    id: input.id,
    source_system: input.sourceSystem,
    source_order_id: input.sourceOrderId,
    idempotency_key: input.idempotencyKey,
    display_number: input.n,
    placed_at: input.createdAt,
    total_amount: input.sum,
    currency_code: input.currencyCode || "kzt",
    status: input.status,
    status_version: 1,
    item_count: input.items,
    pickup_code: input.code || null,
    delivery_method: input.delivery,
    customer_id: input.customerId || null,
    is_demo: input.demo === true,
    metadata: input.metadata || {},
  };
  const order = rowToOrder(row);
  await filePersist([order, ...orders].slice(0, MAX_ORDERS));
  return order;
}

function epharmPayload(row: SiteOrderRow): Record<string, unknown> {
  const metadata = row.metadata || {};
  const canonicalStatuses = ["submitted", "assembling", "in_delivery", "ready", "completed", "cancelled"];
  const statusCode = canonicalStatuses[ORDER_STATUSES.indexOf(row.status)] || "submitted";
  return {
    event_version: 1,
    order_id: row.id,
    order_number: row.display_number,
    idempotency_key: row.idempotency_key,
    created_at: safeDate(row.placed_at),
    channel: text(metadata.channel || "web", 50),
    source_system: row.source_system,
    source_order_id: row.source_order_id,
    display_number: row.display_number,
    placed_at: safeDate(row.placed_at),
    total_amount: Number(row.total_amount),
    currency_code: text(row.currency_code || metadata.currency_code || "kzt", 3).toLowerCase(),
    status: row.status,
    status_code: statusCode,
    status_version: Number(row.status_version),
    item_count: Number(row.item_count),
    pickup_code: row.pickup_code,
    delivery_method: row.delivery_method,
    customer_id: row.customer_id,
    is_demo: row.is_demo,
    pharmacy_external_id: text(metadata.pharmacy_id, 256) || null,
    line_items: Array.isArray(metadata.line_items) ? metadata.line_items : [],
    payment_method: text(metadata.payment, 100) || null,
    payment_status: text(metadata.payment_status || "pending", 100),
    correlation_id: text(metadata.correlation_id || row.idempotency_key, 512),
    metadata,
  };
}

async function insertOutbox(
  client: PoolClient,
  topic: "epharm.order.created" | "epharm.order.status_changed",
  row: SiteOrderRow,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(`
    INSERT INTO integration_outbox (
      id, topic, aggregate_type, aggregate_id, payload, idempotency_key
    ) VALUES ($1, $2, 'site_order', $3, $4::jsonb, $5)
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [randomUUID(), topic, row.id, JSON.stringify(payload), idempotencyKey]);
}

async function postgresCreateOrder(input: CreateOrderInput): Promise<StoredOrder> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<SiteOrderRow>(`
      INSERT INTO site_orders (
        id, source_system, source_order_id, idempotency_key, display_number,
        placed_at, total_amount, currency_code, status, item_count, pickup_code,
        delivery_method, customer_id, is_demo, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      input.id, input.sourceSystem, input.sourceOrderId, input.idempotencyKey,
      input.n, input.createdAt, input.sum, input.currencyCode || "kzt", input.status,
      input.items, input.code || null, input.delivery, input.customerId || null,
      input.demo === true, JSON.stringify(input.metadata || {}),
    ]);

    let row = inserted.rows[0];
    if (!row) {
      const existing = await client.query<SiteOrderRow>(`
        SELECT *
        FROM site_orders
        WHERE id = $1
           OR idempotency_key = $2
           OR (source_system = $3 AND source_order_id = $4)
        FOR UPDATE
      `, [input.id, input.idempotencyKey, input.sourceSystem, input.sourceOrderId]);
      if (existing.rowCount !== 1) throw new Error("order_idempotency_conflict");
      row = existing.rows[0];
      const sameIdempotencyKey = row.idempotency_key === input.idempotencyKey;
      const sameSourceOrder = row.source_system === input.sourceSystem
        && row.source_order_id === input.sourceOrderId;
      if (!sameIdempotencyKey && !sameSourceOrder) throw new Error("order_idempotency_conflict");
    }

    // Daribar owns payment/delivery, while ePharm owns pharmacy assembly and till notifications.
    // The outbox is idempotent, so the same commercial order is published once to each system.
    await insertOutbox(client, "epharm.order.created", row, orderCreatedOutboxKey(row.id), epharmPayload(row));
    await client.query("COMMIT");
    return rowToOrder(row);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[orders/database] create rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function persistOrder(input: CreateOrderInput): Promise<StoredOrder> {
  const normalized: CreateOrderInput = {
    ...input,
    id: text(input.id, 256),
    sourceOrderId: text(input.sourceOrderId, 256),
    idempotencyKey: text(input.idempotencyKey, 512),
    n: safeInteger(input.n),
    createdAt: safeDate(input.createdAt),
    sum: exactKzt(input.sum),
    status: text(input.status, 100),
    items: safeInteger(input.items),
    code: text(input.code, 100) || undefined,
    delivery: text(input.delivery, 100),
    currencyCode: text(input.currencyCode || "kzt", 3).toLowerCase(),
    customerId: text(input.customerId, 256) || undefined,
    metadata: safeMetadata(input.metadata),
  };
  if (!normalized.id || !normalized.sourceOrderId || !normalized.idempotencyKey
      || !normalized.status || !normalized.delivery || normalized.items < 1) {
    throw new Error("invalid_stored_order");
  }
  return ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "postgres"
    ? postgresCreateOrder(normalized)
    : fileCreateOrder(normalized);
}

function medusaLineItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      id: text(item.id, 256),
      product_id: text(item.product_id, 256),
      variant_id: text(item.variant_id, 256),
      title: text(item.product_title || item.title, 500),
      quantity: Math.max(1, safeInteger(item.quantity, 1)),
      unit_price: exactKzt(item.unit_price),
      total: exactKzt(item.total),
    };
  });
}

/**
 * Durable hook for a successfully completed Medusa order. Call this only after
 * `/store/carts/:id/complete` returns `type=order`; it never calls Medusa.
 */
export async function recordCompletedMedusaOrder(input: RecordCompletedMedusaOrderInput): Promise<StoredOrder> {
  const orderId = text(input.order.id, 256);
  if (!orderId) throw new Error("medusa_order_id_missing");
  const lines = medusaLineItems(input.order.items);
  const fallbackLines = input.fallbackItems.slice(0, 200).map((item) => ({
    product_id: text(item.product_id, 256),
    variant_id: text(item.variant_id, 256),
    sku: text(item.sku, 256),
    quantity: Math.max(1, safeInteger(item.quantity, 1)),
    unit_price: exactKzt(item.unit_price),
  }));
  const itemCount = lines.length
    ? lines.reduce((sum, item) => sum + safeInteger(item.quantity), 0)
    : fallbackLines.reduce((sum, item) => sum + safeInteger(item.quantity), 0);
  const metadata = safeMetadata({
    ...(input.metadata || {}),
    currency_code: text(input.order.currency_code || "kzt", 3).toLowerCase(),
    medusa_cart_id: text(input.order.cart_id, 256) || undefined,
    line_items: lines.length ? lines : fallbackLines,
  });
  return persistOrder({
    id: orderId,
    sourceSystem: "medusa",
    sourceOrderId: orderId,
    idempotencyKey: `medusa:${orderId}`,
    n: safeInteger(input.order.display_id),
    createdAt: safeDate(input.order.created_at),
    sum: exactKzt(input.order.total, exactKzt(input.fallbackTotal)),
    status: ORDER_STATUSES[0],
    items: itemCount,
    code: text(input.order.display_id, 100),
    delivery: input.delivery,
    currencyCode: text(input.order.currency_code || "kzt", 3).toLowerCase(),
    customerId: text(input.customerId || input.order.customer_id, 256) || undefined,
    demo: input.demo === true,
    metadata,
  });
}

/**
 * Persists a site-native checkout which deliberately did not create a Medusa
 * cart/order (currently the signed demo flow). The caller must supply a total
 * obtained from the server-side quote service; this function never accepts a
 * client subtotal.
 */
export async function recordCompletedStorefrontOrder(
  input: RecordCompletedStorefrontOrderInput,
): Promise<StoredOrder> {
  const id = randomUUID();
  const lines = input.items.slice(0, 200).map((item) => ({
    product_id: text(item.product_id, 256),
    variant_id: text(item.variant_id, 256),
    quantity: Math.max(1, safeInteger(item.quantity, 1)),
  }));
  const itemCount = lines.reduce((sum, item) => sum + item.quantity, 0);
  const metadata = safeMetadata({
    ...(input.metadata || {}),
    currency_code: "kzt",
    line_items: lines,
  });
  return persistOrder({
    id,
    sourceSystem: "storefront",
    sourceOrderId: id,
    idempotencyKey: input.idempotencyKey,
    n: randomInt(100000, 1000000),
    createdAt: new Date().toISOString(),
    sum: safeInteger(input.total),
    status: ORDER_STATUSES[0],
    items: itemCount,
    ...(input.delivery === "pickup" ? { code: String(randomInt(1000, 10000)) } : {}),
    delivery: input.delivery,
    currencyCode: "kzt",
    customerId: text(input.customerId, 256) || undefined,
    demo: input.demo === true,
    metadata,
  });
}

/** Local read mirror; Daribar remains the commercial owner of this order. */
export async function recordCompletedDaribarOrder(input: RecordCompletedDaribarOrderInput): Promise<StoredOrder> {
  const providerOrderId = text(input.providerOrderId, 256);
  if (!providerOrderId) throw new Error("daribar_order_id_missing");
  const lines = input.items.slice(0, 200).map(item => ({
    product_id: text(item.product_id, 256), variant_id: text(item.variant_id, 256),
    sku: text(item.sku, 256), quantity: Math.max(1, safeInteger(item.quantity, 1)),
    unit_price: exactKzt(item.unit_price),
  }));
  const itemCount = lines.reduce((sum, item) => sum + item.quantity, 0);
  const metadata = safeMetadata({
    ...(input.metadata || {}), provider: "daribar", provider_order_id: providerOrderId,
    provider_status: text(input.providerStatus || "new", 100), currency_code: "kzt", line_items: lines,
  });
  return persistOrder({
    id: randomUUID(), sourceSystem: "daribar", sourceOrderId: providerOrderId,
    idempotencyKey: `daribar:${providerOrderId}`, n: randomInt(100000, 1000000),
    createdAt: new Date().toISOString(), sum: exactKzt(input.total), status: ORDER_STATUSES[0],
    items: itemCount, code: String(randomInt(100000, 1000000)), delivery: input.delivery,
    currencyCode: "kzt", customerId: text(input.customerId, 256) || undefined, metadata,
  });
}

/** Merge operational provider metadata without rewriting commercial fields. */
export async function updateStoredOrderMetadata(
  id: string,
  patch: Record<string, unknown>,
): Promise<StoredOrder | null> {
  const orderId = text(id, 256);
  const normalizedPatch = safeMetadata(patch);
  if (!orderId || Object.keys(normalizedPatch).length === 0) return null;
  if (ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "postgres") {
    const db = await databasePool();
    const result = await db.query<SiteOrderRow>(`
      UPDATE site_orders
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
          updated_at = clock_timestamp()
      WHERE id = $1
      RETURNING *
    `, [orderId, JSON.stringify(normalizedPatch)]);
    return result.rows[0] ? rowToOrder(result.rows[0]) : null;
  }
  const orders = await fileLoad();
  const index = orders.findIndex(order => order.id === orderId);
  if (index < 0) return null;
  const next = [...orders];
  next[index] = {
    ...next[index],
    metadata: safeMetadata({ ...(next[index].metadata || {}), ...normalizedPatch }),
  };
  await filePersist(next);
  return next[index];
}

export async function listOrders(): Promise<StoredOrder[]> {
  if (ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "file") {
    return [...(await fileLoad())];
  }
  const db = await databasePool();
  const result = await db.query<SiteOrderRow>(`
    SELECT *
    FROM site_orders
    ORDER BY placed_at DESC, id DESC
    LIMIT $1
  `, [MAX_ORDERS]);
  return result.rows.map(rowToOrder);
}
export async function listCustomerOrders(
  customerId: string,
  limit = 100,
): Promise<StoredOrder[]> {
  const normalizedCustomerId = text(customerId, 256);
  if (!normalizedCustomerId) return [];
  const safeLimit = Math.max(1, Math.min(100, safeInteger(limit, 100)));
  if (ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "file") {
    return (await fileLoad())
      .filter((order) => order.customerId === normalizedCustomerId)
      .slice(0, safeLimit);
  }
  const db = await databasePool();
  const result = await db.query<SiteOrderRow>(`
    SELECT *
    FROM site_orders
    WHERE customer_id = $1
    ORDER BY placed_at DESC, id DESC
    LIMIT $2
  `, [normalizedCustomerId, safeLimit]);
  return result.rows.map(rowToOrder);
}

/** Resolve one order while enforcing customer ownership on the server. */
export async function getCustomerOrder(
  customerId: string,
  orderId: string,
): Promise<StoredOrder | null> {
  const normalizedCustomerId = text(customerId, 256);
  const normalizedOrderId = text(orderId, 256);
  if (!normalizedCustomerId || !normalizedOrderId) return null;
  if (ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "file") {
    return (await fileLoad()).find((order) => order.customerId === normalizedCustomerId
      && (order.id === normalizedOrderId
        || order.sourceOrderId === normalizedOrderId
        || `INK-${order.n}` === normalizedOrderId)) || null;
  }
  const db = await databasePool();
  const result = await db.query<SiteOrderRow>(`
    SELECT *
    FROM site_orders
    WHERE customer_id = $1
      AND (id = $2 OR source_order_id = $2 OR ('INK-' || display_number::text) = $2)
    LIMIT 1
  `, [normalizedCustomerId, normalizedOrderId]);
  return result.rows[0] ? rowToOrder(result.rows[0]) : null;
}

/** Legacy isolated order endpoint; normal checkout persists a completed Medusa order instead. */
export async function createOrder(input: {
  sum: number;
  items: number;
  delivery: string;
  idempotencyKey: string;
}): Promise<StoredOrder> {
  const id = randomUUID();
  return persistOrder({
    id,
    sourceSystem: "storefront",
    sourceOrderId: id,
    idempotencyKey: input.idempotencyKey,
    n: randomInt(100000, 1000000),
    createdAt: new Date().toISOString(),
    sum: input.sum,
    status: input.delivery === "pickup" ? ORDER_STATUSES[3] : ORDER_STATUSES[1],
    items: input.items,
    code: String(randomInt(1000, 10000)),
    delivery: input.delivery,
  });
}

async function postgresUpdateOrderStatus(id: string, status: string): Promise<StoredOrder | null> {
  const db = await databasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<SiteOrderRow>(
      "SELECT * FROM site_orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!current.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    if (current.rows[0].status === status) {
      await client.query("COMMIT");
      return rowToOrder(current.rows[0]);
    }
    const updated = await client.query<SiteOrderRow>(`
      UPDATE site_orders
      SET status = $2,
          status_version = status_version + 1,
          updated_at = clock_timestamp()
      WHERE id = $1
      RETURNING *
    `, [id, status]);
    const row = updated.rows[0];
    await insertOutbox(
      client,
      "epharm.order.status_changed",
      row,
      orderStatusOutboxKey(row.id, row.status_version),
      {
        ...epharmPayload(row),
        previous_status: current.rows[0].status,
        changed_at: new Date().toISOString(),
      },
    );
    await client.query("COMMIT");
    return rowToOrder(row);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[orders/database] status rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function fileUpdateOrderStatus(id: string, status: string): Promise<StoredOrder | null> {
  const orders = await fileLoad();
  const index = orders.findIndex((order) => order.id === id);
  if (index < 0) return null;
  if (orders[index].status === status) return orders[index];
  const next = [...orders];
  next[index] = {
    ...next[index],
    status,
    statusVersion: safeInteger(next[index].statusVersion, 1) + 1,
  };
  await filePersist(next);
  return next[index];
}

export async function updateOrderStatus(id: string, status: string): Promise<StoredOrder | null> {
  const orderId = text(id, 256);
  const nextStatus = text(status, 100);
  if (!orderId || !nextStatus) return null;
  return ordersStorageMode(process.env.DATABASE_URL, process.env.POSTGRES_URL) === "postgres"
    ? postgresUpdateOrderStatus(orderId, nextStatus)
    : fileUpdateOrderStatus(orderId, nextStatus);
}
