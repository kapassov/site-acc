import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalizeCheckoutItems,
  checkoutItemSource,
  detectCheckoutItemsSource,
} from "../src/lib/checkoutItems.ts";

test("checkout canonicalizes duplicate variant lines before pricing and order creation", () => {
  assert.deepEqual(
    canonicalizeCheckoutItems([
      { productId: "prod_A1", variantId: "variant_V1", quantity: 2 },
      { product_id: "prod_A1", variant_id: "variant_V1", quantity: 3 },
      { productId: "prod_B2", variantId: "variant_V2", quantity: 1 },
    ]),
    [
      { productId: "prod_A1", variantId: "variant_V1", quantity: 5 },
      { productId: "prod_B2", variantId: "variant_V2", quantity: 1 },
    ],
  );
});

test("checkout rejects duplicate quantities that exceed the per-variant limit", () => {
  assert.equal(
    canonicalizeCheckoutItems([
      { productId: "prod_A1", variantId: "variant_V1", quantity: 60 },
      { productId: "prod_A1", variantId: "variant_V1", quantity: 40 },
    ]),
    null,
  );
});

test("one quantity-99 line is accepted while the former 4,950-unit collision is rejected", () => {
  assert.deepEqual(
    canonicalizeCheckoutItems([
      { productId: "prod_A1", variantId: "variant_V1", quantity: 99 },
    ]),
    [{ productId: "prod_A1", variantId: "variant_V1", quantity: 99 }],
  );
  assert.equal(
    canonicalizeCheckoutItems(Array.from({ length: 50 }, () => ({
      productId: "prod_A1",
      variantId: "variant_V1",
      quantity: 99,
    }))),
    null,
  );
});

test("checkout rejects rounded, defaulted, or otherwise ambiguous quantities", () => {
  for (const quantity of [0, -1, 1.5, Number.NaN, "not-a-number"]) {
    assert.equal(
      canonicalizeCheckoutItems([
        { productId: "prod_A1", variantId: "variant_V1", quantity },
      ]),
      null,
    );
  }
});

test("checkout accepts paired Daribar IDs and derives source from the IDs", () => {
  const productId = "prod_DaribarU0tVLTEyM18";
  const variantId = "variant_DaribarU0tVLTEyM18";
  assert.deepEqual(
    canonicalizeCheckoutItems([{ productId, variantId, quantity: 2 }]),
    [{ productId, variantId, quantity: 2 }],
  );
  assert.equal(checkoutItemSource({ productId, variantId }), "daribar");
  assert.equal(detectCheckoutItemsSource([{ productId, variantId }]), "daribar");
});

test("checkout rejects forged Daribar variant pairs and detects mixed providers", () => {
  assert.equal(canonicalizeCheckoutItems([{
    productId: "prod_DaribarU0tVLTE",
    variantId: "variant_DaribarU0tVLTI",
    quantity: 1,
  }]), null);
  assert.equal(detectCheckoutItemsSource([
    { productId: "prod_A1", variantId: "variant_V1" },
    { productId: "prod_DaribarU0tVLTE", variantId: "variant_DaribarU0tVLTE" },
  ]), "mixed");
});

