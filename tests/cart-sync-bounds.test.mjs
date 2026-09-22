import assert from "node:assert/strict";
import test from "node:test";

import {
  CartSyncInputError,
  MAX_CART_SYNC_ITEMS,
  normalizeCartSyncItems,
} from "../src/lib/cartSync.ts";

test("cart sync canonicalizes one bounded mutation per variant", () => {
  assert.deepEqual(normalizeCartSyncItems([
    { variantId: "variant_A1", quantity: 1 },
    { variantId: "variant_A1", quantity: 2 },
    { variantId: "variant_B2", quantity: 500 },
    { variantId: "invalid", quantity: 1 },
  ]), [
    { variantId: "variant_A1", quantity: 2 },
    { variantId: "variant_B2", quantity: 99 },
  ]);
});

test("cart sync rejects arrays beyond the authoritative mutation budget", () => {
  const items = Array.from({ length: MAX_CART_SYNC_ITEMS + 1 }, (_, index) => ({
    variantId: `variant_${index}`,
    quantity: 1,
  }));
  assert.throws(
    () => normalizeCartSyncItems(items),
    (error) => error instanceof CartSyncInputError
      && error.message === "too_many_cart_items",
  );
});
