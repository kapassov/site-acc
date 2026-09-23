import { DaribarHttpError, daribarJson } from "./client.ts";

export const DARIBAR_PAYMENT_STATUSES = [
  "pending", "ready_to_invoice", "invoice_ready", "check_invoice",
  "generated_invoice", "paid", "failed", "canceled", "kaspi_not_found",
  "wait_capture", "paid_delivery", "add_invoice", "ready_to_refund",
  "refund_ready", "refund_failed", "unhold",
] as const;

export type DaribarPaymentStatus = typeof DARIBAR_PAYMENT_STATUSES[number] | "unknown";

export type DaribarPaymentRefund = {
  id: string;
  amount: number;
  status: DaribarPaymentStatus;
  type: string;
  createdAt: string;
  updatedAt: string;
};

export type DaribarOrderPayment = {
  id: string;
  orderId: string;
  pharmacyCode: string;
  method: string;
  status: DaribarPaymentStatus;
  amount?: number;
  itemsAmount?: number;
  deliveryAmount?: number;
  refundAmount?: number;
  type: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  numInOrder: number;
  hasPaymentUrl: boolean;
  refunds: DaribarPaymentRefund[];
};

export type DaribarOrderPaymentSnapshot = {
  status: DaribarPaymentStatus;
  paid: boolean | null;
  authorized: boolean;
  method: string;
  type: string;
  paidAt?: string;
  updatedAt: string;
  numInOrder: number;
  hasPaymentUrl: boolean;
  refundAmount: number;
  refundStatus?: DaribarPaymentStatus;
};

const STATUS_SET = new Set<string>(DARIBAR_PAYMENT_STATUSES);
const ORDER_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 256): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function status(value: unknown): DaribarPaymentStatus {
  const normalized = text(value, 100).toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_SET.has(normalized) ? normalized as DaribarPaymentStatus : "unknown";
}

function timestamp(value: unknown): string {
  const raw = text(value, 100);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : "";
}

function parseRefund(value: unknown): DaribarPaymentRefund | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.uuid, 128);
  const amount = money(item.amount);
  const createdAt = timestamp(item.created_at);
  const updatedAt = timestamp(item.updated_at);
  if (!id || amount === undefined || !createdAt || !updatedAt) return null;
  return {
    id,
    amount,
    status: status(item.status),
    type: text(item.refund_type, 100).toLowerCase(),
    createdAt,
    updatedAt,
  };
}

function parsePayment(value: unknown): DaribarOrderPayment | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.uuid, 128);
  const orderId = text(item.order_id, 256);
  const createdAt = timestamp(item.created_at);
  const updatedAt = timestamp(item.updated_at);
  const numInOrder = Number(item.num_in_order);
  if (!id || !ORDER_ID.test(orderId) || !createdAt || !updatedAt
      || !Number.isSafeInteger(numInOrder) || numInOrder < 0) return null;
  const refunds = Array.isArray(item.refunds)
    ? item.refunds.map(parseRefund).filter((entry): entry is DaribarPaymentRefund => Boolean(entry))
    : [];
  const amount = money(item.amount);
  const itemsAmount = money(item.items_amount);
  const deliveryAmount = money(item.delivery_amount);
  const refundAmount = money(item.refund_amount);
  const paidAt = timestamp(item.paid_at);
  return {
    id,
    orderId,
    pharmacyCode: text(item.pharmacy_code, 128),
    method: text(item.payment_method, 100).toLowerCase(),
    status: status(item.status),
    ...(amount !== undefined ? { amount } : {}),
    ...(itemsAmount !== undefined ? { itemsAmount } : {}),
    ...(deliveryAmount !== undefined ? { deliveryAmount } : {}),
    ...(refundAmount !== undefined ? { refundAmount } : {}),
    type: text(item.payment_type, 100).toLowerCase(),
    createdAt,
    updatedAt,
    ...(paidAt ? { paidAt } : {}),
    numInOrder,
    hasPaymentUrl: Boolean(text(item.payment_url, 2_048)),
    refunds,
  };
}

/** Parse the documented BaseResponse without ever exposing private payment URLs. */
export function parseDaribarOrderPayments(payload: unknown, expectedOrderId: string): DaribarOrderPayment[] {
  const envelope = record(payload);
  if (!envelope || envelope.status !== "success" || !Array.isArray(envelope.result)) {
    throw new DaribarHttpError(502, "daribar_payments_invalid_response");
  }
  const parsed = envelope.result.map(parsePayment);
  if (parsed.some((entry) => !entry)) {
    throw new DaribarHttpError(502, "daribar_payments_invalid_response");
  }
  if (parsed.some((entry) => entry!.orderId !== expectedOrderId)) {
    throw new DaribarHttpError(502, "daribar_payments_order_mismatch");
  }
  return (parsed as DaribarOrderPayment[]).sort((left, right) => (
    right.numInOrder - left.numInOrder
      || Date.parse(right.createdAt) - Date.parse(left.createdAt)
      || right.id.localeCompare(left.id)
  ));
}

function paidState(value: DaribarPaymentStatus): boolean | null {
  if (value === "paid" || value === "paid_delivery") return true;
  if (["failed", "canceled", "kaspi_not_found"].includes(value)) return false;
  return null;
}

/** Select the authoritative whole-order payment; a successful retry wins. */
export function summarizeDaribarOrderPayments(payments: DaribarOrderPayment[]): DaribarOrderPaymentSnapshot | null {
  const wholeOrder = payments.filter((payment) => payment.type === "order");
  const itemPayments = payments.filter((payment) => payment.type === "items");
  const candidates = wholeOrder.length ? wholeOrder : itemPayments.length ? itemPayments : payments;
  const selected = candidates.find((payment) => payment.status === "paid") || candidates[0];
  if (!selected) return null;
  const completedRefunds = selected.refunds.filter((refund) => refund.status === "refund_ready");
  const refundAmount = Math.max(
    selected.refundAmount || 0,
    completedRefunds.reduce((sum, refund) => sum + refund.amount, 0),
  );
  const latestRefund = [...selected.refunds].sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id)
  ))[0];
  return {
    status: selected.status,
    paid: paidState(selected.status),
    authorized: selected.status === "wait_capture",
    method: selected.method,
    type: selected.type,
    ...(selected.paidAt ? { paidAt: selected.paidAt } : {}),
    updatedAt: selected.updatedAt,
    numInOrder: selected.numInOrder,
    hasPaymentUrl: selected.hasPaymentUrl,
    refundAmount,
    ...(latestRefund ? { refundStatus: latestRefund.status } : {}),
  };
}

function authorization(token: string): Record<string, string> {
  const credential = text(token, 8_192);
  if (!credential || /\s/.test(credential)) throw new Error("daribar_auth_required");
  return { authorization: `Bearer ${credential}` };
}

export async function getDaribarCustomerOrderPayment(
  token: string,
  orderId: string,
): Promise<DaribarOrderPaymentSnapshot | null> {
  const normalizedId = text(orderId, 256);
  if (!ORDER_ID.test(normalizedId)) throw new Error("invalid_order_id");
  const payload = await daribarJson<unknown>(
    `/api/v1/orders/${encodeURIComponent(normalizedId)}/payments`,
    {
      origin: "order",
      auth: false,
      headers: authorization(token),
      timeoutMs: 8_000,
      maxBytes: 2 * 1024 * 1024,
    },
  );
  return summarizeDaribarOrderPayments(parseDaribarOrderPayments(payload, normalizedId));
}
