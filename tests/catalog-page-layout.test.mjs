import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogView = new URL("../src/components/catalog/CatalogView.tsx", import.meta.url);
const catalogPage = new URL("../src/app/catalog/page.tsx", import.meta.url);
const categoryPage = new URL("../src/app/catalog/[slug]/page.tsx", import.meta.url);
const homePage = new URL("../src/app/page.tsx", import.meta.url);

test("catalog and category pages request the same 21-product page size as client pagination", async () => {
  const [view, root, category] = await Promise.all([catalogView, catalogPage, categoryPage].map((url) => readFile(url, "utf8")));
  assert.match(view, /const CATALOG_PAGE_SIZE = 21;/);
  assert.match(view, /limit: String\(CATALOG_PAGE_SIZE\)/);
  assert.match(view, /Math\.ceil\(knownTotalCount \/ CATALOG_PAGE_SIZE\)/);
  assert.match(view, /<CatalogPagination/);
  assert.match(root, /limit: "21"/);
  assert.match(category, /limit: "21"/);
});

test("catalog renders product cards without promotional cells; homepage remains independent", async () => {
  const [view, home] = await Promise.all([catalogView, homePage].map((url) => readFile(url, "utf8")));
  assert.match(view, /filtered\.map\(\(p\) => <ProductCard key=\{p\.id\} product=\{p\} \/>\)/);
  assert.doesNotMatch(view, /catalogPromos|PromoCell/);
  assert.match(home, /Hero|PromoGrid/);
});