test("checkout route sends only signed Medusa lines to every order sink", async () => {
  const source = await readFile(
    new URL("../src/app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const items = canonicalizeCheckoutItems\(body\?\.cartItems \?\? body\?\.items\)/);
  assert.match(source, /quoteToken: verifiedQuote\.quoteToken, items,/);
  assert.match(source, /recordCompletedMedusaOrder\(\{[\s\S]*?fallbackItems: verifiedQuote\.lines\.map/);
  assert.doesNotMatch(source, /recordCompletedStorefrontOrder/);
  assert.match(source, /createDaribarOrderForQuote/);
  assert.match(source, /recordCompletedDaribarOrder\(\{[\s\S]*?items: verifiedQuote\.lines\.map/);
  assert.doesNotMatch(source, /Math\.round\(Number\(value\.quantity\)/);
});

test("checkout bounds and validates JSON before processing order fields", async () => {
  const source = await readFile(
    new URL("../src/app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );

  const boundedRead = source.indexOf("readBoundedJson<unknown>");
  const firstOrderField = source.indexOf("body?.cartItems");
  assert.ok(boundedRead >= 0);
  assert.ok(firstOrderField > boundedRead);
  assert.match(source, /MAX_CHECKOUT_BODY_BYTES = 64 \* 1024/);
  assert.match(source, /error instanceof RequestBodyError \? error\.status : 400/);
});

test("legacy order endpoint cannot persist client-supplied price or status", async () => {
  const source = await readFile(
    new URL("../src/app/api/orders/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /createOrder|body\.sum|body\.items/);
  assert.match(source, /legacy_order_endpoint_disabled/);
  assert.match(source, /status:\s*410/);
});

test("ambiguous payment failures are sanitized and block duplicate checkout", async () => {
  const route = await readFile(
    new URL("../src/app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/app/checkout/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /const uncertain = Boolean\(providerOrderId\)/);
  assert.match(route, /"order_status_uncertain"/);
  assert.match(route, /step = "kassa_payment"/);
  assert.match(route, /"payment_session_unavailable"/);
  assert.doesNotMatch(route, /message:\s*error instanceof Error \? error\.message/);
  assert.match(page, /\["order_status_uncertain", "checkout_attempt_conflict"\]\.includes\(error\.message\)/);
  assert.match(page, /error\.message === "payment_link_unavailable"/);
  assert.match(page, /const checkoutRecoverable = formError === "orderStatusUncertain"/);
  assert.match(page, /checkoutRecoverable[\s\S]*?copy\.action\.retryOrderStatus/);
  assert.match(page, /type="submit"[\s\S]*?copy\.action\.retryOrderStatus/);
  assert.match(page, /disabled=\{checkoutBlocked \|\| submitting/);
  assert.match(page, /href="\/account\/orders"/);
  assert.doesNotMatch(page, /copy\.payment\.switchToCash/);
});

test("checkout safely replays a stored attempt key instead of creating a second Daribar order", async () => {
  const content = await readFile(
    new URL("../src/lib/content/ContentContext.tsx", import.meta.url),
    "utf8",
  );
  const cart = await readFile(
    new URL("../src/lib/cart/CartContext.tsx", import.meta.url),
    "utf8",
  );
  const checkoutPage = await readFile(
    new URL("../src/app/checkout/page.tsx", import.meta.url),
    "utf8",
  );
  const paymentPage = await readFile(
    new URL("../src/app/payment/[sessionId]/PaymentPageClient.tsx", import.meta.url),
    "utf8",
  );

  assert.match(content, /CHECKOUT_ATTEMPT_KEY = "ass_checkout_attempt_v3"/);
  assert.match(cart, /CART_INSTANCE_KEY = "inkar-cart-instance-v4-medusa"/);
  assert.match(cart, /STORAGE_KEY = "inkar-cart-v4-medusa"/);
  assert.match(content, /previous\?\.cartInstanceId === o\.cartInstanceId/);
  assert.match(content, /localStorage\.setItem\(CHECKOUT_ATTEMPT_KEY/);
  assert.doesNotMatch(content, /CHECKOUT_ATTEMPT_TTL_MS/);
  assert.match(content, /previous\.state === "pending" \|\| previous\.state === "uncertain"/);
  assert.match(content, /fetch\("\/api\/checkout\/recover"/);
  assert.match(content, /headers: \{ "x-idempotency-key": attempt\.key \}/);
  assert.match(content, /await recoverHostedPayment\(previous\)/);
  assert.match(content, /recoverableAttempt = \{ \.\.\.previous, requestHash, cartHash \}/);
  assert.match(content, /const attempt: StoredCheckoutAttempt = recoverableAttempt/);
  assert.match(content, /\{ \.\.\.recoverableAttempt, state: "pending", updatedAt: Date\.now\(\) \}/);
  assert.match(checkoutPage, /\["order_status_uncertain", "checkout_attempt_conflict"\]\.includes\(error\.message\)/);
  assert.match(content, /"x-idempotency-key": attempt\.key/);
  assert.match(content, /"x-cart-instance-id": o\.cartInstanceId/);
  assert.match(content, /code === "checkout_in_progress"/);
  assert.match(content, /data\?\.recovery === "check_orders"/);
  assert.match(content, /safePaymentSessionId\(data\?\.paymentSessionId\)/);
  assert.match(content, /window\.location\.assign\(`\/payment\/\$\{encodeURIComponent\(paymentSessionId\)\}`\)/);
  assert.match(paymentPage, /const continueAction = `\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}\/continue`/);
  assert.match(paymentPage, /<form method="post" action=\{continueAction\} target="_blank"/);
  assert.doesNotMatch(paymentPage, /session\.redirect|paymentUrl|kassa\.com/i);
  assert.doesNotMatch(content, /data\?\.redirect/);
});
