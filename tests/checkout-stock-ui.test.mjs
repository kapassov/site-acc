import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PAGE = new URL("../src/app/checkout/page.tsx", import.meta.url);
const CART = new URL("../src/lib/cart/CartContext.tsx", import.meta.url);

test("checkout renders server-confirmed quantity for every quote line", async () => {
  const source = await readFile(PAGE, "utf8");

  assert.match(source, /availableQuantity: number/);
  assert.match(source, /\(quote\?\.lines \?\? \[\]\)\.map/);
  assert.match(source, /checkoutText\(copy\.orderLine\.inCart, \{ quantity: line\.quantity \}\)/);
  assert.match(source, /line\.availableQuantity/);
  assert.match(source, /copy\.availability\.confirmed/);
  assert.match(source, /copy\.availability\.failed/);
  assert.match(source, /cart_item_unavailable/);
  assert.match(source, /stale_cart/);
  assert.match(source, /selectedItems,[\s\S]*selectedSubtotal,[\s\S]*selectedCount,[\s\S]*removeSelected,/);
  assert.doesNotMatch(source, /items: selectedItems|clear: removeSelected/);
  assert.match(source, /copy\.legacyNotice\.text/);
});

test("Medusa cart never mixes or guesses old Daribar products", async () => {
  const source = await readFile(CART, "utf8");

  assert.match(source, /inkar-cart-v3-daribar/);
  assert.match(source, /STORAGE_KEY = "inkar-cart-v4-medusa"/);
  assert.match(source, /validCartItemForProvider/);
  assert.match(source, /provider/);
  assert.doesNotMatch(source, /localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.doesNotMatch(source, /fetch\("\/api\/cart"/);
  assert.match(source, /legacyItemsRemoved/);
});
