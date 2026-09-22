import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalog = readFileSync(new URL("../src/components/catalog/CatalogView.tsx", import.meta.url), "utf8");
const bottomNav = readFileSync(new URL("../src/components/layout/MobileBottomNav.tsx", import.meta.url), "utf8");

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const picker = sourceSection(catalog, "function MobileCategoryPicker", "function DesktopFilterPanel");
const pickerEffect = sourceSection(picker, "if (!open) return;", "}, [open]);");
const pickerDialog = sourceSection(picker, "{open && (", "\n    </div>\n  );\n}");
const toolbar = sourceSection(catalog, 'className="sticky top-[106px]', "      </div>\n\n      {activeFilters");

test("catalog exposes a distinct Categories dialog trigger beside an independent Filters trigger", () => {
  assert.match(picker, /onClick=\{openPicker\}/);
  assert.match(picker, /aria-haspopup="dialog"/);
  assert.match(picker, /aria-expanded=\{open\}/);
  assert.match(picker, /aria-controls="mobile-category-dialog"/);

  assert.match(toolbar, /onClick=\{\(\) => setFiltersOpen\(true\)\}/);
  assert.match(toolbar, /aria-expanded=\{filtersOpen\}/);
  assert.match(toolbar, /<SlidersHorizontal/);
  assert.doesNotMatch(toolbar, /openPicker|mobile-category-dialog/);
});

test("category picker is a bottom sheet above, but not covering, mobile bottom navigation", () => {
  assert.match(pickerDialog, /id="mobile-category-dialog"/);
  assert.match(pickerDialog, /role="dialog"/);
  assert.match(pickerDialog, /aria-modal="true"/);
  assert.match(pickerDialog, /aria-labelledby="mobile-category-title"/);
  assert.match(pickerDialog, /className="[^"]*\bbottom-0\b[^"]*\bmax-h-\[72dvh\]/);

  const sheetOffset = pickerDialog.match(/bottom-\[calc\((.+?)\)\]/)?.[1];
  const navHeight = bottomNav.match(/h-\[calc\((.+?)\)\]/)?.[1];
  assert.ok(sheetOffset, "category overlay must end above the mobile bottom navigation");
  assert.ok(navHeight, "mobile bottom navigation must publish its occupied height");
  assert.equal(sheetOffset, navHeight);

  const sheetZ = Number(pickerDialog.match(/z-\[(\d+)\]/)?.[1]);
  const navZ = Number(bottomNav.match(/z-\[(\d+)\]/)?.[1]);
  assert.ok(Number.isFinite(sheetZ) && Number.isFinite(navZ));
  assert.ok(sheetZ > navZ, `category overlay z-index (${sheetZ}) must exceed bottom nav (${navZ})`);
});

test("category bottom sheet provides search, popular shortcuts, and single-column rows", () => {
  assert.match(pickerDialog, /type="search"/);
  assert.match(pickerDialog, /placeholder=\{t\("catalog\.findCategory"\)\}/);
  assert.match(pickerDialog, />\{t\("catalog\.oftenChosen"\)\}<\/h3>/);
  assert.match(pickerDialog, /popularItems\.map/);
  assert.match(pickerDialog, />\{t\("catalog\.allCategories"\)\}<\/h3>/);
  assert.match(pickerDialog, /matchedItems\.map/);
  assert.match(pickerDialog, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(pickerDialog, /matchedItems\.map[\s\S]*?className=\{cn\([\s\S]*?"flex min-h-14/);
  assert.doesNotMatch(pickerDialog, /grid-cols-[2-9]/);
  assert.match(pickerDialog, /href="\/catalog"[\s\S]*?<span className="flex-1">\{t\("common\.openFullCatalog"\)\}<\/span>/);
});

test("category bottom sheet locks scroll, supports Escape and focus trap, then restores focus", () => {
  assert.match(pickerEffect, /document\.body\.style\.overflow = "hidden"/);
  assert.match(pickerEffect, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(pickerEffect, /event\.key === "Escape"[\s\S]*?setOpen\(false\)/);
  assert.match(pickerEffect, /event\.key !== "Tab"/);
  assert.match(pickerEffect, /getElementById\("mobile-category-dialog"\)/);
  assert.match(pickerEffect, /event\.shiftKey[\s\S]*?last\.focus\(\)/);
  assert.match(pickerEffect, /first\.focus\(\)/);
  assert.match(pickerEffect, /closeRef\.current\?\.focus\(\)/);
  assert.match(pickerEffect, /previousFocus\?\.focus\(\)/);
  assert.match(pickerEffect, /addEventListener\("keydown", handleDialogKeys\)/);
  assert.match(pickerEffect, /removeEventListener\("keydown", handleDialogKeys\)/);
});
