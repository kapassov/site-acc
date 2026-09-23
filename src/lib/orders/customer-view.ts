import type { OrderStatus } from "@/lib/data/account";
import type { DaribarOrderPaymentSnapshot } from "@/lib/daribar/order-payments";
import type { DaribarOrderSnapshot } from "@/lib/daribar/order-status";
import type { StoredOrder } from "./store";

export function orderMetadataText(order: StoredOrder, key: string): string {
  return String(order.metadata?.[key] || "").trim().toLowerCase();
}

export function providerSnapshotFor(
  order: StoredOrder,
  feed: Map<string, DaribarOrderSnapshot>,
): DaribarOrderSnapshot | undefined {
  return feed.get(order.sourceOrderId)
    || feed.get(String(order.metadata?.provider_order_id || ""));
}

function currentPaymentStatus(
  order: StoredOrder,
  snapshot?: DaribarOrderSnapshot,
  payment?: DaribarOrderPaymentSnapshot | null,
): string {
  if (payment?.paid === true) return "paid";
  if (payment && payment.status !== "unknown") return payment.status;
  if (snapshot?.paid === true) return "paid";
  return snapshot?.paymentStatus || orderMetadataText(order, "payment_status");
}

export function customerOrderStatus(
  order: StoredOrder,
  snapshot?: DaribarOrderSnapshot,
  payment?: DaribarOrderPaymentSnapshot | null,
): OrderStatus {
  const providerStatus = snapshot?.status || orderMetadataText(order, "provider_status");
  const combined = `${order.status || ""} ${providerStatus}`.trim().toLowerCase();
  if (/cancel|отмен/.test(combined)) return "cancelled";
  if (/deliver|complete|получ/.test(combined)) return "delivered";

  const paymentMethod = orderMetadataText(order, "payment");
  const checkoutState = orderMetadataText(order, "checkout_state");
  const paymentLinkStatus = orderMetadataText(order, "payment_link_status");
  const paymentStatus = currentPaymentStatus(order, snapshot, payment);
  const claimStatus = snapshot?.claimStatus || orderMetadataText(order, "delivery_claim_status");
  const deliveryStatus = snapshot?.deliveryStatus || orderMetadataText(order, "delivery_status");

  if (paymentMethod === "card" && paymentStatus !== "paid") {
    if (checkoutState === "awaiting_payment" && paymentLinkStatus === "received") return "awaiting_payment";
    return "action_required";
  }
  if (["failed", "rejected", "cancelled", "canceled"].includes(claimStatus)
      || ["failed", "rejected", "cancelled", "canceled"].includes(deliveryStatus)) {
    return "action_required";
  }
  if (checkoutState === "action_required" || ["missing", "rejected"].includes(paymentLinkStatus)) {
    return "action_required";
  }
  return "processing";
}

export function customerOrderProgress(order: StoredOrder, snapshot?: DaribarOrderSnapshot): number {
  const status = `${order.status} ${snapshot?.status || orderMetadataText(order, "provider_status")} ${snapshot?.deliveryStatus || ""}`
    .toLowerCase();
  if (/deliver|complete|completed|получ/.test(status)) return 3;
  if (/in_the_way|transit|courier|way|ship|достав/.test(status)) return 2;
  if (/accepted|assembling|assembled|ready|собран|готов|planned|looking_for_courier/.test(status)) return 1;
  return 0;
}

export function customerOrderSummary(
  order: StoredOrder,
  snapshot?: DaribarOrderSnapshot,
  payment?: DaribarOrderPaymentSnapshot | null,
) {
  const localLines = Array.isArray(order.metadata?.line_items) ? order.metadata.line_items : [];
  const preview = snapshot?.items.length
    ? snapshot.items.map((item) => item.name || item.sku).filter(Boolean).slice(0, 4)
    : localLines.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const line = value as Record<string, unknown>;
      const name = String(line.title || line.name || "").trim();
      return name ? [name] : [];
    }).slice(0, 4);
  return {
    id: `INK-${order.n}`,
    detailId: order.id,
    providerOrderId: order.sourceOrderId,
    date: order.date,
    status: customerOrderStatus(order, snapshot, payment),
    total: order.sum,
    itemsCount: order.items,
    preview,
    progressStep: customerOrderProgress(order, snapshot),
    paymentStatus: currentPaymentStatus(order, snapshot, payment),
    deliveryStatus: snapshot?.deliveryStatus || snapshot?.claimStatus || orderMetadataText(order, "delivery_claim_status"),
  };
}

export function providerMetadataPatch(
  snapshot?: DaribarOrderSnapshot,
  payment?: DaribarOrderPaymentSnapshot | null,
): Record<string, unknown> {
  const paymentStatus = payment?.paid === true
    ? "paid"
    : payment && payment.status !== "unknown"
      ? payment.status
      : snapshot?.paid === true
        ? "paid"
        : snapshot?.paymentStatus || "";
  return {
    ...(snapshot ? { provider_status: snapshot.rawStatus || snapshot.status } : {}),
    ...(paymentStatus === "paid" ? { payment_status: "paid", checkout_state: "processing" }
      : paymentStatus ? { payment_status: paymentStatus } : {}),
    ...(payment?.method ? { provider_payment_method: payment.method } : {}),
    ...(payment?.paidAt ? { provider_paid_at: payment.paidAt } : {}),
    ...(payment?.refundAmount ? { provider_refund_amount: payment.refundAmount } : {}),
    ...(payment?.refundStatus ? { provider_refund_status: payment.refundStatus } : {}),
    ...(snapshot?.pharmacyStatus ? { pharmacy_status: snapshot.pharmacyStatus } : {}),
    ...(snapshot?.claimStatus ? { delivery_claim_status: snapshot.claimStatus } : {}),
    ...(snapshot?.deliveryStatus ? { delivery_status: snapshot.deliveryStatus } : {}),
    ...(snapshot?.trackingUrl?.startsWith("https://") ? { tracking_url: snapshot.trackingUrl } : {}),
    provider_synced_at: new Date().toISOString(),
  };
}
