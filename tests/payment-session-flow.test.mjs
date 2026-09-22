import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolvePaymentSession } from "../src/lib/payment-session.ts";

const SESSION_ID = "6a80706d-2911-44b4-812e-8dc80f14c13a";

function replay(overrides = {}) {
  return {
    id: SESSION_ID,
    state: "replay",
    providerOrderId: "provider-42",
    retainUntil: 4_000_000_000_000,
    response: {
      status: 202,
      payload: {
        requiresAction: true,
        paymentSessionId: SESSION_ID,
        orderId: "order-42",
        orderNumber: 42,
        providerOrderId: "provider-42",
        amount: 12_345,
        currency: "KZT",
        itemsCount: 3,
        redirect: "https://secure.kassa.com/pay/opaque-token",
      },
    },
    ...overrides,
  };
}

test("payment session exposes server totals but keeps the provider URL out of metadata", () => {
  const session = resolvePaymentSession(SESSION_ID, replay());
  assert.deepEqual(session?.metadata, {
    orderId: "order-42",
    orderNumber: 42,
    providerOrderId: "provider-42",
    amount: 12_345,
    currency: "KZT",
    itemsCount: 3,
  });
  assert.equal(session?.redirect, "https://secure.kassa.com/pay/opaque-token");
  assert.doesNotMatch(JSON.stringify(session?.metadata), /kassa|redirect|opaque-token/i);
});

test("payment session accepts only an owned completed 202 replay with a safe URL", () => {
  assert.equal(resolvePaymentSession("c87aa267-ce53-4ee4-a783-60ef0c4b3099", replay()), null);
  assert.equal(resolvePaymentSession(SESSION_ID, replay({ state: "pending" })), null);
  assert.equal(resolvePaymentSession(SESSION_ID, replay({ retainUntil: 1 }), 2), null);
  assert.equal(resolvePaymentSession(SESSION_ID, replay({ providerOrderId: "provider-other" })), null);
  assert.equal(resolvePaymentSession(SESSION_ID, replay({ response: { status: 201, payload: {} } })), null);
  assert.equal(resolvePaymentSession(SESSION_ID, replay({
    response: {
      status: 202,
      payload: { ...replay().response.payload, redirect: "https://evil.example/pay" },
    },
  })), null);
});

