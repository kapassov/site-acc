import { createHash, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { CheckoutQuoteError, verifyCheckoutQuote } from "@/lib/checkoutQuote";
import { canonicalizeCheckoutItems, detectCheckoutItemsSource } from "@/lib/checkoutItems";
import { recordCompletedDaribarOrder, recordCompletedMedusaOrder, updateStoredOrderMetadata } from "@/lib/orders/store";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import {
  DARIBAR_ACCESS_COOKIE, DARIBAR_REFRESH_COOKIE, getDaribarUser,
  refreshDaribarAuth, setDaribarAuthCookies, type DaribarAuthTokens,
} from "@/lib/daribar/auth";
import { DaribarHttpError } from "@/lib/daribar/client";
import { DaribarCheckoutError } from "@/lib/daribar/checkout";
import { createDaribarOrderForQuote } from "@/lib/daribar/quote-order";
import { deliveryDestinationHash, DaribarDeliveryError } from "@/lib/daribar/delivery";
import { createDaribarDeliveryClaim, DaribarDeliveryClaimError } from "@/lib/daribar/delivery-claim";
import { isDaribarDeliveryEnabled, isDaribarEnabled } from "@/lib/daribar/config";
import { daribarCustomerActorKey, daribarCustomerIdFromActorKey } from "@/lib/daribar/customer-identity";
import { createKassaPayment, kassaEnabled } from "@/lib/payments/kassa";
import {
  beginCheckoutAttempt, completeCheckoutAttempt, markCheckoutProviderStarted, releaseCheckoutAttempt,
} from "@/lib/checkout-attempts";
import { medusaCommerce, StandardNCommerceError, type StandardNOrder } from "@/lib/standardn-commerce";
import { canonicalCityName } from "@/lib/i18n/cities";
import { kztMinorUnits } from "@/lib/money";
import { deliveryDetailsComment, normalizeDeliveryDetails } from "@/lib/checkout/delivery-details";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };
const MAX_CHECKOUT_BODY_BYTES = 64 * 1024;
const PAYMENT_SESSION_RETAIN_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cityKey = (value: string) => canonicalCityName(value.normalize("NFKC").trim().replace(/^г\.?\s+/iu, ""))
  .toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
// These errors are contractually raised before native order creation. All other
// provider failures stay uncertain, including 409s during native-order recovery.
const PRE_ORDER_ERRORS = new Set(["quote_invalid_or_expired", "quote_expired", "quote_items_mismatch",
  "quote_fulfillment_mismatch", "quote_city_mismatch", "quote_changed", "snapshot_stale",
  "insufficient_stock", "selected_pharmacy_unavailable", "no_common_pharmacy", "item_unavailable",
  "invalid_order", "invalid_customer", "invalid_checkout", "invalid_items", "stale_source_snapshot",
  "no_pharmacy_can_fulfill_cart", "quote_snapshot_changed", "quote_stock_or_price_changed",
  "verified_customer_required", "invalid_delivery_or_payment",
  "delivery_product_mapping_missing", "delivery_product_mapping_ambiguous",
  "delivery_pharmacy_mapping_missing", "delivery_destination_required",
  "invalid_delivery_quote", "delivery_pharmacy_mismatch", "delivery_price_mismatch",
  "source_import_reconciliation_required", "validated_snapshot_unavailable",
  "site_channel_not_configured", "kzt_region_ambiguous"]);

