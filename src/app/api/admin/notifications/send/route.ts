import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import {
  adminAuthorized,
  createPushPayload,
  PushNotConfiguredError,
  sendToSubscribers,
  type PushMessageInput,
} from "@/lib/push/send";
import { appendHistory, subscribersForAudience } from "@/lib/push/store";
import type { PushAudience } from "@/lib/push/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const AUDIENCES = new Set<PushAudience>(["all", "promos", "orders"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageInput(body: Record<string, unknown>): PushMessageInput {
  return {
    title: body.title,
    body: body.body,
    url: body.url ?? body.deeplink,
    icon: body.icon,
    badge: body.badge,
    image: body.image,
    tag: body.tag,
  };
}

export async function POST(req: Request) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!rateLimit(`admin-push-send:${clientIp(req)}`, 10, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  const audience = String(body.audience || "") as PushAudience;
  if (!AUDIENCES.has(audience)) {
    return NextResponse.json({ error: "bad_audience" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "title_and_body_required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const notificationId = randomUUID();
    const notification = createPushPayload(
      `campaign.${audience}`,
      messageInput(body),
      {
        title: "Аптека со склада",
        body: "У нас есть новости для вас.",
        url: "/promotions",
        tag: `campaign-${notificationId.slice(0, 12)}`,
      },
      notificationId,
    );
    const targets = await subscribersForAudience(audience);
    const { summary } = await sendToSubscribers(targets, notification);
    await appendHistory({
      id: notificationId,
      kind: "campaign",
      audience,
      payload: notification,
      delivery: summary,
      createdAt: notification.createdAt,
    });
    return NextResponse.json(
      {
        ok: true,
        notificationId,
        audience,
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
    console.error("[admin/notifications/send] campaign failed", error);
    return NextResponse.json({ error: "send_failed" }, { status: 503, headers: NO_STORE });
  }
}
