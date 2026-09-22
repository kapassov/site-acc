import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import {
  adminAuthorized,
  createPushPayload,
  PushNotConfiguredError,
  sendToSubscribers,
} from "@/lib/push/send";
import { appendHistory, subscribersForOrder } from "@/lib/push/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

export async function POST(req: Request) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!rateLimit(`admin-order-status:${clientIp(req)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  const orderNumber = clean(body.orderNumber ?? body.orderId ?? body.number, 80);
  const status = clean(body.status, 80);
  if (!orderNumber || !status) {
    return NextResponse.json({ error: "order_number_and_status_required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const notificationId = randomUUID();
    const notification = createPushPayload(
      "order.status_changed",
      {
        title: body.title,
        body: body.body,
        url: body.url ?? body.deeplink,
        icon: body.icon,
        badge: body.badge,
        image: body.image,
        tag: `order-${orderNumber}`,
        orderNumber,
        status,
      },
      {
        title: `Заказ ${orderNumber}`,
        body: `Новый статус: ${status}`,
        url: "/account/orders",
        tag: `order-${orderNumber}`,
      },
      notificationId,
    );
    const targets = await subscribersForOrder(orderNumber);
    const { summary } = await sendToSubscribers(targets, notification);
    await appendHistory({
      id: notificationId,
      kind: "order-status",
      orderNumber,
      orderStatus: status,
      payload: notification,
      delivery: summary,
      createdAt: notification.createdAt,
    });
    return NextResponse.json(
      {
        ok: true,
        notificationId,
        orderNumber,
        status,
        delivery: summary,
        targets: summary.targets,
        sent: summary.sent,
        failed: summary.failed,
        revoked: summary.revoked,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof PushNotConfiguredError) {
      return NextResponse.json({ error: "push_not_configured" }, { status: 503, headers: NO_STORE });
    }
    console.error("[admin/notifications/order-status] notification failed", error);
    return NextResponse.json({ error: "send_failed" }, { status: 503, headers: NO_STORE });
  }
}
