import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const hero = readFileSync(new URL("../src/components/home/Hero.tsx", import.meta.url), "utf8");
const quickLinks = readFileSync(new URL("../src/components/home/HeroQuickLinks.tsx", import.meta.url), "utf8");

test("homepage promotions use a compact light marketplace composition", () => {
  assert.match(hero, /sm:h-\[360px\]/);
  assert.match(hero, /banner-home-first-aid-wide-v3\.webp/);
  assert.match(hero, /banner-medical-devices-wide-v3\.webp/);
  assert.match(hero, /banner-vitamins-wide-v3\.webp/);
  assert.doesNotMatch(hero, /bg-\[#edf7f2\]\/95/);
  assert.match(hero, /bg-emerald-700/);
  assert.doesNotMatch(hero, /from-black\/45|from-black\/75/);

  assert.match(quickLinks, /CARD_STYLES/);
  assert.match(quickLinks, /lg:h-\[360px\]/);
  assert.match(quickLinks, /sizes="\(max-width: 1023px\) 50vw, 174px"/);
  assert.doesNotMatch(quickLinks, /bg-gradient-to-t|from-black\/75/);
});

test("large banners keep a bounded height and use responsive brand artwork", () => {
  assert.match(hero, /sm:h-\[360px\] sm:aspect-auto/);
  assert.match(hero, /banner-selfielab-wide-v2\.webp/);
  assert.match(hero, /banner-ivatherm-wide-v2\.webp/);
  assert.match(hero, /object-cover min-\[840px\]:hidden/);
  assert.match(hero, /hidden h-full w-full object-cover min-\[840px\]:block/);
  assert.doesNotMatch(hero, /object-contain/);
  assert.doesNotMatch(hero, /scale-\[1\.04\]/);
});

test("homepage banner imagery is product-led and migrates old people photography", () => {
  const defaults = readFileSync(new URL("../src/lib/content/defaults.ts", import.meta.url), "utf8");
  assert.match(defaults, /banner-home-first-aid-products-v2\.webp/);
  assert.match(defaults, /banner-vitamins-products-v2\.webp/);
  assert.match(defaults, /quick-beauty-products-v2\.webp/);
  assert.match(defaults, /quick-baby-products-v2\.webp/);
  assert.match(defaults, /id === "b5" && normalizedImage === "\/promo\/banner-lifestyle-family\.webp"/);
  assert.match(defaults, /id === "b6" && normalizedImage === "\/promo\/banner-lifestyle-wellness\.webp"/);
});
