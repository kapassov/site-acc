import { DaribarHttpError, daribarJson } from "./client.ts";

export const DARIBAR_ORDER_STATUSES = [
  "created", "new", "placed", "accepted", "assembling", "ready", "planned",
  "looking_for_courier", "in_the_way", "canceled", "completed", "delivered", "unknown",
] as const;

export type DaribarOrderStatus = typeof DARIBAR_ORDER_STATUSES[number];
export type DaribarOrderItem = {
  sku: string; name: string; quantity: number; unitPrice?: number; total?: number;
};
export type DaribarOrderSnapshot = {
  id: string; status: DaribarOrderStatus; rawStatus: string;
  paid: boolean | null; paymentStatus: string; pharmacyStatus: string;
  claimStatus: string; deliveryStatus: string; trackingUrl?: string;
  deliveryPrice?: number; createdAt?: string;
  source?: { code?: string; name?: string; address?: string };
  items: DaribarOrderItem[];
};

const STATUS_SET = new Set<string>(DARIBAR_ORDER_STATUSES);

function text(value: unknown, max = 256): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function statusValue(value: unknown): string {
  const object = record(value);
  return text(object?.status ?? value, 100);
}
function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeDaribarOrderStatus(value: unknown): DaribarOrderStatus {
  const normalized = statusValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "cancelled") return "canceled";
  if (normalized === "done" || normalized === "success") return "completed";
  if (normalized === "processing") return "accepted";
  return STATUS_SET.has(normalized) ? normalized as DaribarOrderStatus : "unknown";
}

function orderRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const value = record(payload);
  if (!value) return [];
  for (const key of ["orders", "items", "data", "result"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    const rows = orderRows(nested);
    if (rows.length) return rows;
  }
  return [];
}

function parsedItems(value: unknown): DaribarOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry) => {
    const item = record(entry);
    if (!item) return [];
    const sku = text(item.sku ?? item.ware_id, 160);
    const name = text(item.name ?? item.title, 500);
    const quantityValue = Number(item.quantity ?? item.count_desired ?? 0);
    const quantity = Number.isSafeInteger(quantityValue) && quantityValue > 0 ? quantityValue : 0;
    if ((!sku && !name) || !quantity) return [];
    const unitPrice = safeNumber(item.unit_price ?? item.partner_price ?? item.base_price);
    const total = safeNumber(item.total_price);
    return [{ sku, name, quantity, ...(unitPrice !== undefined ? { unitPrice } : {}), ...(total !== undefined ? { total } : {}) }];
  });
}

function normalizedPaymentStatus(order: Record<string, unknown>): string {
  return text(order.payment_status ?? record(order.delivery)?.payment_status, 100).toLowerCase();
}
function paidState(order: Record<string, unknown>, paymentStatus: string): boolean | null {
  if (typeof order.paid === "boolean") return order.paid;
  if (["paid", "successful", "success", "completed"].includes(paymentStatus)) return true;
  if (["failed", "cancelled", "canceled", "refunded", "declined"].includes(paymentStatus)) return false;
  return null;
}

function parseSnapshot(value: unknown): DaribarOrderSnapshot | null {
  const wrapper = record(value);
  if (!wrapper) return null;
  const order = record(wrapper.order) || wrapper;
  const sourceRecord = record(wrapper.source);
  const id = text(order.id ?? order.order_id ?? order.orderId ?? order.order_number, 256);
  if (!id) return null;
  const rawStatus = statusValue(order.status ?? order.order_status ?? order.orderStatus);
  const paymentStatus = normalizedPaymentStatus(order);
  const delivery = record(order.delivery);
  const claimStatus = text(order.claim_status ?? delivery?.claim_status, 100).toLowerCase();
  const deliveryStatus = text(delivery?.status ?? delivery?.state ?? claimStatus, 100).toLowerCase();
  const trackingUrl = text(order.tracking_link ?? delivery?.tracking_link ?? delivery?.tracking_url, 2_048);
  const deliveryPrice = safeNumber(order.delivery_price ?? delivery?.price ?? delivery?.claim_price);
  const source = sourceRecord ? {
    ...(text(sourceRecord.code, 128) ? { code: text(sourceRecord.code, 128) } : {}),
    ...(text(sourceRecord.name, 300) ? { name: text(sourceRecord.name, 300) } : {}),
    ...(text(sourceRecord.address, 500) ? { address: text(sourceRecord.address, 500) } : {}),
  } : undefined;
  return {
    id, status: normalizeDaribarOrderStatus(rawStatus), rawStatus,
    paid: paidState(order, paymentStatus), paymentStatus,
    pharmacyStatus: statusValue(order.pharmacy_status).toLowerCase(),
    claimStatus, deliveryStatus,
    ...(trackingUrl ? { trackingUrl } : {}),
    ...(deliveryPrice !== undefined ? { deliveryPrice } : {}),
    ...(text(order.created_at, 100) ? { createdAt: text(order.created_at, 100) } : {}),
    ...(source && Object.keys(source).length ? { source } : {}),
    items: parsedItems(order.items),
  };
}

export function parseDaribarOrderFeed(payload: unknown): Map<string, DaribarOrderSnapshot> {
  const result = new Map<string, DaribarOrderSnapshot>();
  for (const value of orderRows(payload)) {
    const snapshot = parseSnapshot(value);
    if (snapshot) result.set(snapshot.id, snapshot);
  }
  return result;
}

export function parseDaribarOrderStatuses(payload: unknown): Map<string, DaribarOrderStatus> {
  return new Map([...parseDaribarOrderFeed(payload)].map(([id, value]) => [id, value.status]));
}

function authorization(token: string): Record<string, string> {
  const credential = text(token, 8_192);
  if (!credential || /\s/.test(credential)) throw new Error("daribar_auth_required");
  return { authorization: `Bearer ${credential}` };
}

/** Current Daribar Swagger requires Authorization: Bearer for account orders. */
export async function getDaribarCustomerOrderFeed(token: string): Promise<Map<string, DaribarOrderSnapshot>> {
  const payload = await daribarJson<unknown>("/api/v1/orders", {
    origin: "order", auth: false, headers: authorization(token),
    query: { limit: 100, offset: 0 }, timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024,
  });
  return parseDaribarOrderFeed(payload);
}

export async function getDaribarCustomerOrderStatuses(token: string): Promise<Map<string, DaribarOrderStatus>> {
  const feed = await getDaribarCustomerOrderFeed(token);
  return new Map([...feed].map(([id, value]) => [id, value.status]));
}

export async function getDaribarCustomerOrder(token: string, orderId: string): Promise<DaribarOrderSnapshot> {
  const normalizedId = text(orderId, 256);
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(normalizedId)) throw new Error("invalid_order_id");
  let payload: unknown;
  try {
    payload = await daribarJson<unknown>(`/api/v1/orders/${encodeURIComponent(normalizedId)}`, {
      origin: "order", auth: false, headers: authorization(token),
      timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024,
    });
  } catch (error) {
    if (!(error instanceof DaribarHttpError) || ![404, 405].includes(error.status)) throw error;
    payload = await daribarJson<unknown>(`/api/v2/orders/${encodeURIComponent(normalizedId)}`, {
      origin: "order", auth: false, headers: authorization(token),
      timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024,
    });
  }
  const envelope = record(payload);
  const snapshot = parseSnapshot(envelope?.result ?? payload);
  if (!snapshot) throw new DaribarHttpError(502, "daribar_order_invalid_response");
  return snapshot;
}
