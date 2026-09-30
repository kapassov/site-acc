import { NextResponse } from "next/server";
import { customerSession } from "@/lib/customerSession";
import { getDaribarCustomerOrderPayment } from "@/lib/daribar/order-payments";
import { getDaribarCustomerOrder } from "@/lib/daribar/order-status";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { availableServiceActions, serviceRequestKey, storedServiceRequest, type OrderServiceRequestKind } from "@/lib/orders/service-request";
import { getCustomerOrder, updateStoredOrderMetadata } from "@/lib/orders/store";

export const dynamic = "force-dynamic";
const HEADERS = { "cache-control": "private, no-store", vary: "Cookie, Authorization" };

function sameOrigin(request: Request): boolean {
  if (/^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "")) return true;
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  const protocol = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol).split(",")[0].trim().replace(/:$/, "");
  const origin = request.headers.get("origin");
  if (!host || !origin) return false;
  try { return new URL(origin).origin === new URL(`${protocol}://${host}`).origin; }
  catch { return false; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: HEADERS });
  let body: { kind?: unknown } | null;
  try { body = await readBoundedJson<{ kind?: unknown }>(request, 1_024); }
  catch (error) { return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_body" }, { status: error instanceof RequestBodyError ? error.status : 400, headers: HEADERS }); }
  const kind: OrderServiceRequestKind | null = body?.kind === "cancel" || body?.kind === "return" ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "invalid_request_kind" }, { status: 400, headers: HEADERS });
  const { id } = await params;
  if (!id || id.length > 256) return NextResponse.json({ error: "order_not_found" }, { status: 404, headers: HEADERS });
  if (!rateLimit(`order-request:${clientIp(request)}:${id}`, 5, 60_000, Date.now())) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: HEADERS });
  }
  const session = await customerSession(request);
  if (session.status === "anonymous") return NextResponse.json({ error: "auth_required" }, { status: 401, headers: HEADERS });
  if (session.status === "unavailable") return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: HEADERS });
  try {
    const order = await getCustomerOrder(session.customerId, decodeURIComponent(id));
    if (!order || order.demo || order.sourceSystem !== "daribar") {
      return NextResponse.json({ error: "order_not_found" }, { status: 404, headers: HEADERS });
    }
    const existing = storedServiceRequest(order, kind);
    if (existing) return NextResponse.json({ request: existing }, { headers: HEADERS });
    // A customer request is not a Daribar cancellation/refund. Check the live
    // provider state before accepting one, and keep the order status unchanged.
    const [snapshot, payment] = await Promise.all([
      getDaribarCustomerOrder(order.sourceOrderId),
      kind === "return"
        ? getDaribarCustomerOrderPayment(order.sourceOrderId).catch(() => null)
        : Promise.resolve(null),
    ]);
    const actions = availableServiceActions(order, snapshot, payment);
    if ((kind === "cancel" && !actions.canCancel) || (kind === "return" && !actions.canReturn)) {
      return NextResponse.json({ error: "request_not_available" }, { status: 409, headers: HEADERS });
    }
    const value = { kind, status: "pending" as const, requestedAt: new Date().toISOString() };
    await updateStoredOrderMetadata(order.id, { [serviceRequestKey(kind)]: value });
    console.info("[customer/order-request] awaiting operator", { orderId: order.id, providerOrderId: order.sourceOrderId, kind });
    return NextResponse.json({ request: value }, { status: 202, headers: HEADERS });
  } catch (error) {
    console.error("[customer/order-request] unavailable", { code: error instanceof Error ? error.message.slice(0, 100) : "unknown" });
    return NextResponse.json({ error: "order_request_unavailable" }, { status: 503, headers: HEADERS });
  }
}
