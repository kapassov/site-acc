import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("delivery pharmacy uses the map-and-list dialog rather than a native select", async () => {
  const [checkout, picker] = await Promise.all([
    readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/checkout/PharmacyMapPicker.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(checkout, /<select id="checkout-courier-pharmacy"/);
  assert.match(checkout, /aria-haspopup="dialog"/);
  assert.match(checkout, /mode=\{delivery === "courier"/);
  assert.match(picker, /role="dialog" aria-modal="true"/);
  assert.match(picker, /type="search"/);
  assert.match(picker, /filteredPoints\.map/);
  assert.match(picker, /disabled=\{!pts\[sel\] \|\| !selectedVisible\}/);
  assert.match(picker, /onPick\(pts\[sel\], sel\)/);
});
