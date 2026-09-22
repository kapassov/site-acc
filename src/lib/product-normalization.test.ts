import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProductSlug, sourceProductSlug } from "./product-normalization.ts";

test("repairs the known NOW Eve public slug without changing the source handle", () => {
  const slug = canonicalProductSlug("NOW Eve мультивитамины для женщин №90", "aspirin-bayer-100mg");
  assert.equal(slug, "now-eve-multivitaminy-dlya-zhenshchin-90");
  assert.equal(sourceProductSlug(slug), "aspirin-bayer-100mg");
});

test("does not rewrite a genuine aspirin product with the same source handle", () => {
  assert.equal(canonicalProductSlug("Аспирин Bayer 100 мг", "aspirin-bayer-100mg"), "aspirin-bayer-100mg");
});
