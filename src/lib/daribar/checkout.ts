import type { CanonicalCheckoutItem } from "../checkoutItems.ts";
import type { CheckoutDeliveryQuote } from "../checkout-delivery.ts";
import type { DeliveryDetails } from "../checkout/delivery-details.ts";
import { DaribarHttpError, daribarJson } from "./client.ts";
import { daribarNetworkCode, daribarPartnerToken, isDaribarEnabled } from "./config.ts";
import {
  DaribarAvailabilityError,
  getDaribarExactPharmacyStock,
} from "./availability.ts";
import { daribarSkuFromProductId, daribarSkuFromVariantId, isDaribarSku } from "./ids.ts";

const MAX_SEARCH_RESULTS = 500;
export const MAX_EXACT_OFFER_CANDIDATES = 4;
const MAX_PRICE_KZT = 100_000_000;
const SOURCE_CODE = /^[A-Za-z0-9._:-]{1,128}$/;

export type DaribarCheckoutLine = {
  productId: string;
  variantId: string;
  sku: string;
  quantity: number;
  availableQuantity: number;
  unitPrice: number;
  total: number;
  wareId?: string;
};

export type DaribarCheckoutOffer = {
  sourceCode: string;
  pharmacy: {
    id: string;
    name: string;
    city: string;
    address?: string;
  };
  lines: DaribarCheckoutLine[];
  total: number;
};

export type DaribarOrderItem = {
  sku: string;
  count_desired: number;
  pharmacy_count: number;
};

export type DaribarOrderOffer = {
  sourceCode: string;
  pharmacy: { city: string };
  lines: Array<Pick<DaribarCheckoutLine, "sku" | "quantity" | "availableQuantity">>;
};

export type DaribarOrderPayload = {
  source: string;
  items: DaribarOrderItem[];
  phone: string;
  payment_method: "interpay" | "in_place";
  delivery_method: string;
  language: "ru";
  user_source: "web" | "mobile_app";
  order_type: "default";
  comment?: string;
  promocode?: string;
  delivery?: {
    type: "ondemand" | "pedestrian" | "slot";
    provider: "yandex" | "choco" | "wolt";
    price: number;
    eta: number;
    on_demand: boolean;
    dst: {
      address: string;
      city: string;
      comment?: string;
      entrance?: string;
      flat?: string;
      floor?: number;
      name: "Дом";
      is_default: false;
    };
    slots: Array<{
      delivery_type: "ondemand" | "pedestrian" | "slot";
      provider: "yandex" | "choco" | "wolt";
      price: number;
      eta: number;
      distance: number;
    }>;
  };
};

export type DaribarOrderResult = {
  id: string;
  status: string;
  paymentUrl?: string;
  paymentUrlRejected?: boolean;
  webLink?: string;
};
export type DaribarOrderWithPaymentLink = DaribarOrderResult & { paymentUrl: string };

type DaribarSearchProduct = {
  sku?: unknown;
  quantity?: unknown;
  base_price?: unknown;
  min_price?: unknown;
  price_with_warehouse_discount?: unknown;
  source_code?: unknown;
  ware_id?: unknown;
};

type DaribarSearchEntry = {
  source?: {
    code?: unknown;
    network_code?: unknown;
    name?: unknown;
    city?: unknown;
    address?: unknown;
  } | null;
  products?: unknown;
};

type DaribarSearchResponse = {
  status?: unknown;
  code?: unknown;
  result?: unknown;
};

export class DaribarCheckoutError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;
  readonly retryAfter?: number;
  readonly definitive: boolean;

  constructor(status: number, code: string, options: {
    traceId?: string; retryAfter?: number; definitive?: boolean;
  } = {}) {
    super(code);
    this.name = "DaribarCheckoutError";
    this.status = status;
    this.code = code;
    this.traceId = options.traceId;
    this.retryAfter = options.retryAfter;
    this.definitive = options.definitive === true;
  }
}

function checkoutHttpError(error: DaribarHttpError): DaribarCheckoutError {
  return new DaribarCheckoutError(error.status, error.code, {
    traceId: error.traceId,
    retryAfter: error.retryAfter,
    definitive: error.definitive,
  });
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function deliveryMethod(provider: CheckoutDeliveryQuote["provider"]): string {
  const configured = safeText(process.env[`DARIBAR_DELIVERY_METHOD_${provider.toUpperCase()}`], 100);
  if (configured) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(configured)) throw new DaribarCheckoutError(503, "daribar_delivery_method_invalid");
    return configured;
  }
  if (provider === "yandex") return "delivery_yandex";
  throw new DaribarCheckoutError(503, "daribar_delivery_method_not_configured");
}

