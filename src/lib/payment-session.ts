import type { CheckoutAttemptForActor } from "./checkout-attempts.ts";
import { safeDaribarPaymentUrl } from "./daribar/checkout.ts";
import { kztMinorUnits } from "./money.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT_KZT = 100_000_000;
const MAX_ITEMS = 2_970;
export const PAYMENT_SESSION_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export type PaymentSessionMetadata = {
  orderId: string;
  orderNumber?: number;
  providerOrderId: string;
  amount: number;
  currency: "KZT";
  itemsCount: number;
};

export type ResolvedPaymentSession = {
  metadata: PaymentSessionMetadata;
  redirect: string;
};

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function positiveInteger(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
    ? Number(value)
    : null;
}

/**
 * Converts the private durable replay into the two views needed by the payment
 * flow. The hosted-provider URL stays in the server-only result and is never
 * part of `metadata`, which is the only object returned by the GET endpoint.
 */
export function resolvePaymentSession(
  sessionId: string,
  attempt: CheckoutAttemptForActor | null,
  now = Date.now(),
): ResolvedPaymentSession | null {
  if (!UUID.test(sessionId)
      || !attempt
      || attempt.id !== sessionId
      || attempt.state !== "replay"
      || !Number.isFinite(attempt.retainUntil)
      || attempt.retainUntil <= now
      || attempt.response?.status !== 202) return null;

  const payload = attempt.response.payload;
  if (payload.requiresAction !== true || payload.paymentSessionId !== sessionId) return null;

  const orderId = boundedText(payload.orderId, 256);
  const providerOrderId = boundedText(payload.providerOrderId, 256);
  const minor = kztMinorUnits(payload.amount);
  const amount = minor !== null && minor > 0 && minor <= MAX_AMOUNT_KZT * 100 ? minor / 100 : null;
  const itemsCount = positiveInteger(payload.itemsCount, MAX_ITEMS);
  const orderNumber = payload.orderNumber == null
    ? null
    : positiveInteger(payload.orderNumber, Number.MAX_SAFE_INTEGER);
  const redirect = safeDaribarPaymentUrl(payload.redirect);
  if (!orderId
      || !providerOrderId
      || providerOrderId !== attempt.providerOrderId
      || !amount
      || !itemsCount
      || (payload.orderNumber != null && !orderNumber)
      || payload.currency !== "KZT"
      || !redirect) {
    return null;
  }

  return {
    metadata: {
      orderId,
      ...(orderNumber ? { orderNumber } : {}),
      providerOrderId,
      amount,
      currency: "KZT",
      itemsCount,
    },
    redirect,
  };
}

/**
 * Validates the private replay without treating an expired site-side retention
 * window as proof that the provider order disappeared. Recovery remains
 * bounded to recent orders and must be followed by an actor-bound renewal in
 * the durable store before a redirect is issued.
 */
export function recoverExpiredPaymentSession(
  sessionId: string,
  attempt: CheckoutAttemptForActor | null,
  now = Date.now(),
): ResolvedPaymentSession | null {
  if (!attempt
      || !Number.isFinite(attempt.createdAt)
      || attempt.createdAt > now
      || attempt.createdAt + PAYMENT_SESSION_RECOVERY_MAX_AGE_MS <= now
      || !Number.isFinite(attempt.retainUntil)
      || attempt.retainUntil > now) {
    return null;
  }
  return resolvePaymentSession(sessionId, attempt, attempt.retainUntil - 1);
}

export function isPaymentSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
