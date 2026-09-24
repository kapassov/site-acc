import crypto from "node:crypto";
import { isStrongRuntimeSecret } from "./serverSecrets.ts";
import type { CheckoutFulfillment, CheckoutPricingAdjustment } from "./checkoutPricing";
import { canonicalizeCheckoutItems, detectCheckoutItemsSource, type CanonicalCheckoutItem } from "./checkoutItems.ts";
import { validStandardNQuote, type StandardNLine, type StandardNQuote } from "./standardn-commerce.ts";
import type { CheckoutDeliveryQuote, CheckoutDeliveryRequest } from "./checkout-delivery.ts";
import { DaribarDeliveryError } from "./daribar/delivery.ts";
import { isDaribarDeliveryEnabled } from "./daribar/config.ts";
import {
  DaribarStockQuoteError, requestDaribarStockQuote, requestDaribarStockQuotes,
  type DaribarStockQuote,
} from "./daribar/stock-quote.ts";
import { kztMinorUnits } from "./money.ts";

export type QuoteItem = CanonicalCheckoutItem;
export type QuotePharmacy = StandardNQuote["pharmacy"];
export type CheckoutQuoteLine = StandardNLine;
export type CheckoutQuote = {
  id: string; source: "medusa" | "daribar"; subtotal: number; total: number; currency: "KZT";
  expiresAt: string; pharmacy: QuotePharmacy; lines: CheckoutQuoteLine[];
  adjustments: CheckoutPricingAdjustment[];
  delivery?: CheckoutDeliveryQuote;
};
export type SignedQuote = StandardNQuote & {
  version: 4; source: "medusa" | "daribar"; expires: number; itemsHash: string; fulfillment: CheckoutFulfillment;
  delivery?: CheckoutDeliveryQuote;
};
export class CheckoutQuoteError extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function quoteSecret(): string {
  const secret = process.env.CHECKOUT_QUOTE_SECRET || process.env.CUSTOMER_AUTH_SECRET;
  if (!isStrongRuntimeSecret(secret)) throw new CheckoutQuoteError(503, "quote_secret_not_configured");
  return secret;
}
function itemsHash(items: QuoteItem[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(items)).digest("base64url");
}
function encodeQuote(payload: SignedQuote): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${crypto.createHmac("sha256", quoteSecret()).update(encoded).digest("base64url")}`;
}
function retryablePharmacyDeliveryError(error: unknown): error is DaribarDeliveryError {
  return error instanceof DaribarDeliveryError && [
    "delivery_service_unavailable",
    "selected_pharmacy_unavailable",
    "no_delivery_available",
    "delivery_invalid_response",
  ].includes(error.code);
}
export type CheckoutQuoteDependencies = {
  requestStockQuote: typeof requestDaribarStockQuote;
  requestStockQuotes: typeof requestDaribarStockQuotes;
};
const DEFAULT_QUOTE_DEPENDENCIES: CheckoutQuoteDependencies = {
  requestStockQuote: requestDaribarStockQuote,
  requestStockQuotes: requestDaribarStockQuotes,
};
export async function createCheckoutQuote(input: {
  items: QuoteItem[]; fulfillment: CheckoutFulfillment;
  preferredPharmacy?: { id?: string; sourceCode?: string; address?: string; city?: string } | null;
  deliveryRequest?: CheckoutDeliveryRequest | null;
}, dependencies: CheckoutQuoteDependencies = DEFAULT_QUOTE_DEPENDENCIES): Promise<CheckoutQuote> {
  const items = canonicalizeCheckoutItems(input.items);
  if (!items || items.length > 30) throw new CheckoutQuoteError(400, "invalid_quote_items");
  const source = detectCheckoutItemsSource(items);
  if (source !== "medusa" && source !== "daribar") throw new CheckoutQuoteError(409, "stale_cart");
  try {
    // The selected catalogue owns identity. Daribar v3 supplies live stock
    // and native Daribar prices for the selected fulfilment pharmacy.
    const preferredPharmacy = input.preferredPharmacy;
    const quoteCity = String(preferredPharmacy?.city || input.deliveryRequest?.city || "").trim();
    let quote = await dependencies.requestStockQuote({
      items,
      city: quoteCity,
      preferredPharmacyId: preferredPharmacy?.id || preferredPharmacy?.sourceCode,
    });
    let delivery: CheckoutDeliveryQuote | undefined;
    if (isDaribarDeliveryEnabled() && input.fulfillment === "pharmacy") {
      if (!input.deliveryRequest) throw new CheckoutQuoteError(400, "delivery_destination_required");
      if (preferredPharmacy?.id && quote.pharmacy.id !== preferredPharmacy.id) {
        throw new CheckoutQuoteError(409, "delivery_pharmacy_mismatch");
      }
      const { resolveCheckoutDelivery } = await import("./checkout-delivery.ts");
      let resolved: Awaited<ReturnType<typeof resolveCheckoutDelivery>> | undefined;
      try {
        resolved = await resolveCheckoutDelivery(quote, input.deliveryRequest);
      } catch (error) {
        // If the selected pharmacy cannot deliver, try only other pharmacies
        // returned by the same live Daribar v3 full-basket search.
        if (input.deliveryRequest.mode !== "pharmacy" || !retryablePharmacyDeliveryError(error)) throw error;
        const candidates: DaribarStockQuote[] = await dependencies.requestStockQuotes({
          items, city: input.deliveryRequest.city || quote.pharmacy.city, limit: 20,
        });
        let lastError: unknown = error;
        for (const candidate of candidates) {
          if (candidate.quote.pharmacy.id === quote.pharmacy.id) continue;
          try {
            const candidateQuote = candidate.quote;
            const candidateResolved = await resolveCheckoutDelivery(candidateQuote, {
              ...input.deliveryRequest,
              mode: "pharmacy",
              city: candidate.pharmacy.city,
              pharmacyId: candidate.pharmacy.id,
            });
            quote = candidateQuote;
            resolved = candidateResolved;
            break;
          } catch (candidateError) {
            if (retryablePharmacyDeliveryError(candidateError)) {
              lastError = candidateError;
              continue;
            }
            if (candidateError instanceof DaribarStockQuoteError && candidateError.status === 409) {
              lastError = candidateError;
              continue;
            }
            throw candidateError;
          }
        }
        if (!resolved) throw lastError;
      }
      if (resolved.pharmacy.id !== quote.pharmacy.id) {
        quote = await dependencies.requestStockQuote({
          items,
          city: resolved.pharmacy.city,
          preferredPharmacyId: resolved.pharmacy.id,
        });
        if (quote.pharmacy.id !== resolved.pharmacy.id) throw new CheckoutQuoteError(409, "delivery_pharmacy_mismatch");
      }
      const { mapQuoteLinesToDaribar } = await import("./daribar/delivery-mapping.ts");
      const mapped = await mapQuoteLinesToDaribar(quote.lines);
      if (mapped.length !== resolved.delivery.orderItems.length
          || mapped.some((item, index) => item.sku !== resolved.delivery.orderItems[index]?.sku
            || item.countDesired !== resolved.delivery.orderItems[index]?.countDesired)) {
        throw new CheckoutQuoteError(409, "delivery_price_mismatch");
      }
      delivery = resolved.delivery;
    }
    const expiresAt = new Date(Math.min(Date.parse(quote.expiresAt), Date.now() + 3 * 60_000)).toISOString();
    const signed: SignedQuote = {
      ...quote, expiresAt, version: 4, source, expires: Date.parse(expiresAt),
      itemsHash: itemsHash(items), fulfillment: input.fulfillment,
      ...(delivery ? { delivery } : {}),
    };
    const total = quote.total + (delivery?.price || 0);
    return { id: encodeQuote(signed), source, subtotal: quote.subtotal, total,
      currency: "KZT", expiresAt, pharmacy: quote.pharmacy,
      lines: quote.lines, adjustments: [
        ...quote.adjustments,
        ...(delivery ? [{ type: "delivery_fee" as const, provider: delivery.provider, amount: delivery.price }] : []),
      ], ...(delivery ? { delivery } : {}) };
  } catch (error) {
    if (error instanceof DaribarStockQuoteError) throw new CheckoutQuoteError(error.status, error.code);
    if (error instanceof DaribarDeliveryError) throw new CheckoutQuoteError(error.status, error.code);
    throw error;
  }
}

/**
 * Selects one live Daribar pharmacy before an address is entered. This locks
 * the visible goods total before delivery details can change only the courier
 * fee. Checkout still rechecks this exact basket and pharmacy.
 */
export async function createCourierAnchorQuote(input: {
  items: QuoteItem[];
  city: string;
}, dependencies: CheckoutQuoteDependencies = DEFAULT_QUOTE_DEPENDENCIES): Promise<CheckoutQuote> {
  const items = canonicalizeCheckoutItems(input.items);
  if (!items || items.length > 30) throw new CheckoutQuoteError(400, "invalid_quote_items");
  const source = detectCheckoutItemsSource(items);
  if (source !== "medusa" && source !== "daribar") throw new CheckoutQuoteError(409, "stale_cart");
  const city = String(input.city || "").normalize("NFKC").trim().slice(0, 100);
  if (!city) throw new CheckoutQuoteError(400, "delivery_city_required");
  try {
    return createCheckoutQuote({
      items,
      fulfillment: "pickup",
      preferredPharmacy: { city },
    }, dependencies);
  } catch (error) {
    if (error instanceof CheckoutQuoteError) throw error;
    if (error instanceof DaribarStockQuoteError) throw new CheckoutQuoteError(error.status, error.code);
    if (error instanceof DaribarDeliveryError) throw new CheckoutQuoteError(error.status, error.code);
    throw error;
  }
}

function validDelivery(value: CheckoutDeliveryQuote | undefined): boolean {
  if (!value) return true;
  return ["city", "pharmacy"].includes(value.mode)
    && ["yandex", "choco", "wolt"].includes(value.provider)
    && ["on_demand", "pedestrian", "slot"].includes(value.deliveryType)
    && kztMinorUnits(value.price) !== null && value.price >= 0
    && kztMinorUnits(value.itemsPrice) !== null && value.itemsPrice > 0
    && Number.isFinite(value.eta) && value.eta > 0
    && Number.isFinite(value.distance) && value.distance >= 0
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.daribarSourceCode)
    && /^sloc_[A-Za-z0-9]+$/.test(value.pharmacyId)
    && /^[0-9a-f]{64}$/.test(value.destinationHash)
    && Number.isFinite(Date.parse(value.quotedAt))
    && Array.isArray(value.orderItems) && value.orderItems.length > 0 && value.orderItems.length <= 30
    && value.orderItems.every(item => /^[A-Za-z0-9._-]{1,160}$/.test(item.sku)
      && Number.isSafeInteger(item.countDesired) && item.countDesired > 0 && item.countDesired <= 99
      && Number.isSafeInteger(item.pharmacyCount) && item.pharmacyCount >= item.countDesired);
}
export function verifyCheckoutQuote(token: unknown, items: QuoteItem[]): SignedQuote | null {
  const canonical = canonicalizeCheckoutItems(items);
  const source = canonical ? detectCheckoutItemsSource(canonical) : null;
  if (!canonical || (source !== "medusa" && source !== "daribar")
      || typeof token !== "string" || token.length < 32 || token.length > 65536) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, signature] = parts;
  const expected = crypto.createHmac("sha256", quoteSecret()).update(encoded).digest();
  try {
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedQuote;
    if (payload.version !== 4 || payload.source !== source || payload.itemsHash !== itemsHash(canonical)
        || payload.expires !== Date.parse(payload.expiresAt) || !["pharmacy", "pickup"].includes(payload.fulfillment)
        || !validStandardNQuote(payload, canonical) || !validDelivery(payload.delivery)
        || (payload.fulfillment === "pickup" && payload.delivery)
        || (payload.delivery && payload.delivery.pharmacyId !== payload.pharmacy.id)) return null;
    return payload;
  } catch { return null; }
}