const DEFAULT_PAYMENT_REDIRECT_DOMAINS = ["kassa.com", "kaspi.kz", "daribar.com", "daribar.kz"];

function paymentRedirectDomains(): string[] {
  const configured = String(process.env.DARIBAR_PAYMENT_REDIRECT_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
    .filter((value) => /^[a-z0-9.-]+$/.test(value));
  return [...new Set([...DEFAULT_PAYMENT_REDIRECT_DOMAINS, ...configured])];
}

function allowedPaymentHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return paymentRedirectDomains().some((domain) => (
    normalized === domain || normalized.endsWith(`.${domain}`)
  ));
}

/**
 * Daribar controls the hosted payment page. Only HTTPS URLs on an explicit
 * provider allow-list may ever reach the browser redirect.
 */
export function safeDaribarPaymentUrl(value: unknown): string | undefined {
  const raw = safeText(value, 2_048);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !allowedPaymentHostname(url.hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function sourceCode(value: unknown): string | null {
  const normalized = safeText(value, 128);
  return SOURCE_CODE.test(normalized) ? normalized : null;
}

function positiveInteger(value: unknown, max: number): number | null {
  const numeric = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= max ? numeric : null;
}

function positivePrice(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return Number.isSafeInteger(rounded) && rounded > 0 && rounded <= MAX_PRICE_KZT ? rounded : null;
}

function productPrice(product: DaribarSearchProduct): number | null {
  return positivePrice(product.price_with_warehouse_discount)
    ?? positivePrice(product.base_price)
    ?? positivePrice(product.min_price);
}

function decodedDaribarItems(items: CanonicalCheckoutItem[]): Array<CanonicalCheckoutItem & { sku: string }> | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) return null;
  const decoded: Array<CanonicalCheckoutItem & { sku: string }> = [];
  for (const item of items) {
    const productSku = daribarSkuFromProductId(item.productId);
    const variantSku = daribarSkuFromVariantId(item.variantId);
    if (!productSku || !variantSku || productSku !== variantSku) return null;
    decoded.push({ ...item, sku: productSku });
  }
  return decoded;
}

/**
 * Parses a Daribar pharmacy-search response fail-closed. Only exact requested
 * SKUs with enough stock and a positive server price become checkout offers;
 * analogs can therefore never silently replace an ordered medicine.
 */
export function parseDaribarCheckoutOffers(
  payload: DaribarSearchResponse,
  items: CanonicalCheckoutItem[],
  expectedNetworkCode: string,
  expectedSourceCode?: string,
): DaribarCheckoutOffer[] {
  const requested = decodedDaribarItems(items);
  if (!requested) throw new DaribarCheckoutError(400, "invalid_daribar_items");
  if (payload?.status === "error" || !Array.isArray(payload?.result)) {
    throw new DaribarCheckoutError(502, "daribar_search_invalid_response");
  }
  const expectedNetwork = sourceCode(expectedNetworkCode);
  if (!expectedNetwork) throw new DaribarCheckoutError(500, "invalid_daribar_network");
  const expected = expectedSourceCode ? sourceCode(expectedSourceCode) : null;
  if (expectedSourceCode && !expected) throw new DaribarCheckoutError(400, "invalid_pharmacy_source");

  const offers = new Map<string, DaribarCheckoutOffer>();
  for (const rawEntry of payload.result.slice(0, MAX_SEARCH_RESULTS)) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as DaribarSearchEntry;
    const code = sourceCode(entry.source?.code);
    const network = sourceCode(entry.source?.network_code);
    if (!code
        || network !== expectedNetwork
        || (expected && code !== expected)
        || !Array.isArray(entry.products)) continue;
    const products = entry.products.filter((product): product is DaribarSearchProduct => (
      Boolean(product) && typeof product === "object" && !Array.isArray(product)
    ));
    const lines: DaribarCheckoutLine[] = [];

    for (const item of requested) {
      const candidates = products.flatMap((product) => {
        const sku = typeof product.sku === "string" && isDaribarSku(product.sku)
          ? product.sku
          : null;
        if (sku !== item.sku) return [];
        const productSource = product.source_code == null ? code : sourceCode(product.source_code);
        const availableQuantity = positiveInteger(product.quantity, 1_000_000);
        const unitPrice = productPrice(product);
        if (productSource !== code || !availableQuantity || availableQuantity < item.quantity || !unitPrice) return [];
        const wareId = safeText(product.ware_id, 256);
        return [{ availableQuantity, unitPrice, ...(wareId ? { wareId } : {}) }];
      }).sort((left, right) => left.unitPrice - right.unitPrice || right.availableQuantity - left.availableQuantity);
      const selected = candidates[0];
      if (!selected) break;
      lines.push({
        productId: item.productId,
        variantId: item.variantId,
        sku: item.sku,
        quantity: item.quantity,
        availableQuantity: selected.availableQuantity,
        unitPrice: selected.unitPrice,
        total: selected.unitPrice * item.quantity,
        ...(selected.wareId ? { wareId: selected.wareId } : {}),
      });
    }
    if (lines.length !== requested.length) continue;
    const total = lines.reduce((sum, line) => sum + line.total, 0);
    if (!Number.isSafeInteger(total) || total <= 0) continue;
    const name = safeText(entry.source?.name, 256) || code;
    const city = safeText(entry.source?.city, 128);
    const address = safeText(entry.source?.address, 512);
    const offer: DaribarCheckoutOffer = {
      sourceCode: code,
      pharmacy: { id: code, name, city, ...(address ? { address } : {}) },
      lines,
      total,
    };
    const existing = offers.get(code);
    if (!existing || offer.total < existing.total) offers.set(code, offer);
  }
  return [...offers.values()].sort((left, right) => (
    left.total - right.total || left.pharmacy.name.localeCompare(right.pharmacy.name)
  ));
}

