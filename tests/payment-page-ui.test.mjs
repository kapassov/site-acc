import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { paymentCopy } from "../src/lib/i18n/payment.ts";

const CLIENT = new URL("../src/app/payment/[sessionId]/PaymentPageClient.tsx", import.meta.url);
const PAGE = new URL("../src/app/payment/[sessionId]/page.tsx", import.meta.url);
const HEADER = new URL("../src/components/layout/Header.tsx", import.meta.url);
const TOP_BAR = new URL("../src/components/layout/TopBar.tsx", import.meta.url);
const FOOTER = new URL("../src/components/layout/Footer.tsx", import.meta.url);
const MOBILE_NAV = new URL("../src/components/layout/MobileBottomNav.tsx", import.meta.url);
const WELCOME = new URL("../src/components/layout/WelcomeModal.tsx", import.meta.url);

function flatten(value, prefix = "", result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") result.set(path, item);
    else flatten(item, path, result);
  }
  return result;
}

test("payment copy has complete non-empty RU, KZ and EN parity", () => {
  const reference = flatten(paymentCopy.ru);
  assert.ok(reference.size >= 35, "payment copy unexpectedly lost coverage");
  for (const language of ["ru", "kz", "en"]) {
    const locale = flatten(paymentCopy[language]);
    assert.deepEqual([...locale.keys()].sort(), [...reference.keys()].sort(), `${language} payment keys drifted`);
    for (const [key, value] of locale) assert.ok(value.trim(), `${language}.${key} must not be empty`);
  }
  assert.notEqual(paymentCopy.kz.title, paymentCopy.ru.title);
  assert.notEqual(paymentCopy.en.pay, paymentCopy.ru.pay);
});

test("payment page resolves Next 16 async params and is not indexable", async () => {
  const source = await readFile(PAGE, "utf8");
  assert.match(source, /params: Promise<\{ sessionId: string \}>/);
  assert.match(source, /const \{ sessionId \} = await params/);
  assert.match(source, /robots: \{ index: false, follow: false \}/);
  assert.match(source, /referrer: "no-referrer"/);
});

test("payment UI uses an opaque session and a server-side continue POST", async () => {
  const source = await readFile(CLIENT, "utf8");
  assert.match(source, /fetch\(`\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}`/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /<form method="post" action=\{continueAction\}/);
  assert.match(source, /\/api\/payment\/session\/\$\{encodeURIComponent\(sessionId\)\}\/continue/);
  assert.match(source, /onSubmit=\{beginRedirect\}/);
  assert.doesNotMatch(source, /window\.location|location\.assign|paymentUrl|redirect\s*:/);
  assert.doesNotMatch(source, /sessionStorage|localStorage/);
  assert.doesNotMatch(source, /<input[^>]+(?:card|cvc|cvv)/i);
  assert.doesNotMatch(source, />VISA<|>Mastercard</);
});

test("payment UI covers loading, ready, redirecting and recoverable error states", async () => {
  const source = await readFile(CLIENT, "utf8");
  for (const state of ["loading", "ready", "redirecting", "missing", "auth", "error"]) {
    assert.match(source, new RegExp(`kind: "${state}"`), `${state} state is missing`);
  }
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /compact && "min-h-14/);
  assert.match(source, /actionLabel=\{copy\.signIn\}/);
  assert.match(source, /onAction=\{beginAuthRecovery\}/);
  assert.match(source, /authRecoveryRef = useRef/);
  assert.match(source, /baselineUser: user/);
  assert.match(source, /recovery\.sawModal = true/);
  assert.match(source, /user === recovery\.baselineUser/);
  assert.match(source, /recovery\.armed = false;[\s\S]*?setTimeout\(retry, 0\)/);
  assert.match(source, /copy\.finalAmountHint/);
  assert.match(source, /orderNumber \|\| shortOrderReference\(currentSession\.orderId\)/);
});

test("global storefront chrome and welcome promo stay hidden during payment", async () => {
  const [header, topBar, footer, mobileNav, welcome] = await Promise.all([
    readFile(HEADER, "utf8"),
    readFile(TOP_BAR, "utf8"),
    readFile(FOOTER, "utf8"),
    readFile(MOBILE_NAV, "utf8"),
    readFile(WELCOME, "utf8"),
  ]);
  for (const source of [header, topBar, footer, mobileNav, welcome]) {
    assert.match(source, /\/payment/, "payment route is not suppressed in one global component");
  }
  assert.match(welcome, /if \(paymentFlow \|\| !open\) return null/);
  assert.match(header, /mobileOpen && !compactOrderFlow/);
});
