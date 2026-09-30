import { NextResponse } from "next/server";
import { customerSession } from "@/lib/customerSession";
import { getDaribarCustomerOrderPayment, type DaribarOrderPaymentSnapshot } from "@/lib/daribar/order-payments";
import { getDaribarCustomerOrder, getDaribarCustomerOrderFeed, type DaribarOrderSnapshot } from "@/lib/daribar/order-status";
import { customerOrderSummary, providerMetadataPatch, providerSnapshotFor } from "@/lib/orders/customer-view";
import { listCustomerOrders, updateStoredOrderMetadata } from "@/lib/orders/store";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await customerSession(req);
  if (session.status === "anonymous") return NextResponse.json({ orders: [] }, { headers: NO_STORE });
  if (session.status === "unavailable") {
    return NextResponse.json({ orders: [], error: "orders_unavailable" }, { status: 503, headers: NO_STORE });
  }

  try {
    const orders = (await listCustomerOrders(session.customerId, 100)).filter((order) => order.demo !== true);
    const daribarOrders = orders.filter((order) => order.sourceSystem === "daribar");
    let providerFeed = new Map<string, DaribarOrderSnapshot>();
    const paymentFeed = new Map<string, DaribarOrderPaymentSnapshot>();

    if (daribarOrders.length) {
      providerFeed = await getDaribarCustomerOrderFeed().catch(() => new Map<string, DaribarOrderSnapshot>());
      if (providerFeed.size === 0) {
        const recovered = await Promise.allSettled(daribarOrders.slice(0, 20).map(async (order) => (
          [order.sourceOrderId, await getDaribarCustomerOrder(order.sourceOrderId)] as const
        )));
        providerFeed = new Map(recovered.flatMap((result) => result.status === "fulfilled"
          ? [[result.value[0], result.value[1]] as const] : []));
      }

      const paymentCandidates = daribarOrders.filter((order) => (
        String(order.metadata?.payment || "").toLowerCase() === "card"
        && String(order.metadata?.payment_status || "").toLowerCase() !== "paid"
      )).slice(0, 5);
      const paymentResults = await Promise.allSettled(paymentCandidates.map(async (order) => (
        [order.sourceOrderId, await getDaribarCustomerOrderPayment(order.sourceOrderId)] as const
      )));
      for (const result of paymentResults) {
        if (result.status === "fulfilled" && result.value[1]) paymentFeed.set(result.value[0], result.value[1]);
      }
    }

    await Promise.allSettled(orders.map((order) => {
      const snapshot = providerSnapshotFor(order, providerFeed);
      const payment = paymentFeed.get(order.sourceOrderId);
      return snapshot || payment
        ? updateStoredOrderMetadata(order.id, providerMetadataPatch(snapshot, payment))
        : Promise.resolve(null);
    }));

    return NextResponse.json({
      orders: orders.map((order) => customerOrderSummary(
        order,
        providerSnapshotFor(order, providerFeed),
        paymentFeed.get(order.sourceOrderId),
      )),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("[customer/orders] load failed", {
      reason: error instanceof Error ? error.message.slice(0, 100) : "unknown",
    });
    return NextResponse.json({ orders: [], error: "orders_unavailable" }, { status: 502, headers: NO_STORE });
  }
}
