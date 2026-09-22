import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeDaribarPaymentUrl } from "../src/lib/daribar/checkout.ts";

test("Daribar owns payment when enabled and Kassa remains the rollback provider", async () => {
  const route = await readFile(new URL("../src/app/api/checkout/route.ts", import.meta.url), "utf8");
  const daribar = await readFile(new URL("../src/lib/daribar/checkout.ts", import.meta.url), "utf8");

  assert.match(daribar, /input\.payment === "cash" \? "in_place" : "interpay"/);
  assert.match(route, /payment === "card" && !daribarCommerceEnabled && !kassaEnabled\(\)/);
  assert.match(route, /\/store\/standardn\/orders/);
  assert.match(route, /const kassa = await createKassaPayment\(stored\)/);
  assert.match(route, /redirect: kassa\.redirect/);
  assert.match(route, /createDaribarOrderForQuote/);
  assert.match(route, /redirect: daribarOrder\.paymentUrl/);
  assert.match(route, /!\["card", "cash"\]\.includes\(payment\)/);
  assert.match(route, /from ["']@\/lib\/payments\/kassa["']/);
  assert.doesNotMatch(daribar, /payment_method:\s*"in_place"\s*,?\s*\/\/.*external/i);
});

test("Daribar payment redirects require HTTPS on an approved provider domain", () => {
  assert.equal(
    safeDaribarPaymentUrl("https://kassa.com/pay/test-token"),
    "https://kassa.com/pay/test-token",
  );
  assert.equal(
    safeDaribarPaymentUrl("https://secure.kassa.com/pay/test-token"),
    "https://secure.kassa.com/pay/test-token",
  );
  for (const value of [
    "http://kassa.com/pay/test-token",
    "https://kassa.com.evil.example/pay/test-token",
    "https://user:pass@kassa.com/pay/test-token",
    "javascript:alert(1)",
    "not-a-url",
  ]) assert.equal(safeDaribarPaymentUrl(value), undefined);
});
