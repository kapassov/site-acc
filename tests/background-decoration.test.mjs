import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const backdrop = fs.readFileSync(
  new URL("../src/components/layout/PharmaBackdrop.tsx", import.meta.url),
  "utf8",
);
const hero = fs.readFileSync(
  new URL("../src/components/home/Hero.tsx", import.meta.url),
  "utf8",
);
const globals = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("site backdrop keeps a subtle static gradient without decorative crosses", () => {
  assert.match(backdrop, /radial-gradient/);
  assert.doesNotMatch(backdrop, /<svg|crosses\.map|pharma-float|pharma-cross/);
});

test("hero and global styles contain no animated pharmacy crosses", () => {
  assert.doesNotMatch(hero, /HeroCross|pharma-float|pharma-cross/);
  assert.doesNotMatch(globals, /pharma-float|pharma-cross/);
});
