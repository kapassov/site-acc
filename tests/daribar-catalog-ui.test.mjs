import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { catalogPageProgress, catalogPaginationItems } from "../src/components/catalog/catalog-pagination.ts";
import { CATALOG_NAVIGATION_TREE, catalogNavigationNode } from "../src/components/catalog/catalog-navigation.ts";

const product = (id) => ({ id, slug: id, name: id });

test("catalogue pages share Medusa pagination and its real category tree", async () => {
  const [catalogPage, categoryPage, categoryTreeRoute, catalogView] = await Promise.all([
    readFile(new URL("../src/app/catalog/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/catalog/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/category-tree/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/catalog/CatalogView.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [catalogPage, categoryPage]) {
    assert.match(source, /getMedusaCatalogPage/);
    assert.match(source, /getMedusaNavigation/);
    assert.doesNotMatch(source, /getDaribar|daribar\/catalog/);
    assert.match(source, /initialPageVerified=\{catalogPage !== null\}/);
    assert.match(source, /initialFacets=\{catalogPage\?\.facets \?\? null\}/);
  }
  assert.match(categoryTreeRoute, /getCatTree/);
  assert.match(categoryTreeRoute, /"x-catalog-source": "medusa"/);
  assert.doesNotMatch(categoryTreeRoute, /daribar/);
  assert.match(catalogView, /initialFacets\?: CatalogFacets \| null/);
  assert.match(catalogView, /useState<CatalogFacets \| null>\(initialFacets\)/);
});

test("Daribar catalogue keeps a stable category navigation without provider reads", () => {
  assert.equal(CATALOG_NAVIGATION_TREE.length, 10);
  assert.equal(catalogNavigationNode("mama-i-malysh")?.name, "Мама и малыш");
  assert.equal(catalogNavigationNode("zagar-i-zashita-ot-solnca")?.name, "Солнцезащита");
  assert.equal(catalogNavigationNode("missing"), null);
  assert.ok(CATALOG_NAVIGATION_TREE.every((node) => node.children.length === 0));
});

test("catalog pagination continues when a page contributes new products and advances", () => {
  const progress = catalogPageProgress(
    [product("one"), product("two")],
    [product("two"), product("three")],
    24,
    48,
    true,
  );

  assert.deepEqual(progress.freshProducts.map(({ id }) => id), ["three"]);
  assert.equal(progress.nextOffset, 48);
  assert.equal(progress.hasMore, true);
});

test("catalog pagination stops on empty, repeated or non-advancing provider pages", () => {
  const existing = [product("one"), product("two")];

  assert.equal(catalogPageProgress(existing, [], 24, 48, true).hasMore, false);
  assert.equal(catalogPageProgress(existing, [product("one"), product("two")], 24, 48, true).hasMore, false);

  const stalled = catalogPageProgress(existing, [product("three")], 24, 24, true);
  assert.equal(stalled.nextOffset, 24);
  assert.equal(stalled.hasMore, false);
});

test("numbered catalogue pagination stays compact at the beginning, middle and end", () => {
  assert.deepEqual(catalogPaginationItems(1, 20), [1, 2, 3, 4, "ellipsis-4-20", 20]);
  assert.deepEqual(catalogPaginationItems(10, 20), [1, "ellipsis-1-9", 9, 10, 11, "ellipsis-11-20", 20]);
  assert.deepEqual(catalogPaginationItems(20, 20), [1, "ellipsis-1-17", 17, 18, 19, 20]);
});
