import type { DeliveryDetails } from "../checkout/delivery-details.ts";
import type { CheckoutDeliveryQuote } from "../checkout-delivery.ts";
import { DaribarHttpError, daribarJson } from "./client.ts";
import { daribarPartnerToken, isDaribarDeliveryEnabled } from "./config.ts";

type ClaimProvider = CheckoutDeliveryQuote["provider"];

export type DaribarDeliveryClaimPayload = {
  provider: ClaimProvider;
  order_id: string;
  pharmacy_code: string;
  destination: {
    city: string;
    street: string;
    building?: string;
    flat?: string;
    entrance?: string;
    floor?: string;
    comment?: string;
    contact: { phone: string; name?: string };
  };
  taxi_class?: CheckoutDeliveryQuote["deliveryType"];
  order_price: number;
  comment?: string;
  transport_type?: "CAR" | "FOOT";
  is_fastest?: boolean;
  disable_sms_code: false;
  send_link: false;
  confirm_return: false;
  confirm_start_transfer: false;
};

export type DaribarDeliveryClaim = {
  provider: ClaimProvider;
  id: string;
  status: string;
  price?: number;
  validUntil?: string;
  trackingUrl?: string;
};

export class DaribarDeliveryClaimError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;
  readonly retryAfter?: number;
  readonly definitive: boolean;

  constructor(status: number, code: string, options: {
    traceId?: string; retryAfter?: number; definitive?: boolean;
  } = {}) {
    super(code);
    this.name = "DaribarDeliveryClaimError";
    this.status = status;
    this.code = code;
    this.traceId = options.traceId;
    this.retryAfter = options.retryAfter;
    this.definitive = options.definitive === true;
  }
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function splitStreetAndBuilding(address: string): { street: string; building?: string } {
  const normalized = text(address, 300);
  const matched = normalized.match(/^(.*?)(?:,\s*|\s+)(?:д(?:ом)?\.?\s*)?([0-9][\p{L}\p{N}/-]{0,30})$/iu);
  if (!matched || !text(matched[1], 240)) return { street: normalized };
  return { street: text(matched[1], 240), building: text(matched[2], 40) };
}

function destinationComment(details: DeliveryDetails | null | undefined): string {
  if (!details) return "";
  return [
    details.intercom ? `Домофон/код: ${details.intercom}` : "",
    details.instructions,
    details.leaveAtDoor ? "Оставить у двери" : "",
  ].filter(Boolean).join("; ").slice(0, 300);
}

export function buildDaribarDeliveryClaimPayload(input: {
  accessToken: string;
  orderId: string;
  quote: CheckoutDeliveryQuote;
  city: string;
  address: string;
  phone: string;
  name?: string;
  orderPrice: number;
  comment?: string;
  deliveryDetails?: DeliveryDetails | null;
}): DaribarDeliveryClaimPayload {
  const orderId = text(input.orderId, 256);
  const city = text(input.city, 100);
  const address = splitStreetAndBuilding(input.address);
  const phone = String(input.phone || "").replace(/\D/g, "");
  const name = text(input.name, 100);
  const pharmacyCode = text(input.quote.daribarSourceCode, 128);
  const comment = text(input.comment, 500);
  if (!orderId || !city || !address.street || !/^7\d{10}$/.test(phone)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(pharmacyCode)
      || !Number.isSafeInteger(input.orderPrice) || input.orderPrice <= 0 || input.orderPrice > 100_000_000) {
    throw new DaribarDeliveryClaimError(400, "invalid_delivery_claim", { definitive: true });
  }
  const details = input.deliveryDetails;
  const payload: DaribarDeliveryClaimPayload = {
    provider: input.quote.provider,
    order_id: orderId,
    pharmacy_code: pharmacyCode,
    destination: {
      city,
      ...address,
      ...(details?.unit ? { flat: details.unit } : {}),
      ...(details?.entrance ? { entrance: details.entrance } : {}),
      ...(details?.floor ? { floor: details.floor } : {}),
      ...(destinationComment(details) ? { comment: destinationComment(details) } : {}),
      contact: { phone, ...(name ? { name } : {}) },
    },
    order_price: input.orderPrice,
    ...(comment ? { comment } : {}),
    disable_sms_code: false,
    send_link: false,
    confirm_return: false,
    confirm_start_transfer: false,
  };
  if (input.quote.provider !== "wolt") payload.taxi_class = input.quote.deliveryType;
  if (input.quote.provider === "choco") {
    payload.transport_type = input.quote.deliveryType === "pedestrian" ? "FOOT" : "CAR";
    payload.is_fastest = input.quote.deliveryType === "on_demand";
  }
  return payload;
}

export function parseDaribarDeliveryClaimResponse(
  provider: ClaimProvider,
  value: unknown,
): DaribarDeliveryClaim {
  const response = record(value);
  const result = record(response?.result);
  if (!response || response.status !== "success" || !result) {
    throw new DaribarDeliveryClaimError(502, "delivery_claim_invalid_response");
  }
  if (provider === "yandex") {
    const id = text(result.claim_id, 256), status = text(result.claim_status, 100);
    if (!id || !status) throw new DaribarDeliveryClaimError(502, "delivery_claim_invalid_response");
    const price = typeof result.claim_price === "number" && Number.isFinite(result.claim_price) && result.claim_price >= 0
      ? result.claim_price : undefined;
    const validUntil = text(result.valid_until, 100);
    return { provider, id, status, ...(price !== undefined ? { price } : {}), ...(validUntil ? { validUntil } : {}) };
  }
  if (provider === "choco") {
    const id = text(result.group_id, 256), status = text(result.group_state, 100);
    if (!id || !status) throw new DaribarDeliveryClaimError(502, "delivery_claim_invalid_response");
    return { provider, id, status };
  }
  const id = text(result.wolt_order_reference_id, 256), status = text(result.status, 100) || "created";
  if (!id) throw new DaribarDeliveryClaimError(502, "delivery_claim_invalid_response");
  const price = typeof result.price === "number" && Number.isFinite(result.price) && result.price >= 0
    ? result.price : undefined;
  const trackingUrl = text(result.tracking_url, 2_048);
  return { provider, id, status, ...(price !== undefined ? { price } : {}), ...(trackingUrl ? { trackingUrl } : {}) };
}

export async function createDaribarDeliveryClaim(input: Parameters<typeof buildDaribarDeliveryClaimPayload>[0]): Promise<DaribarDeliveryClaim> {
  if (!isDaribarDeliveryEnabled()) {
    throw new DaribarDeliveryClaimError(503, "delivery_not_enabled", { definitive: true });
  }
  const token = String(input.accessToken || "").trim();
  if (token.length < 20 || token.length > 8_192 || /\s/.test(token)) {
    throw new DaribarDeliveryClaimError(401, "daribar_auth_required", { definitive: true });
  }
  const payload = buildDaribarDeliveryClaimPayload(input);
  try {
    const partnerToken = daribarPartnerToken();
    const response = await daribarJson("/api/v2/delivery/claim", {
      method: "POST",
      origin: "commerce",
      auth: false,
      headers: {
        authorization: `Bearer ${token}`,
        ...(partnerToken ? { "x-partner-token": partnerToken } : {}),
      },
      body: payload,
      timeoutMs: 30_000,
      maxBytes: 256 * 1024,
    });
    return parseDaribarDeliveryClaimResponse(payload.provider, response);
  } catch (error) {
    if (error instanceof DaribarHttpError) {
      throw new DaribarDeliveryClaimError(error.status, error.code, {
        traceId: error.traceId, retryAfter: error.retryAfter, definitive: error.definitive,
      });
    }
    throw error;
  }
}
