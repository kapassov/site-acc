import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a priced catalogue item is added to cart and availability is checked later", async () => {
  const card = await readFile(new URL("../src/components/product/ProductCard.tsx", import.meta.url), "utf8");
  assert.match(card, /const canAddToCart = Boolean\(product\.variantId && buyPrice && !confirmedOut\)/);
  assert.match(card, /\{canAddToCart \? \(/);
  assert.match(card, /t\("pdp\.addToCart"\)/);
  assert.doesNotMatch(card, /historicalPrice \? \([\s\S]*?card\.checkAvailability/);
});
