import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const header = readFileSync(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const drawer = sourceSection(header, "{/* ── Mobile menu", "</header>");
const drawerEffect = sourceSection(header, "if (!mobileOpen) return;", "}, [mobileOpen]);");
const categoryRows = sourceSection(
  drawer,
  'aria-labelledby="mobile-categories-title"',
  "</section>",
);

test("mobile hamburger opens a bounded portal dialog with accessible modal behavior", () => {
  assert.match(header, /aria-label=\{t\("a11y\.openMenu"\)\}[\s\S]*?aria-expanded=\{mobileOpen\}[\s\S]*?aria-controls="mobile-site-menu"/);
  assert.match(drawer, /createPortal\(/);
  assert.match(drawer, /id="mobile-site-menu"/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-labelledby="mobile-site-menu-title"/);
  assert.match(drawer, /document\.body/);

  const width = drawer.match(/w-\[min\((\d+)vw,\s*\d+px\)\]/);
  assert.ok(width, "the mobile drawer must use a viewport-bounded width");
  assert.ok(Number(width[1]) <= 92, `drawer width must be at most 92vw, received ${width[1]}vw`);
});

test("mobile drawer traps focus, locks page scrolling, and restores both on close", () => {
  assert.match(drawerEffect, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawerEffect, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(drawerEffect, /event\.key === "Escape"[\s\S]*?setMobileOpen\(false\)/);
  assert.match(drawerEffect, /event\.key !== "Tab"/);
  assert.match(drawerEffect, /querySelectorAll<HTMLElement>/);
  assert.match(drawerEffect, /event\.shiftKey[\s\S]*?last\.focus\(\)/);
  assert.match(drawerEffect, /first\.focus\(\)/);
  assert.match(drawerEffect, /mobileCloseRef\.current\?\.focus\(\)/);
  assert.match(drawerEffect, /previousFocus\?\.focus\(\)/);
  assert.match(drawerEffect, /addEventListener\("keydown", handleDialogKeys\)/);
  assert.match(drawerEffect, /removeEventListener\("keydown", handleDialogKeys\)/);
});

test("mobile drawer keeps category navigation lightweight and scrollable", () => {
  assert.match(header, /visibleMobileCategories\s*=\s*mobileMenuCategories\.slice\(0,\s*6\)/);
  assert.match(categoryRows, /visibleMobileCategories\.map/);
  assert.match(categoryRows, /<nav[^>]*>[\s\S]*?className="[^"]*\bflex\b[^"]*\bborder-b\b/);
  assert.doesNotMatch(categoryRows, /grid-cols-[2-9]/);
  assert.match(drawer, /popularMobileCategories\.map/);
  assert.match(drawer, />\{t\("common\.popular"\)\}<\/p>/);
  assert.match(categoryRows, /href="\/catalog"[\s\S]*?>\{t\("common\.openFullCatalog"\)\}</);
  assert.match(drawer, /overflow-y-auto/);
  assert.match(drawer, /safe-area-inset-top/);
  assert.match(drawer, /safe-area-inset-bottom/);
});

test("mobile drawer has no duplicate fixed or sticky action footer", () => {
  assert.doesNotMatch(drawer, /className="[^"]*\b(?:fixed|sticky)\b[^"]*\bbottom-0\b/);
  assert.match(drawer, /aria-labelledby="mobile-personal-title"/);
  assert.match(drawer, /aria-labelledby="mobile-language-title"/);
});

test("mobile personal actions and language are the first scrollable blocks below the logo", () => {
  assert.match(drawer, /<Logo[\s\S]*?<div className="catalog-scrollbar[^"]*">\s*<section[^>]*aria-labelledby="mobile-personal-title"/);
  const personalStart = drawer.indexOf('aria-labelledby="mobile-personal-title"');
  const personalEnd = drawer.indexOf("</section>", personalStart);
  assert.match(drawer.slice(personalEnd), /^<\/section>\s*<section[^>]*aria-labelledby="mobile-language-title"/);

  const languageEnd = drawer.indexOf("</section>", drawer.indexOf('aria-labelledby="mobile-language-title"'));
  for (const marker of [
    'id="mobile-site-menu-title"',
    "<CitySelector",
    "<SearchBar",
    'aria-labelledby="mobile-popular-title"',
    'aria-labelledby="mobile-categories-title"',
  ]) {
    assert.ok(drawer.indexOf(marker) > languageEnd, `${marker} must follow personal actions and language`);
  }
});

test("mobile personal and language blocks appear only once", () => {
  for (const id of ["mobile-personal-title", "mobile-language-title"]) {
    assert.equal(drawer.split(`aria-labelledby="${id}"`).length - 1, 1, `${id} must label exactly one section`);
    assert.equal(drawer.split(`id="${id}"`).length - 1, 1, `${id} must have exactly one heading`);
  }
});

test("relocated mobile actions preserve navigation, auth state, favorite count, and language controls", () => {
  const personal = sourceSection(drawer, 'aria-labelledby="mobile-personal-title"', "</section>");
  assert.match(personal, /href="\/favorites"\s+onClick=\{closeMobileAfterNavigation\}/);
  assert.match(personal, /favCount > 0 && <span className=\{badge\}>\{favCount\}<\/span>/);
  assert.match(personal, /onClick=\{\(\) => \{ setMobileOpen\(false\); openBonus\(\); \}\}/);
  assert.match(personal, /\{user \? \([\s\S]*?href="\/account"\s+onClick=\{closeMobileAfterNavigation\}[\s\S]*?t\("act.account"\)/);
  assert.match(personal, /onClick=\{\(\) => \{ setMobileOpen\(false\); openLogin\(\); \}\}[\s\S]*?t\("act.login"\)/);

  const language = sourceSection(drawer, 'aria-labelledby="mobile-language-title"', "</section>");
  assert.match(language, /langs\.map\(\(l\) =>/);
  assert.match(language, /onClick=\{\(\) => setLang\(l\.code\)\}/);
  assert.match(language, /lang === l\.code \? "bg-white text-brand-700 shadow-sm"/);
  assert.match(language, /aria-pressed=\{lang === l\.code\}/);
  assert.match(language, /\{l\.label\}/);
});
