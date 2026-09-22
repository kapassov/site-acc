import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop checkout does not repeat registration contact fields", async () => {
  const source = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");

  assert.match(source, /<div className="lg:hidden">\s*<Section title=\{t\("co\.s1"\)\}>/);
  assert.match(source, /window\.matchMedia\("\(min-width: 1024px\)"\)/);
  assert.match(source, /desktopCheckout \? formatPhone\(user\?\.phone \?\? ""\) : displayedPhone/);
  assert.match(source, /desktopTitle=\{copy\.section\.delivery\}/);
  assert.match(source, /const desktopSteps = \[copy\.fulfillment, copy\.payment\]/);
});
