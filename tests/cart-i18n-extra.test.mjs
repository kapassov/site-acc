import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CART_PAGE = new URL("../src/app/cart/page.tsx", import.meta.url);
const ORDER_SUMMARY = new URL("../src/components/cart/OrderSummary.tsx", import.meta.url);
const EMPTY_CART = new URL("../src/components/cart/EmptyCart.tsx", import.meta.url);
const EXTRA_COPY = new URL("../src/lib/i18n/cart-extra.ts", import.meta.url);

test("cart surfaces derive additional copy from the reactive locale", async () => {
  const [page, summary, empty, copy] = await Promise.all([
    readFile(CART_PAGE, "utf8"),
    readFile(ORDER_SUMMARY, "utf8"),
    readFile(EMPTY_CART, "utf8"),
    readFile(EXTRA_COPY, "utf8"),
  ]);

  for (const source of [page, summary, empty]) {
    assert.match(source, /cartExtraCopy\[lang\]/);
  }
  assert.match(copy, /export const cartExtraCopy: Record<Lang, CartExtraCopy>/);
  for (const locale of ["ru", "kz", "en"]) {
    assert.match(copy, new RegExp(`\\n  ${locale}: \\{`));
  }

  assert.doesNotMatch(page, /message: "[^"]+"/);
  assert.match(page, /copy\.alerts\[cartAlert\]/);
});

test("order summary branches on a stable fulfillment kind instead of translated labels", async () => {
  const [page, summary] = await Promise.all([
    readFile(CART_PAGE, "utf8"),
    readFile(ORDER_SUMMARY, "utf8"),
  ]);

  assert.match(page, /fulfillment=\{fulfillment \?\? undefined\}/);
  assert.match(summary, /fulfillment\?: CartFulfillment/);
  assert.match(summary, /fulfillment === "courier"/);
  assert.doesNotMatch(summary, /deliveryLabel ===/);
  assert.doesNotMatch(summary, /=== "Самовывоз"|=== "Доставка"/);
});
