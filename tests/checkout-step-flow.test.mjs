import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("checkout follows cart, pharmacy price, fulfilment and payment in that order", async () => {
  const [cart, checkout] = await Promise.all([
    read("../src/app/cart/page.tsx"),
    read("../src/app/checkout/page.tsx"),
  ]);
  assert.match(cart, /checkoutHref = "\/checkout\?step=pharmacy"/);
  assert.match(checkout, /type CheckoutStep = "pharmacy" \| "delivery" \| "payment"/);
  assert.match(checkout, /if \(step === "pharmacy"\) \{[\s\S]*if \(!selectedPharmacy\)[\s\S]*moveToStep\("delivery"\)/);
  assert.match(checkout, /if \(step === "delivery"\) \{[\s\S]*if \(!quote \|\| quoteLoading \|\| quoteError\)[\s\S]*moveToStep\("payment"\)/);
  assert.match(checkout, /step === "pharmacy" && <Section title=\{flow\.pharmacy\}>/);
  assert.match(checkout, /step === "delivery" && <Section title=\{t\("co\.s2"\)\}/);
  assert.match(checkout, /step === "payment" && <Section title=\{t\("co\.s3"\)\}/);
  assert.match(checkout, /step === "payment" \? mobileAction : flow\.next/);
});

test("pharmacy selection owns the goods price; courier cannot change the pharmacy invisibly", async () => {
  const checkout = await read("../src/app/checkout/page.tsx");
  assert.match(checkout, /point\.total/);
  assert.match(checkout, /const goods = quote\?\.subtotal \?\? selectedPharmacy\?\.total \?\? quotedFallback/);
  assert.match(checkout, /const courierMode = "pharmacy" as const/);
  assert.match(checkout, /preferredPharmacy: selectedPharmacy \? \{/);
  assert.match(checkout, /pharmacyId: selectedPharmacy\?\.sourceCode/);
  assert.match(checkout, /nextQuote\.pharmacy\?\.id !== selectedPharmacy\.sourceCode/);
  assert.match(checkout, /Math\.abs\(nextQuote\.subtotal - selectedPharmacy\.total\) >= 1/);
  assert.match(checkout, /if \(step === "pharmacy" \|\| !citySelectionReady/);
  assert.match(checkout, /setLivePharmacies\(null\);\s+setPharmacy\(null\);\s+setFormError\("quoteChanged"\)/);
  assert.match(checkout, /quoteId: quote\.id/);
});

test("cash-only pharmacies stay discoverable before payment and a payment switch forces a fresh selection", async () => {
  const [checkout, options] = await Promise.all([
    read("../src/app/checkout/page.tsx"),
    read("../src/app/api/checkout/pickup-options/route.ts"),
  ]);
  assert.match(checkout, /step === "pharmacy" && <Section[\s\S]*flow\.paymentFilter/);
  assert.match(checkout, /setPayment\("cash"\); setPharmacy\(null\); setQuote\(null\)/);
  assert.match(checkout, /paymentMethod: effectivePaymentMethod/);
  assert.match(checkout, /setPayment\("cash"\); moveToStep\("pharmacy"\)/);
  assert.match(options, /paymentMethod = body\?\.paymentMethod === "cash" \? "cash" : "card"/);
});

test("promo field stays unavailable until own discount rules can be priced and verified", async () => {
  const [checkout, orderRoute] = await Promise.all([
    read("../src/app/checkout/page.tsx"),
    read("../src/app/api/checkout/route.ts"),
  ]);
  assert.match(checkout, /step === "delivery" && <Section title=\{flow\.promo\}>/);
  assert.match(checkout, /id="checkout-promo" type="text" disabled/);
  assert.doesNotMatch(checkout, /promoCode:/);
  assert.match(orderRoute, /promo_not_supported/);
});
