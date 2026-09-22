import type { OrderStatus } from "@/lib/data/account";
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

export function customerOrderStatus(order: StoredOrder, snapshot?: DaribarOrderSnapshot): OrderStatus {
  const providerStatus = snapshot?.status || orderMetadataText(order, "provider_status");
  const combined = `${order.status || ""} ${providerStatus}`.trim().toLowerCase();
  if (/cancel|отмен/.test(combined)) return "cancelled";
  if (/deliver|complete|получ/.test(combined)) return "delivered";

  const payment = orderMetadataText(order, "payment");
  const checkoutState = orderMetadataText(order, "checkout_state");
  const paymentLinkStatus = orderMetadataText(order, "payment_link_status");
  const paymentStatus = snapshot?.paid === true
    ? "paid"
    : snapshot?.paymentStatus || orderMetadataText(order, "payment_status");
  const claimStatus = snapshot?.claimStatus || orderMetadataText(order, "delivery_claim_status");
  const deliveryStatus = snapshot?.deliveryStatus || orderMetadataText(order, "delivery_status");

  if (payment === "card" && paymentStatus !== "paid") {
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

export function customerOrderSummary(order: StoredOrder, snapshot?: DaribarOrderSnapshot) {
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
    status: customerOrderStatus(order, snapshot),
    total: order.sum,
    itemsCount: order.items,
    preview,
    progressStep: customerOrderProgress(order, snapshot),
    paymentStatus: snapshot?.paid === true ? "paid" : snapshot?.paymentStatus || orderMetadataText(order, "payment_status"),
    deliveryStatus: snapshot?.deliveryStatus || snapshot?.claimStatus || orderMetadataText(order, "delivery_claim_status"),
  };
}

export function providerMetadataPatch(snapshot: DaribarOrderSnapshot): Record<string, unknown> {
  return {
    provider_status: snapshot.rawStatus || snapshot.status,
    ...(snapshot.paid === true ? { payment_status: "paid", checkout_state: "processing" }
      : snapshot.paymentStatus ? { payment_status: snapshot.paymentStatus } : {}),
    ...(snapshot.pharmacyStatus ? { pharmacy_status: snapshot.pharmacyStatus } : {}),
    ...(snapshot.claimStatus ? { delivery_claim_status: snapshot.claimStatus } : {}),
    ...(snapshot.deliveryStatus ? { delivery_status: snapshot.deliveryStatus } : {}),
    ...(snapshot.trackingUrl?.startsWith("https://") ? { tracking_url: snapshot.trackingUrl } : {}),
    provider_synced_at: new Date().toISOString(),
  };
}