/** Hosted URLs stay in server-owned replay storage; browser receives only an opaque payment session. */
function publicPaymentSessionPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (payload.requiresAction !== true || typeof payload.paymentSessionId !== "string"
      || !UUID.test(payload.paymentSessionId) || typeof payload.orderId !== "string"
      || typeof payload.providerOrderId !== "string" || kztMinorUnits(payload.amount) === null
      || Number(payload.amount) <= 0 || payload.currency !== "KZT"
      || !Number.isSafeInteger(payload.itemsCount) || Number(payload.itemsCount) < 1) return null;
  const { paymentSessionId, orderId, providerOrderId, amount, currency, itemsCount, orderNumber } = payload;
  return { requiresAction: true, paymentSessionId, orderId, providerOrderId, amount, currency, itemsCount,
    ...(Number.isSafeInteger(orderNumber) ? { orderNumber } : {}) };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_CHECKOUT_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError(400, "invalid_json");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_json" },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE });
  }
  if (!rateLimit(`checkout:${clientIp(req)}`, 6, 10 * 60_000, Date.now())) {
    return NextResponse.json({ error: "too_many_orders" }, { status: 429, headers: NO_STORE });
  }
  const items = canonicalizeCheckoutItems(body?.cartItems ?? body?.items);
  if (!items) return NextResponse.json({ error: "invalid_checkout" }, { status: 400, headers: NO_STORE });
  if (detectCheckoutItemsSource(items) !== "medusa") {
    return NextResponse.json({ error: "stale_cart" }, { status: 409, headers: NO_STORE });
  }
  const delivery = String(body.delivery || "courier"), payment = String(body.payment || "cash");
  const city = String(body.city || "").trim().slice(0, 100);
  const address1 = String(body.address || "").trim().slice(0, 300);
  const name = String(body.name || "Покупатель").trim().slice(0, 100) || "Покупатель";
  const rawComment = String(body.comment || "").trim().slice(0, 500);
  const deliveryDetails = delivery === "courier" ? normalizeDeliveryDetails(body.deliveryDetails) : null;
  const comment = deliveryDetailsComment(deliveryDetails, rawComment);
  if (!["courier", "pickup"].includes(delivery) || !["card", "cash"].includes(payment)
      || !city || (delivery === "courier" && !address1)) {
    return NextResponse.json({ error: "invalid_checkout" }, { status: 400, headers: NO_STORE });
  }
  if (String(body.promoCode || "").trim()) {
    return NextResponse.json({ error: "promo_not_supported" }, { status: 409, headers: NO_STORE });
  }
  const suppliedCartInstanceId = String(body.cartInstanceId || req.headers.get("x-cart-instance-id") || "");
  if (!UUID.test(suppliedCartInstanceId)) {
    return NextResponse.json({ error: "cart_instance_required" }, { status: 400, headers: NO_STORE });
  }
  const rawIdempotency = req.headers.get("x-idempotency-key") || "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(rawIdempotency)) {
    return NextResponse.json({ error: "idempotency_key_required" }, { status: 400, headers: NO_STORE });
  }

  let refreshedTokens: DaribarAuthTokens | null = null;
  const respond = (payload: Record<string, unknown>, status: number) => {
    const response = NextResponse.json(payload, { status, headers: NO_STORE });
    if (refreshedTokens) setDaribarAuthCookies(response, refreshedTokens);
    return response;
  };
  let step = "quote", durableAttemptId = "", providerOrderId = "", providerStarted = false;
  try {
    const verifiedQuote = verifyCheckoutQuote(body.quoteId, items);
    if (!verifiedQuote) return respond({ error: "quote_invalid_or_expired" }, 409);
    const fulfillment = delivery === "pickup" ? "pickup" : "pharmacy";
    if (verifiedQuote.fulfillment !== fulfillment) return respond({ error: "quote_fulfillment_mismatch" }, 409);
    if (cityKey(city) !== cityKey(verifiedQuote.pharmacy.city)) return respond({ error: "quote_city_mismatch" }, 409);
    const daribarCommerceEnabled = isDaribarEnabled("order");
    if (delivery === "courier" && daribarCommerceEnabled) {
      if (!isDaribarDeliveryEnabled() || !verifiedQuote.delivery) return respond({ error: "delivery_quote_required" }, 409);
      if (verifiedQuote.delivery.destinationHash !== deliveryDestinationHash(city, address1)) {
        return respond({ error: "delivery_destination_changed" }, 409);
      }
    }
    if (payment === "card" && !daribarCommerceEnabled && !kassaEnabled()) return respond({ error: "payment_not_configured" }, 503);
    const jar = await cookies();
    const authorization = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    let access = jar.get(DARIBAR_ACCESS_COOKIE)?.value || authorization;
    const refresh = jar.get(DARIBAR_REFRESH_COOKIE)?.value || "";
    step = "daribar_profile";
    if (!access && refresh) {
      refreshedTokens = await refreshDaribarAuth(refresh); access = refreshedTokens.accessToken;
    }
    if (!access) return respond({ error: "daribar_auth_required" }, 401);
    let profile;
    try { profile = await getDaribarUser(access); }
    catch (error) {
      if (!(error instanceof DaribarHttpError) || error.status !== 401 || !refresh) throw error;
      refreshedTokens = await refreshDaribarAuth(refresh);
      profile = await getDaribarUser(refreshedTokens.accessToken);
    }
    // Only the authenticated provider's phone determines customer ownership.
    const secret = process.env.CUSTOMER_AUTH_SECRET || "";
    const actorKey = daribarCustomerActorKey(profile.phone, secret);
    const customerId = daribarCustomerIdFromActorKey(actorKey);
    const cartInstanceKey = createHmac("sha256", secret)
      .update(`cart:${actorKey}:${suppliedCartInstanceId.toLowerCase()}`).digest("hex");
    const emailInput = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) ? emailInput : undefined;
    const shipping = {
      city: verifiedQuote.pharmacy.city, address1: delivery === "pickup" ? verifiedQuote.pharmacy.address || "" : address1,
      postalCode: String(body.postalCode || "").slice(0, 20),
    };
    const cartHash = digest(items);
    const deliveryFee = delivery === "courier" ? verifiedQuote.delivery?.price || 0 : 0;
    // The signed provider payload keeps goods in `total` and delivery in its
    // own block; the public quote combines both only for display.
    const checkoutTotal = verifiedQuote.total + deliveryFee;
    const requestHash = digest({
      provider: daribarCommerceEnabled ? "daribar" : "medusa", items, fulfillment, pharmacyId: verifiedQuote.pharmacy.id,
      lines: verifiedQuote.lines.map(({ productId, variantId, quantity, unitPrice }) => ({ productId, variantId, quantity, unitPrice })),
      total: checkoutTotal, deliveryFee, delivery, payment, shipping, name, email, comment,
    });
    step = "checkout_attempt";
    const attempt = await beginCheckoutAttempt({
      idempotencyKey: rawIdempotency, actorKey, cartInstanceKey, cartHash, requestHash,
    });
    if (attempt.outcome === "replay" || attempt.outcome === "uncertain") {
      const payload = attempt.response.status === 202
        ? publicPaymentSessionPayload(attempt.response.payload) : attempt.response.payload;
      return payload ? respond(payload, attempt.response.status)
        : respond({ error: "payment_session_unavailable", orderCreated: true, recovery: "check_orders" }, 409);
    }
    if (attempt.outcome === "pending") return respond({ error: "checkout_in_progress", recovery: "check_orders" }, 409);
    if (attempt.outcome === "conflict") return respond({ error: "checkout_attempt_conflict" }, 409);
    durableAttemptId = attempt.attemptId;
    step = "medusa_order";
    await markCheckoutProviderStarted(durableAttemptId);
    providerStarted = true;
    if (daribarCommerceEnabled) {
      step = "daribar_order";
      const daribarOrder = await createDaribarOrderForQuote({
        quote: verifiedQuote, items, accessToken: access, phone: profile.phone,
        delivery: delivery as "courier" | "pickup", payment: payment as "card" | "cash",
        city, address: shipping.address1, comment, channel: authorization ? "mobile_app" : "web",
        deliveryDetails,
      });
      providerOrderId = daribarOrder.id;
      step = "persist";
      const hasPaymentLink = payment !== "card"
        || Boolean(daribarOrder.paymentUrl && !daribarOrder.paymentUrlRejected);
      let stored = await recordCompletedDaribarOrder({
        providerOrderId: daribarOrder.id, providerStatus: daribarOrder.status,
        total: checkoutTotal, delivery, customerId,
        items: verifiedQuote.lines.map(line => ({
          product_id: line.productId, variant_id: line.variantId, sku: line.wareId,
          quantity: line.quantity, unit_price: line.unitPrice,
        })),
        metadata: {
          provider: "daribar", provider_order_id: daribarOrder.id,
          channel: authorization ? "mobile" : "web", correlation_id: rawIdempotency,
          fulfillment, snapshot_id: verifiedQuote.snapshotId,
          pharmacy_id: verifiedQuote.pharmacy.id, pharmacy_name: verifiedQuote.pharmacy.name,
          pharmacy_address: verifiedQuote.pharmacy.address || "", quoted_goods_total: verifiedQuote.total,
          delivery_fee: deliveryFee, delivery_provider: verifiedQuote.delivery?.provider,
          delivery_eta: verifiedQuote.delivery?.eta, daribar_source_code: verifiedQuote.delivery?.daribarSourceCode,
           quote_expires_at: verifiedQuote.expiresAt, payment,
           payment_status: payment === "card" ? "pending" : "not_required",
           payment_link_status: payment === "card" ? (hasPaymentLink ? "received" : "missing") : "not_required",
           checkout_state: payment === "card" ? "awaiting_payment" : "booking_delivery",
           delivery_claim_status: delivery === "courier" ? "pending" : "not_required",
          payment_provider: payment === "card" ? "daribar" : undefined,
          city, delivery_address: shipping.address1, phone: profile.phone, email, comment,
          ...(deliveryDetails ? { delivery_details: deliveryDetails } : {}),
        },
      });
      // Daribar returns the hosted payment URL from POST /orders. Validate that
      // contract before the independent courier-claim call so a later delivery
      // error cannot hide the real payment state or turn it into an "unknown"
      // order. The URL itself remains only in private checkout-attempt storage.
      if (payment === "card" && !hasPaymentLink) {
        stored = await updateStoredOrderMetadata(stored.id, {
          checkout_state: "action_required",
          payment_link_status: daribarOrder.paymentUrlRejected ? "rejected" : "missing",
          payment_link_failed_at: new Date().toISOString(),
        }).catch(() => null) || stored;
        const payload = { error: "payment_link_unavailable", orderCreated: true,
          providerOrderId, recovery: "check_orders" };
        step = "durable_finalize";
        await completeCheckoutAttempt(durableAttemptId, {
          state: "replay", status: 502, payload, providerOrderId, retainMs: 24 * 60 * 60_000,
        });
        return respond(payload, 502);
      }
      let deliveryClaimPending = false;
      if (delivery === "courier" && verifiedQuote.delivery) {
        step = "daribar_delivery_claim";
        try {
          const claim = await createDaribarDeliveryClaim({
            accessToken: access,
            orderId: daribarOrder.id,
            quote: verifiedQuote.delivery,
            city,
            address: shipping.address1,
            phone: profile.phone,
            name,
            orderPrice: checkoutTotal,
            comment,
            deliveryDetails,
          });
          stored = await updateStoredOrderMetadata(stored.id, {
            delivery_claim_status: claim.status,
            delivery_claim_id: claim.id,
            delivery_claim_provider: claim.provider,
            delivery_claim_price: claim.price,
            delivery_claim_valid_until: claim.validUntil,
            delivery_tracking_url: claim.trackingUrl,
            delivery_claim_confirmation: payment === "card" ? "after_payment" : "manual_review",
          }) || stored;
        } catch (claimError) {
          const claimStatus = claimError instanceof DaribarDeliveryClaimError ? claimError.status : 502;
          const claimCode = claimError instanceof DaribarDeliveryClaimError ? claimError.code : "delivery_claim_failed";
          const claimTraceId = claimError instanceof DaribarDeliveryClaimError ? claimError.traceId : undefined;
          console.warn("[checkout] delivery claim failed after order creation", {
            status: claimStatus, reason: claimCode, providerOrderId,
            ...(claimTraceId ? { traceId: claimTraceId } : {}),
          });
          stored = await updateStoredOrderMetadata(stored.id, {
            delivery_claim_status: "failed",
            delivery_claim_error: claimCode,
            delivery_claim_retry: payment === "card" ? "after_payment" : "manual_review",
            delivery_claim_failed_at: new Date().toISOString(),
            checkout_state: payment === "card" ? "awaiting_payment" : "action_required",
            ...(claimTraceId ? { delivery_claim_trace_id: claimTraceId } : {}),
          }).catch(() => null) || stored;
          deliveryClaimPending = true;
          // Online payment and courier booking are separate Daribar contracts.
          // If POST /orders already returned a valid hosted payment URL, keep
          // the order payable and leave the courier claim for reconciliation
          // after payment. Cash orders cannot safely continue without a claim.
          if (payment !== "card") {
            const payload = {
              error: "delivery_booking_failed", orderCreated: true, providerOrderId,
              deliveryClaimPending: true, recovery: "check_orders",
            };
            step = "durable_finalize";
            await completeCheckoutAttempt(durableAttemptId, {
              state: "replay", status: 502, payload, providerOrderId,
            });
            return respond(payload, 502);
          }
        }
        step = "persist";
      }
      const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);
      if (payment === "card") {
        // Narrowing is repeated here because the provider result type keeps the
        // field optional. The branch above has already made absence terminal.
        if (!daribarOrder.paymentUrl || daribarOrder.paymentUrlRejected) throw new Error("payment_link_unavailable");
        const payload = {
          requiresAction: true, redirect: daribarOrder.paymentUrl, paymentSessionId: durableAttemptId,
          orderId: stored.id, orderNumber: stored.n, providerOrderId,
          amount: checkoutTotal, currency: "KZT", itemsCount,
          ...(deliveryClaimPending ? { deliveryClaimPending: true } : {}),
        };
        step = "durable_finalize";
        await completeCheckoutAttempt(durableAttemptId, { state: "replay", status: 202, payload, providerOrderId, retainMs: PAYMENT_SESSION_RETAIN_MS });
        jar.delete("ms_cart");
        return respond(publicPaymentSessionPayload(payload)!, 202);
      }
      const payload = { order: { id: stored.id, n: stored.n, date: stored.date, sum: stored.sum,
        status: stored.status, items: stored.items, code: stored.code || "", delivery: stored.delivery },
        providerOrderId, adminSync: "stored" };
      step = "durable_finalize";
      await completeCheckoutAttempt(durableAttemptId, { state: "replay", status: 201, payload, providerOrderId, retainMs: 24 * 60 * 60_000 });
      jar.delete("ms_cart");
      return respond(payload, 201);
    }
    const result = await medusaCommerce<{ order: StandardNOrder }>("/store/standardn/orders", {
      idempotencyKey: durableAttemptId, quoteToken: verifiedQuote.quoteToken, items,
      customer: { externalId: actorKey, phone: profile.phone, name, ...(email ? { email } : {}) },
      delivery, payment, address: shipping, comment,
    });
    const order = result?.order;
    if (!order || typeof order.id !== "string" || !/^order_[A-Za-z0-9]+$/.test(order.id)
        || Number(order.total) !== verifiedQuote.total || String(order.currency_code).toLowerCase() !== "kzt"
        || !Array.isArray(order.items)) throw new StandardNCommerceError(502, "medusa_order_invalid_response");
    providerOrderId = order.id;
    step = "persist";
    const stored = await recordCompletedMedusaOrder({
      order, delivery, customerId, fallbackTotal: verifiedQuote.total,
      fallbackItems: verifiedQuote.lines.map(line => ({
        product_id: line.productId, variant_id: line.variantId, quantity: line.quantity,
        unit_price: line.unitPrice, sku: line.wareId,
      })),
      metadata: {
        provider: "medusa", provider_order_id: order.id, channel: authorization ? "mobile" : "web",
        correlation_id: rawIdempotency, fulfillment, snapshot_id: verifiedQuote.snapshotId,
        pharmacy_id: verifiedQuote.pharmacy.id, pharmacy_name: verifiedQuote.pharmacy.name,
        pharmacy_address: verifiedQuote.pharmacy.address || "", quoted_goods_total: verifiedQuote.total,
        quote_expires_at: verifiedQuote.expiresAt, payment, payment_status: "pending",
        payment_provider: payment === "card" ? "kassa.com" : undefined,
        medusa_customer_id: order.customer_id, city, delivery_address: shipping.address1,
        phone: profile.phone, email, comment,
        ...(deliveryDetails ? { delivery_details: deliveryDetails } : {}),
      },
    });
    const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (payment === "card") {
      step = "kassa_payment";
      const kassa = await createKassaPayment(stored);
      const payload = {
        requiresAction: true, redirect: kassa.redirect, paymentSessionId: durableAttemptId,
        orderId: stored.id, orderNumber: stored.n, providerOrderId, amount: verifiedQuote.total,
        currency: "KZT", itemsCount,
      };
      step = "durable_finalize";
      await completeCheckoutAttempt(durableAttemptId, {
        state: "replay", status: 202, payload, providerOrderId, retainMs: PAYMENT_SESSION_RETAIN_MS,
      });
      jar.delete("ms_cart");
      return respond(publicPaymentSessionPayload(payload)!, 202);
    }
    const payload = {
      order: { id: stored.id, n: stored.n, date: stored.date, sum: stored.sum, status: stored.status,
        items: stored.items, code: stored.code || "", delivery: stored.delivery },
      providerOrderId, adminSync: "stored",
    };
    step = "durable_finalize";
    await completeCheckoutAttempt(durableAttemptId, { state: "replay", status: 201, payload, providerOrderId, retainMs: 24 * 60 * 60_000 });
    jar.delete("ms_cart");
    return respond(payload, 201);
  } catch (error) {
    const status = error instanceof StandardNCommerceError || error instanceof CheckoutQuoteError
      ? error.status : error instanceof DaribarHttpError ? (error.status === 401 ? 401 : 502) : 502;
    const providerError = error instanceof DaribarCheckoutError || error instanceof DaribarDeliveryError
      || error instanceof DaribarDeliveryClaimError;
    const responseStatus = providerError ? error.status : status;
    const code = error instanceof StandardNCommerceError || error instanceof CheckoutQuoteError || providerError ? error.code
      : error instanceof DaribarHttpError && error.status === 401 ? "daribar_auth_required" : "checkout_failed";
    // Medusa receives the same durable idempotency key, but never automatically
    // recreate an order if its response or local payment persistence is uncertain.
    // A named backend pre-order guard is definitive even when it uses 503
    // (translated to 502 by the transport). Unknown failures remain uncertain.
    const reportedPreOrderFailure = step === "daribar_order"
      && error instanceof DaribarCheckoutError && error.definitive;
    const definitelyBeforeOrder = (step === "medusa_order" || step === "daribar_order")
      && (PRE_ORDER_ERRORS.has(code) || reportedPreOrderFailure);
    const uncertain = Boolean(providerOrderId) || (providerStarted && !definitelyBeforeOrder);
    const traceId = error instanceof DaribarHttpError || error instanceof DaribarCheckoutError
      || error instanceof DaribarDeliveryClaimError ? error.traceId : undefined;
    console.error("[checkout] request failed", { step, status: responseStatus, reason: code,
      ...(traceId ? { traceId } : {}), ...(providerOrderId ? { providerOrderId } : {}) });
    if (uncertain && durableAttemptId) {
      const payload = { error: "order_status_uncertain", orderCreated: providerOrderId ? true : null,
        ...(providerOrderId ? { providerOrderId } : {}), recovery: "check_orders" };
      await completeCheckoutAttempt(durableAttemptId, { state: "uncertain", status: 502, payload,
        ...(providerOrderId ? { providerOrderId } : {}) }).catch(() => {});
      return respond(payload, 502);
    }
    if (durableAttemptId) await releaseCheckoutAttempt(durableAttemptId).catch(() => {});
    const publicCode = step === "daribar_order" && error instanceof DaribarCheckoutError
      ? (error.status === 401 ? "daribar_auth_required" : error.definitive ? "daribar_order_rejected" : code)
      : code;
    return respond({ error: publicCode, step }, responseStatus);
  }
}