export async function searchDaribarCheckoutOffers(input: {
  items: CanonicalCheckoutItem[];
  city?: string;
  sourceCode?: string;
}): Promise<DaribarCheckoutOffer[]> {
  if (!isDaribarEnabled("pharmacies") && !isDaribarEnabled("order")) {
    throw new DaribarCheckoutError(503, "daribar_checkout_disabled");
  }
  const requested = decodedDaribarItems(input.items);
  if (!requested) throw new DaribarCheckoutError(400, "invalid_daribar_items");
  const city = safeText(input.city, 100) || "Алматы";
  const selectedSource = input.sourceCode ? sourceCode(input.sourceCode) : null;
  if (input.sourceCode && !selectedSource) throw new DaribarCheckoutError(400, "invalid_pharmacy_source");
  const expectedNetwork = sourceCode(daribarNetworkCode());
  if (!expectedNetwork) throw new DaribarCheckoutError(500, "invalid_daribar_network");

  let payload: DaribarSearchResponse;
  try {
    payload = await daribarJson<DaribarSearchResponse>("/api/v2/products/search", {
      method: "POST",
      // Quotes and customer orders must use one environment. This endpoint is
      // public on Daribar production; the stage service token must not influence
      // which pharmacies and stock can become a signed customer quote.
      origin: "auth",
      auth: false,
      query: {
        city,
        sort: "cheap",
        source_code: selectedSource || undefined,
        use_adjustment: true,
        enable_on_site: true,
      },
      body: requested.map((item, index) => ({
        sku: item.sku,
        count_desired: item.quantity,
        priority: requested.length - index,
        replacements: [],
      })),
      timeoutMs: 30_000,
      maxBytes: 12 * 1024 * 1024,
    });
  } catch (error) {
    if (error instanceof DaribarHttpError) {
      throw new DaribarCheckoutError(error.status, error.code);
    }
    throw error;
  }
  return parseDaribarCheckoutOffers(
    payload,
    input.items,
    expectedNetwork,
    selectedSource || undefined,
  );
}

/**
 * Replaces v2 search estimates with exact production stock and price from the
 * selected pharmacy before the offer is signed. The exact lookup remains
 * fail-closed and preserves the v2 ware identifier used by the order flow.
 */
