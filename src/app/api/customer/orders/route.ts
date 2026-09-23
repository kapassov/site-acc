/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { customerAuthMode, readDemoSession } from "@/lib/customerAuthMode";
import { medusaStore } from "@/lib/medusaStore";
import { listCustomerOrders, updateStoredOrderMetadata } from "@/lib/orders/store";
import { setDaribarAuthCookies } from "@/lib/daribar/auth";
import { DaribarCustomerSessionError, daribarCustomerSession } from "@/lib/daribar/customer-session";
import { getDaribarCustomerOrderPayment, type DaribarOrderPaymentSnapshot } from "@/lib/daribar/order-payments";
import { getDaribarCustomerOrder, getDaribarCustomerOrderFeed, type DaribarOrderSnapshot } from "@/lib/daribar/order-status";
import { customerOrderSummary, providerMetadataPatch, providerSnapshotFor } from "@/lib/orders/customer-view";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };
const AUTH_MODE = customerAuthMode();
const DEMO_COOKIE = "inkar_demo_session";
const CUSTOMER_AUTH_SECRET = process.env.CUSTOMER_AUTH_SECRET || "";

export async function GET(req: Request) {
  if (AUTH_MODE === "demo") {
    const cookieStore = await cookies();
    const signedSession = req.headers.get("x-demo-session") || cookieStore.get(DEMO_COOKIE)?.value || null;
    const sessionId = readDemoSession(signedSession, CUSTOMER_AUTH_SECRET);
    if (!sessionId) {
      return NextResponse.json({ orders: [], error: "demo_session_required" }, { status: 401, headers: NO_STORE });
    }
    try {
      const orders = await listCustomerOrders(`demo:${sessionId}`, 100);
      return NextResponse.json(
        { orders: orders.filter((order) => order.demo === true).map((order) => customerOrderSummary(order)) },
        { headers: NO_STORE },
      );
    } catch (error) {
      return NextResponse.json(
        { orders: [], error: error instanceof Error ? error.message : "backend unavailable" },
        { status: 502, headers: NO_STORE },
      );
    }
  }

  let daribarSession;
  try {
    daribarSession = await daribarCustomerSession(req);
  } catch (error) {
    const authError = error instanceof DaribarCustomerSessionError ? error : null;
    const response = NextResponse.json(
      { orders: [], error: authError?.message || "orders_unavailable" },
      { status: authError?.status || 502, headers: NO_STORE },
    );
    if (authError?.rotatedTokens) setDaribarAuthCookies(response, authError.rotatedTokens);
    return response;
  }
  if (daribarSession) {
    try {
      const orders = await listCustomerOrders(daribarSession.customerId, 100);
      let providerFeed = await getDaribarCustomerOrderFeed(daribarSession.accessToken).catch((error) => {
        console.warn("[customer/orders] Daribar status feed unavailable", {
          code: error instanceof Error ? error.message.slice(0, 100) : "unknown",
        });
        return new Map<string, DaribarOrderSnapshot>();
      });
      const visibleOrders = orders.filter((order) => order.demo !== true);
      // Some Daribar accounts currently reject the collection endpoint while
      // still allowing GET /orders/{id}. Recover recent orders individually.
      if (providerFeed.size === 0) {
        const recovered = await Promise.allSettled(visibleOrders.slice(0, 20).map(async (order) => (
          [order.sourceOrderId, await getDaribarCustomerOrder(daribarSession.accessToken, order.sourceOrderId)] as const
        )));
        providerFeed = new Map(recovered.flatMap((result) => result.status === "fulfilled"
          ? [[result.value[0], result.value[1]] as const] : []));
      }
      // The documented payment endpoint is per order. Refresh only a bounded
      // number of recent unresolved card orders so the account page stays fast
      // and cannot fan out into an unbounded load on Daribar.
      const paymentCandidates = visibleOrders.filter((order) => (
        order.sourceSystem === "daribar"
          && String(order.metadata?.payment || "").toLowerCase() === "card"
          && String(order.metadata?.payment_status || "").toLowerCase() !== "paid"
      )).slice(0, 5);
      const paymentResults = await Promise.allSettled(paymentCandidates.map(async (order) => (
        [order.sourceOrderId, await getDaribarCustomerOrderPayment(
          daribarSession.accessToken,
          order.sourceOrderId,
        )] as const
      )));
      const paymentFeed = new Map<string, DaribarOrderPaymentSnapshot>(paymentResults.flatMap((result) => (
        result.status === "fulfilled" && result.value[1]
          ? [[result.value[0], result.value[1]] as const]
          : []
      )));
      await Promise.allSettled(visibleOrders.map((order) => {
        const snapshot = providerSnapshotFor(order, providerFeed);
        const payment = paymentFeed.get(order.sourceOrderId);
        return snapshot || payment
          ? updateStoredOrderMetadata(order.id, providerMetadataPatch(snapshot, payment))
          : Promise.resolve(null);
      }));
      const response = NextResponse.json(
        { orders: visibleOrders.map((order) => customerOrderSummary(
          order,
          providerSnapshotFor(order, providerFeed),
          paymentFeed.get(order.sourceOrderId),
        )) },
        { headers: NO_STORE },
      );
      if (daribarSession.rotatedTokens) setDaribarAuthCookies(response, daribarSession.rotatedTokens);
      return response;
    } catch (error) {
      const providerStatus = Number((error as { status?: unknown })?.status || 0);
      const response = NextResponse.json(
        {
          orders: [],
          error: providerStatus === 401 ? "daribar_auth_required" : "orders_unavailable",
        },
        { status: providerStatus === 401 ? 401 : 502, headers: NO_STORE },
      );
      if (daribarSession.rotatedTokens) setDaribarAuthCookies(response, daribarSession.rotatedTokens);
      return response;
    }
  }

  // Retained solely for customers with the former Medusa HttpOnly session.
  // A mobile Bearer token is always Daribar and must never be sent to Medusa.
  const cookieStore = await cookies();
  const medusaToken = cookieStore.get("ms_cust")?.value || "";
  if (!medusaToken) return NextResponse.json({ orders: [] }, { headers: NO_STORE });
  try {
    const me = await medusaStore<{ customer?: { id?: unknown } }>("/store/customers/me", { token: medusaToken }).catch(() => null);
    const customerId = typeof me?.customer?.id === "string" ? me.customer.id.trim() : "";
    const [medusaResult, siteResult] = await Promise.allSettled([
      medusaStore<{ orders?: any[] }>("/store/orders", {
        token: medusaToken,
        query: { limit: 100, offset: 0, order: "-created_at", fields: "+items.*" },
      }),
      customerId ? listCustomerOrders(customerId, 100) : Promise.resolve([]),
    ]);
    if (medusaResult.status === "rejected" && siteResult.status === "rejected") {
      throw new Error("orders_unavailable");
    }
    const medusaOrders = medusaResult.status === "fulfilled" ? medusaResult.value.orders || [] : [];
    const orders = medusaOrders.map((order) => {
      const status = order.status === "canceled"
        ? "cancelled"
        : ["completed", "fulfilled", "delivered"].includes(String(order.fulfillment_status || order.status))
          ? "delivered"
          : "processing";
      const items = Array.isArray(order.items) ? order.items : [];
      return {
        id: order.display_id ? `INK-${order.display_id}` : String(order.id),
        detailId: String(order.id),
        date: new Intl.DateTimeFormat("ru-RU").format(new Date(order.created_at || Date.now())),
        status,
        total: Math.round(Number(order.total || 0)),
        itemsCount: items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0),
        preview: items.slice(0, 4).map((item: any) => String(item.product_title || item.title || "Товар")),
        progressStep: status === "delivered" ? 3 : 0,
      };
    });
    const siteOrders = siteResult.status === "fulfilled"
      ? siteResult.value.filter((order) => order.demo !== true).map((order) => customerOrderSummary(order))
      : [];
    const merged = [...siteOrders, ...orders]
      .filter((order, index, list) => list.findIndex((candidate) => candidate.id === order.id) === index)
      .slice(0, 100);
    return NextResponse.json({ orders: merged }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { orders: [], error: error instanceof Error ? error.message : "backend unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
