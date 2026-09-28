import type { DaribarOrderPaymentSnapshot } from "@/lib/daribar/order-payments";
import type { DaribarOrderSnapshot } from "@/lib/daribar/order-status";
import type { StoredOrder } from "./store";

export type OrderServiceRequestKind = "cancel" | "return";
export type OrderServiceRequest = { kind: OrderServiceRequestKind; status: "pending"; requestedAt: string };

export const CANCELLATION_WINDOW_MS = 15 * 60_000;

export function serviceRequestKey(kind: OrderServiceRequestKind): "customer_cancel_request" | "customer_return_request" {
  return kind === "cancel" ? "customer_cancel_request" : "customer_return_request";
}

export function storedServiceRequest(order: StoredOrder, kind: OrderServiceRequestKind): OrderServiceRequest | null {
  const value = order.metadata?.[serviceRequestKey(kind)];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return request.kind === kind && request.status === "pending" && typeof request.requestedAt === "string"
    ? { kind, status: "pending", requestedAt: request.requestedAt } : null;
}

export function availableServiceActions(
  order: StoredOrder,
  snapshot?: DaribarOrderSnapshot,
  payment?: DaribarOrderPaymentSnapshot | null,
  now = Date.now(),
): { canCancel: boolean; canReturn: boolean } {
  const age = now - new Date(order.createdAt).getTime();
  const providerStatus = snapshot?.status || "unknown";
  const locallyCancelled = /cancel|отмен/i.test(order.status || "");
  const active = !["canceled", "completed", "delivered"].includes(providerStatus);
  const cancelRequest = storedServiceRequest(order, "cancel");
  const returnRequest = storedServiceRequest(order, "return");
  const canCancel = order.sourceSystem === "daribar" && Boolean(snapshot) && !locallyCancelled
    && age >= 0 && age <= CANCELLATION_WINDOW_MS
    // "processing" is normalized to "accepted" by Daribar and may already
    // mean pharmacy assembly. Only explicitly pre-assembly states are safe.
    && ["created", "new", "placed"].includes(providerStatus)
    && !cancelRequest && !returnRequest;
  const paid = payment?.paid === true || snapshot?.paid === true
    || String(order.metadata?.payment_status || "").toLowerCase() === "paid";
  const canReturn = order.sourceSystem === "daribar" && Boolean(snapshot) && !locallyCancelled
    && providerStatus !== "canceled" && (paid || !active)
    && !returnRequest && !cancelRequest;
  return { canCancel, canReturn };
}