export async function enrichDaribarCheckoutOffer(
  offer: DaribarCheckoutOffer,
): Promise<DaribarCheckoutOffer> {
  let exact;
  try {
    exact = await getDaribarExactPharmacyStock({
      sourceCode: offer.sourceCode,
      city: offer.pharmacy.city,
      items: offer.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    });
  } catch (error) {
    if (error instanceof DaribarAvailabilityError) {
      throw new DaribarCheckoutError(error.status, error.code);
    }
    if (error instanceof DaribarHttpError) {
      throw new DaribarCheckoutError(error.status, error.code);
    }
    throw error;
  }
  if (exact.length !== offer.lines.length) {
    throw new DaribarCheckoutError(502, "daribar_exact_stock_invalid_response");
  }
  const bySku = new Map(exact.map((line) => [line.sku, line]));
  const lines = offer.lines.map((line) => {
    const current = bySku.get(line.sku);
    if (!current
        || current.availableQuantity < line.quantity
        || !Number.isSafeInteger(current.unitPrice)
        || current.unitPrice <= 0) {
      throw new DaribarCheckoutError(409, "cart_item_unavailable");
    }
    return {
      ...line,
      availableQuantity: current.availableQuantity,
      unitPrice: current.unitPrice,
      total: current.unitPrice * line.quantity,
    };
  });
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new DaribarCheckoutError(502, "daribar_exact_stock_invalid_response");
  }
  return { ...offer, lines, total };
}

/**
 * Exact stock can change between Daribar's aggregate v2 search and the
 * per-pharmacy check. Try only a small, already ranked candidate set and move
 * on solely when that pharmacy cannot fulfil the cart. Network failures remain
 * visible instead of multiplying requests during an upstream outage.
 */
export async function firstExactDaribarCheckoutOffer(
  offers: DaribarCheckoutOffer[],
  maxCandidates = MAX_EXACT_OFFER_CANDIDATES,
): Promise<DaribarCheckoutOffer | null> {
  const limit = Number.isSafeInteger(maxCandidates)
    ? Math.max(1, Math.min(MAX_EXACT_OFFER_CANDIDATES, maxCandidates))
    : MAX_EXACT_OFFER_CANDIDATES;
  for (const offer of offers.slice(0, limit)) {
    try {
      return await enrichDaribarCheckoutOffer(offer);
    } catch (error) {
      if (error instanceof DaribarCheckoutError && error.code === "cart_item_unavailable") continue;
      throw error;
    }
  }
  return null;
}

export function daribarOrderItemsFromOffer(offer: DaribarOrderOffer): DaribarOrderItem[] {
  if (!Array.isArray(offer.lines) || offer.lines.length === 0 || offer.lines.length > 30) {
    throw new DaribarCheckoutError(400, "invalid_daribar_order_items");
  }
  return offer.lines.map((line) => {
    if (!isDaribarSku(line.sku)
        || !Number.isSafeInteger(line.quantity)
        || line.quantity < 1
        || line.quantity > 99
        || !Number.isSafeInteger(line.availableQuantity)
        || line.availableQuantity < line.quantity) {
      throw new DaribarCheckoutError(400, "invalid_daribar_order_items");
    }
    return {
      sku: line.sku,
      count_desired: line.quantity,
      pharmacy_count: line.availableQuantity,
    };
  });
}

