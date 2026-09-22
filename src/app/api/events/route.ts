import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { customerSession } from "@/lib/customerSession";
import { insertCdpEvents, type CdpEventRow } from "@/lib/cdp/store";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RECORD_NODES = 10_000;
const SOURCES = new Set<CdpEventRow["source"]>(["web", "android", "ios"]);
const EVENT_NAMES = new Set([
  "app_opened", "page_viewed", "search_performed", "category_viewed", "filter_applied",
  "product_viewed", "pharmacy_selected", "cart_item_added", "cart_item_removed",
  "checkout_started", "delivery_city_compared", "delivery_city_option_selected",
  "order_submitted", "order_confirmed", "order_cancelled",
  "order_completed", "demo_session_started", "customer_identified",
  "push_permission_changed", "push_opened",
  "web_vital",
]);
const forbiddenKey = /phone|email|password|secret|token|authorization|cookie/i;
const emailValue = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const kazakhstanPhoneValue = /(?:^|\D)(?:\+?7|8)[\s().-]*[67](?:[\s().-]*\d){9}(?:$|\D)/;
const bearerValue = /\bbearer\s+\S+/i;
const jwtValue = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveText(value: string): boolean {
  return emailValue.test(value)
    || kazakhstanPhoneValue.test(value)
    || bearerValue.test(value)
    || jwtValue.test(value);
}

function safeRecord(value: unknown, maxBytes: number): Record<string, unknown> | null {
  if (!isRecord(value)) return value === undefined || value === null ? {} : null;
  const queue: unknown[] = [value];
  let inspected = 0;
  while (queue.length) {
    const current = queue.pop();
    inspected += 1;
    if (inspected > MAX_RECORD_NODES) return null;
    if (typeof current === "string") {
      if (isSensitiveText(current)) return null;
      continue;
    }
    if (Array.isArray(current)) {
      for (const child of current) queue.push(child);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenKey.test(key)) return null;
      if (typeof child === "string" && isSensitiveText(child)) return null;
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes ? value : null;
}

function requestIp(req: Request): string {
  // The production Nginx config overwrites X-Real-IP, while its forwarded-for
  // chain can retain a client-supplied first hop.
  const realIp = req.headers.get("x-real-ip")?.trim();
  return (realIp && realIp.length <= 100 ? realIp : clientIp(req)).slice(0, 100);
}

function hashIdentifier(secret: string, kind: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 200) return null;
  return createHmac("sha256", secret).update(`${kind}\0${cleaned}`).digest("hex");
}

function cleanEvent(
  raw: unknown,
  secret: string,
  authenticatedCustomerId: string | null,
): { value?: CdpEventRow; error?: string; key?: string } {
  if (!isRecord(raw)) return { error: "invalid_event" };
  const key = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9:_-]{16,120}$/.test(key)) return { error: "invalid_idempotency_key" };
  const eventName = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!EVENT_NAMES.has(eventName)) return { key, error: "unsupported_event" };
  const source = typeof raw.source === "string" ? raw.source.trim() as CdpEventRow["source"] : "web";
  if (!SOURCES.has(source)) return { key, error: "invalid_source" };
  const eventVersion = raw.version === undefined ? 1 : Number(raw.version);
  if (!Number.isSafeInteger(eventVersion) || eventVersion < 1 || eventVersion > 20) {
    return { key, error: "invalid_version" };
  }
  const occurred = new Date(typeof raw.occurredAt === "string" ? raw.occurredAt : "");
  const now = Date.now();
  if (Number.isNaN(occurred.valueOf())
      || occurred.valueOf() < now - 30 * 24 * 60 * 60_000
      || occurred.valueOf() > now + 5 * 60_000) {
    return { key, error: "invalid_occurred_at" };
  }
  const properties = safeRecord(raw.properties, 16 * 1024);
  const context = safeRecord(raw.context, 8 * 1024);
  const consent = safeRecord(raw.consent, 4 * 1024);
  if (!properties || !context || !consent) return { key, error: "invalid_payload" };
  const anonymousIdHash = hashIdentifier(secret, "anonymous", raw.anonymousId);
  const sessionIdHash = hashIdentifier(secret, "session", raw.sessionId);
  if (!anonymousIdHash && !authenticatedCustomerId) return { key, error: "identity_required" };

  return {
    key,
    value: {
      idempotencyKey: key,
      eventName,
      eventVersion,
      customerId: authenticatedCustomerId,
      anonymousIdHash,
      sessionIdHash,
      source,
      occurredAt: occurred.toISOString(),
      properties,
      context,
      consentSnapshot: consent,
    },
  };
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415, headers: NO_STORE });
  }
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: NO_STORE });
  }
  const ip = requestIp(req);
  if (!rateLimit(`cdp:${ip}`, 120, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const secret = String(process.env.CDP_HASH_SECRET || "").trim();
  if (secret.length < 32 || secret === "please-change-to-a-long-random-string") {
    return NextResponse.json({ error: "cdp_not_configured" }, { status: 503, headers: NO_STORE });
  }
  const bodyText = await req.text().catch(() => null);
  if (bodyText === null) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const rawEvents = isRecord(body) && Array.isArray(body.events) ? body.events : null;
  if (!rawEvents || rawEvents.length < 1 || rawEvents.length > 50) {
    return NextResponse.json({ error: "invalid_batch" }, { status: 400, headers: NO_STORE });
  }

  const session = await customerSession(req);
  const customerId = session.status === "authenticated" ? session.customerId : null;
  const parsed = rawEvents.map((event) => cleanEvent(event, secret, customerId));
  const invalid = parsed
    .map((result, index) => result.error ? { index, idempotencyKey: result.key, error: result.error } : null)
    .filter(Boolean);
  if (invalid.length) {
    return NextResponse.json({ error: "invalid_events", invalid }, { status: 400, headers: NO_STORE });
  }

  try {
    const results = await insertCdpEvents(parsed.map((result) => result.value as CdpEventRow));
    return NextResponse.json({
      ok: true,
      accepted: results.filter((result) => result.inserted).length,
      duplicated: results.filter((result) => !result.inserted).length,
      results,
    }, { status: 202, headers: NO_STORE });
  } catch (error) {
    console.error("[cdp/events] batch failed", error);
    return NextResponse.json({ error: "cdp_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