test("payment session routes authenticate ownership and reveal URL only through POST 303", async () => {
  const metadataRoute = await readFile(
    new URL("../src/app/api/payment/session/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const continueRoute = await readFile(
    new URL("../src/app/api/payment/session/[id]/continue/route.ts", import.meta.url),
    "utf8",
  );
  const recoveryRoute = await readFile(
    new URL("../src/app/api/checkout/recover/route.ts", import.meta.url),
    "utf8",
  );
  const paymentPage = await readFile(
    new URL("../src/app/payment/[sessionId]/PaymentPageClient.tsx", import.meta.url),
    "utf8",
  );
  const server = await readFile(
    new URL("../src/lib/payment-session-server.ts", import.meta.url),
    "utf8",
  );
  const store = await readFile(
    new URL("../src/lib/checkout-attempts.ts", import.meta.url),
    "utf8",
  );

  assert.match(metadataRoute, /NextResponse\.json\(result\.session\.metadata/);
  assert.doesNotMatch(metadataRoute, /result\.session\.redirect/);
  assert.match(continueRoute, /NextResponse\.redirect\(result\.session\.redirect, 303\)/);
  assert.match(metadataRoute, /"referrer-policy": "no-referrer"/);
  assert.match(metadataRoute, /vary: "Cookie, Authorization"/);
  assert.match(metadataRoute, /"x-robots-tag": "noindex, nofollow, noarchive"/);
  assert.match(continueRoute, /"cache-control": "private, no-store, max-age=0"/);
  assert.match(continueRoute, /isSameOriginBrowserPost\(request\)/);
  assert.match(continueRoute, /request\.headers\.get\("x-forwarded-host"\)/);
  assert.match(continueRoute, /request\.headers\.get\("x-forwarded-proto"\)/);
  assert.match(continueRoute, /const expected = publicRequestOrigin\(request\)/);
  assert.match(continueRoute, /NextResponse\.json\(\{ error: "invalid_payment_request" \}/);
  assert.match(server, /daribarCustomerActorKey\(profile\.phone\)/);
  assert.match(server, /readCheckoutAttemptForActor\(sessionId, actorKey\)/);
  assert.match(store, /WHERE id = \$1 AND actor_key = \$2/);
  assert.match(server, /bearerAccess \? "" : \(cookieStore\.get\(DARIBAR_REFRESH_COOKIE\)/);
  assert.match(recoveryRoute, /authenticateCheckoutActorForRequest\(request\)/);
  assert.match(recoveryRoute, /readCheckoutAttemptByKeyForActor\(idempotencyKey, auth\.actorKey\)/);
  assert.match(recoveryRoute, /resolveOrRenewPaymentSessionForActor\(attempt\.id, auth\.actorKey, attempt\)/);
  assert.match(recoveryRoute, /paymentSessionId: attempt\.id/);
  assert.doesNotMatch(recoveryRoute, /session\.redirect|payload.*redirect|redirect.*payload/);
  assert.doesNotMatch(recoveryRoute, /createDaribar|medusaCommerce|fetch\(/);
  assert.match(paymentPage, /fetch\(`\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}`/);
  assert.match(paymentPage, /const continueAction = `\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}\/continue`/);
  assert.match(paymentPage, /<form method="post" action=\{continueAction\} target="_blank"/);
  assert.doesNotMatch(paymentPage, /session\.redirect|paymentUrl|kassa\.com/i);
});

test("rotated Daribar cookies survive indistinguishable not-found and unavailable responses", async () => {
  const metadataRoute = await readFile(
    new URL("../src/app/api/payment/session/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const continueRoute = await readFile(
    new URL("../src/app/api/payment/session/[id]/continue/route.ts", import.meta.url),
    "utf8",
  );
  const server = await readFile(
    new URL("../src/lib/payment-session-server.ts", import.meta.url),
    "utf8",
  );

  assert.match(server, /readonly rotatedTokens: DaribarAuthTokens \| null/);
  assert.match(server, /throw authFailure\(error, rotatedTokens\)/);
  assert.match(server, /throw authFailure\(refreshError, rotatedTokens\)/);
  assert.match(server, /new PaymentSessionAccessError\(503, "payment_session_unavailable", rotatedTokens\)/);
  assert.match(server, /new PaymentSessionAccessError\(404, "payment_session_not_found", rotatedTokens\)/);
  for (const route of [metadataRoute, continueRoute]) {
    assert.match(route, /if \(error\.rotatedTokens\) setDaribarAuthCookies\(response, error\.rotatedTokens\)/);
    assert.match(route, /NextResponse\.json\(\{ error: error\.code \}/);
    assert.doesNotMatch(route, /sessionId.*error|error.*sessionId/);
  }
});

test("checkout returns an opaque internal session and never its private replay URL", async () => {
  const route = await readFile(
    new URL("../src/app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );
  const content = await readFile(
    new URL("../src/lib/content/ContentContext.tsx", import.meta.url),
    "utf8",
  );
  const paymentPage = await readFile(
    new URL("../src/app/payment/[sessionId]/PaymentPageClient.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /redirect: (?:daribarOrder\.paymentUrl|kassa\.redirect)/);
  assert.match(route, /paymentSessionId: durableAttemptId/);
  assert.match(route, /await completeCheckoutAttempt\(durableAttemptId,[\s\S]*?payload,/);
  assert.match(route, /respond\(publicPaymentSessionPayload\(payload\)!, 202\)/);
  assert.match(route, /function publicPaymentSessionPayload/);
  assert.doesNotMatch(route.match(/function publicPaymentSessionPayload[\s\S]*?\n\}/)?.[0] || "", /redirect,/);
  assert.match(route, /durableAttemptId = attempt\.attemptId/);
  assert.match(route, /const PAYMENT_SESSION_RETAIN_MS = 24 \* 60 \* 60_000/);
  assert.equal((route.match(/retainMs: PAYMENT_SESSION_RETAIN_MS/g) || []).length, 2);
  assert.doesNotMatch(route, /status: 202[^\n]*retainMs: 2 \* 60 \* 60_000/);
  assert.match(content, /safePaymentSessionId\(data\?\.paymentSessionId\)/);
  assert.match(content, /window\.location\.assign\(`\/payment\/\$\{encodeURIComponent\(paymentSessionId\)\}`\)/);
  assert.match(paymentPage, /const continueAction = `\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}\/continue`/);
  assert.match(paymentPage, /<form method="post" action=\{continueAction\} target="_blank"/);
  assert.doesNotMatch(paymentPage, /session\.redirect|paymentUrl|kassa\.com/i);
  assert.match(content, /paymentSessionId,/);
  assert.match(content, /safePaymentSessionId\(previous\.paymentSessionId\)/);
  assert.doesNotMatch(content, /data\?\.redirect/);
});