export function buildDaribarOrderPayload(input: {
  offer: DaribarOrderOffer;
  phone: string;
  delivery: "courier" | "pickup";
  payment: string;
  city?: string;
  address?: string;
  comment?: string;
  promoCode?: string;
  channel?: "web" | "mobile_app";
  deliveryQuote?: CheckoutDeliveryQuote;
  deliveryDetails?: DeliveryDetails | null;
}): DaribarOrderPayload {
  const phoneDigits = String(input.phone || "").replace(/\D/g, "");
  // The deployed Daribar order API validates this field as exactly 11 digits.
  const phone = phoneDigits.length === 11 && phoneDigits.startsWith("7") ? phoneDigits : "";
  const source = sourceCode(input.offer.sourceCode);
  const items = daribarOrderItemsFromOffer(input.offer);
  if (!phone || !source || items.length === 0 || items.length > 30) {
    throw new DaribarCheckoutError(400, "invalid_daribar_order");
  }
  const isPickup = input.delivery === "pickup";
  const address = safeText(input.address, 300);
  const city = safeText(input.city, 100) || input.offer.pharmacy.city || "Алматы";
  if (!isPickup && !address) throw new DaribarCheckoutError(400, "delivery_address_required");
  const comment = safeText(input.comment, 500);
  const promoCode = safeText(input.promoCode, 100);
  const deliveryQuote = input.deliveryQuote;
  if (!isPickup && (!deliveryQuote || deliveryQuote.daribarSourceCode !== source
      || deliveryQuote.orderItems.length !== items.length
      || deliveryQuote.orderItems.some((item, index) => item.sku !== items[index].sku
        || item.countDesired !== items[index].count_desired
        || item.pharmacyCount !== items[index].pharmacy_count))) {
    throw new DaribarCheckoutError(409, "invalid_delivery_quote");
  }
  const payload: DaribarOrderPayload = {
    source,
    items,
    phone,
    payment_method: input.payment === "cash" ? "in_place" : "interpay",
    delivery_method: isPickup ? "self" : deliveryMethod(deliveryQuote!.provider),
    language: "ru",
    user_source: input.channel === "mobile_app" ? "mobile_app" : "web",
    order_type: "default",
    ...(comment ? { comment } : {}),
    ...(promoCode ? { promocode: promoCode } : {}),
  };
  if (!isPickup) {
    const details = input.deliveryDetails;
    const floor = details?.floor && /^-?\d{1,3}$/.test(details.floor)
      ? Math.max(-20, Math.min(200, Number(details.floor)))
      : undefined;
    const deliveryType = deliveryQuote!.deliveryType === "on_demand" ? "ondemand" : deliveryQuote!.deliveryType;
    payload.delivery = {
      type: deliveryType,
      provider: deliveryQuote!.provider,
      price: deliveryQuote!.price,
      eta: deliveryQuote!.eta,
      on_demand: deliveryQuote!.deliveryType === "on_demand",
      dst: {
        address,
        city,
        ...(comment ? { comment } : {}),
        ...(details?.entrance ? { entrance: details.entrance } : {}),
        ...(details?.unit ? { flat: details.unit } : {}),
        ...(floor !== undefined ? { floor } : {}),
        name: "Дом",
        is_default: false,
      },
      slots: [{
        delivery_type: deliveryType,
        provider: deliveryQuote!.provider,
        price: deliveryQuote!.price,
        eta: deliveryQuote!.eta,
        distance: deliveryQuote!.distance,
      }],
    };
  }
  return payload;
}

export async function createDaribarOrder(
  accessToken: string,
  payload: DaribarOrderPayload,
): Promise<DaribarOrderResult> {
  if (!isDaribarEnabled("order")) throw new DaribarCheckoutError(503, "daribar_orders_disabled");
  const token = String(accessToken || "").trim();
  if (token.length < 20 || token.length > 8_192 || /\s/.test(token)) {
    throw new DaribarCheckoutError(401, "daribar_auth_required");
  }
  let response: {
    status?: unknown;
    result?: { id?: unknown; status?: unknown; payment_url?: unknown; web_link?: unknown } | null;
  };
  try {
    const partnerToken = daribarPartnerToken();
    response = await daribarJson("/api/v2/orders", {
      method: "POST",
      // Daribar exposes order creation separately from delivery pricing in
      // some environments. Keep this route independently configurable.
      origin: "order",
      auth: false,
      headers: {
        authorization: `Bearer ${token}`,
        ...(partnerToken ? { "x-partner-token": partnerToken } : {}),
      },
      body: payload,
      timeoutMs: 30_000,
      maxBytes: 256 * 1024,
    });
  } catch (error) {
    if (error instanceof DaribarHttpError) throw checkoutHttpError(error);
    throw error;
  }
  const id = safeText(response?.result?.id, 256);
  if (response?.status !== "success" || !id) {
    throw new DaribarCheckoutError(502, "daribar_order_invalid_response");
  }
  const status = safeText(response.result?.status, 100) || "new";
  const rawPaymentUrl = safeText(response.result?.payment_url, 2_048);
  const paymentUrl = safeDaribarPaymentUrl(rawPaymentUrl);
  const webLink = safeText(response.result?.web_link, 2_048);
  return {
    id,
    status,
    ...(paymentUrl ? { paymentUrl } : {}),
    ...(rawPaymentUrl && !paymentUrl ? { paymentUrlRejected: true } : {}),
    ...(webLink ? { webLink } : {}),
  };
}

/** Card checkout is complete only when Daribar returns a safe hosted payment URL. */
export async function createDaribarOrderWithPaymentLink(
  accessToken: string,
  payload: DaribarOrderPayload,
): Promise<DaribarOrderWithPaymentLink> {
  if (payload.payment_method === "in_place") throw new DaribarCheckoutError(400, "online_payment_required");
  const order = await createDaribarOrder(accessToken, payload);
  if (!order.paymentUrl || order.paymentUrlRejected) throw new DaribarCheckoutError(502, "daribar_payment_link_unavailable");
  return { ...order, paymentUrl: order.paymentUrl };
}
