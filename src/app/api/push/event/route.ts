import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { customerSession } from "@/lib/customerSession";
import { createPushPayload, PushNotConfiguredError, sendToSubscribers, type PushMessageInput } from "@/lib/push/send";
import { appendHistory, authenticateDevice, bindOrderToDevice } from "@/lib/push/store";
import type { PushEventName } from "@/lib/push/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const ALLOWED_EVENTS = new Set<PushEventName>(["order.created", "app.download_interest", "test"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanOrderNumber(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return text || null;
}

function messageInput(payload: Record<string, unknown>): PushMessageInput {
  return {
    title: payload.title,
    body: payload.body,
    url: payload.url,
    icon: payload.icon,
    badge: payload.badge,
    image: payload.image,
    tag: payload.tag,
    orderNumber: payload.orderNumber,
    status: payload.status,
  };
}

export async function POST(req: Request) {
  const session = await customerSession(req);
  if (session.status === "anonymous") {
    return NextResponse.json({ error: "login_required" }, { status: 401, headers: NO_STORE });
  }
  if (session.status === "unavailable") {
    return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "bad_json" }, { status: 400, headers: NO_STORE });
  }

  const event = String(body.event ?? body.type ?? "") as PushEventName;
  const payloadCandidate = body.payload ?? body.data;
  const eventPayload = isRecord(payloadCandidate) ? payloadCandidate : {};
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : "";
  const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken.slice(0, 200) : "";

  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "unsupported_event" }, { status: 400, headers: NO_STORE });
  }
  if (!deviceId || !deviceToken) {
    return NextResponse.json({ error: "bad_credentials" }, { status: 400, headers: NO_STORE });
  }
  if (!rateLimit(`push-event:${clientIp(req)}:${deviceId}`, 12, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }

  try {
    const device = await authenticateDevice(deviceId, deviceToken);
    if (!device || device.customerId !== session.customerId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const notificationId = randomUUID();
    let orderNumber: string | null = null;
    let notification;

    if (event === "order.created") {
      orderNumber = cleanOrderNumber(eventPayload.orderNumber ?? eventPayload.orderId ?? eventPayload.number ?? body.orderNumber);
      if (!orderNumber) {
        return NextResponse.json({ error: "order_number_required" }, { status: 400, headers: NO_STORE });
      }
      const bound = await bindOrderToDevice(orderNumber, device.deviceId, session.customerId);
      if (!bound) {
        return NextResponse.json({ error: "order_not_found" }, { status: 404, headers: NO_STORE });
      }
      notification = createPushPayload(
        event,
        { ...messageInput(eventPayload), orderNumber, tag: `order-${orderNumber}` },
        {
          title: `Заказ ${orderNumber} оформлен`,
          body: "Мы приняли заказ и скоро начнём его собирать.",
          url: "/account/orders",
          tag: `order-${orderNumber}`,
        },
        notificationId,
      );
    } else if (event === "app.download_interest") {
      notification = createPushPayload(
        event,
        messageInput(eventPayload),
        {
          title: "Приложение «Аптека со склада»",
          body: "Спасибо за интерес. Сообщим, когда приложение станет доступно для скачивания.",
          url: "/",
          tag: "app-download",
        },
        notificationId,
      );
    } else {
      notification = createPushPayload(
        event,
        messageInput(eventPayload),
        {
          title: "Тестовое уведомление",
          body: "Web Push работает на этом устройстве.",
          url: "/",
          tag: "push-test",
        },
        notificationId,
      );
    }

    const targets = event === "order.created" && !device.preferences.orders ? [] : [device];
    const { summary } = await sendToSubscribers(targets, notification);
    await appendHistory({
      id: notificationId,
      kind: "event",
      event,
      orderNumber: orderNumber || undefined,
      payload: notification,
      delivery: summary,
      createdAt: notification.createdAt,
    });

    return NextResponse.json(
      {
        ok: true,
        event,
        notificationId,
        orderBound: Boolean(orderNumber),
        delivery: summary,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof PushNotConfiguredError) {
      return NextResponse.json({ error: "push_not_configured" }, { status: 503, headers: NO_STORE });
    }
    console.error("[push/event] event failed", error);
    return NextResponse.json({ error: "push_event_failed" }, { status: 503, headers: NO_STORE });
  }
}
