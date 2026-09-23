import { createHash, createHmac, randomUUID } from "node:crypto";
import { kztMinorUnits } from "./money.ts";
import { checkoutItemSource, type CanonicalCheckoutItem } from "./checkoutItems.ts";
import type { CheckoutFulfillment } from "./checkoutPricing";

export type StandardNLine = CanonicalCheckoutItem & {
  wareId: string; availableQuantity: number; unitPrice: number; total: number;
};
export type StandardNQuote = {
  quoteToken: string; snapshotId: string; expiresAt: string;
  currency: "KZT"; subtotal: number; total: number;
  pharmacy: { id: string; name: string; city: string; address?: string };
  lines: StandardNLine[]; adjustments: [];
};
export type StandardNOrder = {
  id: string; display_id: number; created_at: string; currency_code: string;
  total: number; customer_id?: string; items: Array<Record<string, unknown>>;
};
export class StandardNCommerceError extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export function commerceSignature(secret: string, timestamp: string, nonce: string, path: string, rawBody: string): string {
  return createHmac("sha256", secret).update([
    timestamp, nonce, "POST", path, createHash("sha256").update(rawBody).digest("hex"),
  ].join("\n")).digest("hex");
}
export function commerceBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  let url: URL;
  try { url = new URL(env.MEDUSA_COMMERCE_URL || env.MEDUSA_URL || ""); }
  catch { throw new StandardNCommerceError(503, "medusa_commerce_not_configured"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new StandardNCommerceError(503, "medusa_commerce_secure_transport_required");
  }
  return url.origin;
}
export async function medusaCommerce<T>(
  path: "/store/standardn/quote" | "/store/standardn/orders" | "/store/standardn/payment",
  body: unknown, request: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const base = commerceBaseUrl(env), secret = env.MEDUSA_COMMERCE_SECRET || "";
  if (secret.length < 32) throw new StandardNCommerceError(503, "medusa_commerce_not_configured");
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new StandardNCommerceError(413, "commerce_body_too_large");
  const timestamp = String(Date.now()), nonce = randomUUID();
  let response: Response;
  try {
    response = await request(`${base}${path}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(40_000),
      headers: {
        "content-type": "application/json", accept: "application/json",
        "x-publishable-api-key": env.MEDUSA_PUBLISHABLE_KEY || "",
        "x-inkar-timestamp": timestamp, "x-inkar-nonce": nonce,
        "x-inkar-signature": commerceSignature(secret, timestamp, nonce, path, raw),
      }, body: raw,
    });
  } catch { throw new StandardNCommerceError(502, "medusa_commerce_unavailable"); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 256 * 1024) throw new StandardNCommerceError(502, "medusa_commerce_invalid_response");
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new StandardNCommerceError(502, "medusa_commerce_invalid_response"); }
  if (!response.ok) {
    const error = data && typeof data === "object" ? ((data as Record<string, unknown>).error ?? (data as Record<string, unknown>).code) : null;
    const code = typeof error === "string" && /^[a-z][a-z0-9_]{2,80}$/.test(error) ? error : "medusa_commerce_failed";
    throw new StandardNCommerceError(response.status >= 500 ? 502 : response.status, code);
  }
  return data as T;
}
export function validStandardNQuote(value: unknown, items: CanonicalCheckoutItem[], now = Date.now()): value is StandardNQuote {
  if (!value || typeof value !== "object") return false;
  const q = value as StandardNQuote, expiry = Date.parse(q.expiresAt);
  if (typeof q.quoteToken !== "string" || q.quoteToken.length < 16 || q.quoteToken.length > 32768
      || typeof q.snapshotId !== "string" || !q.snapshotId || q.snapshotId.length > 256
      || !Number.isFinite(expiry) || expiry <= now || expiry > now + 10 * 60_000
      || q.currency !== "KZT" || kztMinorUnits(q.total) === null || q.total <= 0
      || q.total !== q.subtotal || !q.pharmacy || !/^sloc_[A-Za-z0-9]+$/.test(q.pharmacy.id)
      || typeof q.pharmacy.name !== "string" || typeof q.pharmacy.city !== "string" || !q.pharmacy.city.trim()
      || !Array.isArray(q.lines) || q.lines.length !== items.length
      || !Array.isArray(q.adjustments) || q.adjustments.length !== 0) return false;
  const expected = new Map(items.map(item => [item.variantId, item]));
  let total = 0;
  for (const line of q.lines) {
    const item = expected.get(line?.variantId);
    const source = item ? checkoutItemSource(item) : null;
    const validWareId = Boolean(item && line) && (source === "daribar"
      ? /^[A-Za-z0-9._:-]{1,96}$/.test(line.wareId)
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.wareId));
    if (!item || line.productId !== item.productId || line.quantity !== item.quantity
        || !validWareId
        || !Number.isFinite(line.availableQuantity) || line.availableQuantity < line.quantity
        || kztMinorUnits(line.unitPrice) === null || line.unitPrice <= 0
        || kztMinorUnits(line.total) === null || kztMinorUnits(line.total) !== kztMinorUnits(line.unitPrice)! * line.quantity) return false;
    expected.delete(line.variantId); total += kztMinorUnits(line.total)!;
  }
  return expected.size === 0 && Number.isSafeInteger(total) && total === kztMinorUnits(q.total);
}
export async function requestStandardNQuote(input: {
  items: CanonicalCheckoutItem[]; fulfillment: CheckoutFulfillment;
  preferredPharmacy?: { id?: string; sourceCode?: string; address?: string; city?: string } | null;
}): Promise<StandardNQuote> {
  const result = await medusaCommerce<unknown>("/store/standardn/quote", input);
  if (!validStandardNQuote(result, input.items)) throw new StandardNCommerceError(502, "medusa_commerce_invalid_response");
  return result;
}
