import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pharmacy sync merges the directory with product-backed discovery for test-purchase locations", async () => {
  const source = await readFile(new URL("../scripts/sync-daribar-pharmacies.mjs", import.meta.url), "utf8");
  assert.match(source, /диклофен\.\*ампул\|\^шприц\\b\|салфет\.\*спирт/);
  assert.match(source, /availability: "partial"/);
  assert.match(source, /\.\.\.directory\.filter/);
  assert.match(source, /\.\.\.discovered/);
  assert.doesNotMatch(source, /if \(directory\.length\) return directory/);
  assert.match(source, /\.slice\(0, 30\)/);
});
