import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { customerSession } from "@/lib/customerSession";
import { revokeDevice, upsertSubscription } from "@/lib/push/store";
import type { BrowserPushSubscription, PushPreferences } from "@/lib/push/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSubscription(value: unknown): BrowserPushSubscription | null {
  if (!isRecord(value) || !isRecord(value.keys)) return null;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  const p256dh = typeof value.keys.p256dh === "string" ? value.keys.p256dh.trim() : "";
  const auth = typeof value.keys.auth === "string" ? value.keys.auth.trim() : "";
  const expiration = value.expirationTime;
  if (
    !endpoint.startsWith("https://") ||
    endpoint.length > 2_048 ||
    !p256dh || p256dh.length > 512 ||
    !auth || auth.length > 256 ||
    !(expiration == null || (typeof expiration === "number" && Number.isFinite(expiration)))
  ) return null;
  return {
    endpoint,
    expirationTime: typeof expiration === "number" ? expiration : null,
    keys: { p256dh, auth },
  };
}

function parsePreferences(value: unknown): Partial<PushPreferences> | undefined {
  if (!isRecord(value)) return undefined;
  const preferences: Partial<PushPreferences> = {};
  if (typeof value.orders === "boolean") preferences.orders = value.orders;
  if (typeof value.promos === "boolean") preferences.promos = value.promos;
  return preferences;
}

export async function POST(req: Request) {
  if (!rateLimit(`push-subscribe:${clientIp(req)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
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
  const subscription = parseSubscription(body.subscription);
  if (!subscription) {
    return NextResponse.json({ error: "bad_subscription" }, { status: 400, headers: NO_STORE });
  }

  try {
    const credentials = await upsertSubscription({
      subscription,
      customerId: session.customerId,
      deviceId: typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : undefined,
      deviceToken: typeof body.deviceToken === "string" ? body.deviceToken.slice(0, 200) : undefined,
      preferences: parsePreferences(body.preferences),
      locale: typeof body.locale === "string" ? body.locale : undefined,
      city: typeof body.city === "string" ? body.city : undefined,
      userAgent: req.headers.get("user-agent") || undefined,
    });
    return NextResponse.json({ ok: true, ...credentials }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error("[push/subscriptions] failed to persist subscription", error);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(req: Request) {
  if (!rateLimit(`push-unsubscribe:${clientIp(req)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.deviceId !== "string" || typeof body.deviceToken !== "string") {
    return NextResponse.json({ error: "bad_credentials" }, { status: 400, headers: NO_STORE });
  }
  try {
    const revoked = await revokeDevice(body.deviceId.slice(0, 100), body.deviceToken.slice(0, 200));
    if (!revoked) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, deviceId: null, deviceToken: null }, { headers: NO_STORE });
  } catch (error) {
    console.error("[push/subscriptions] failed to revoke subscription", error);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
