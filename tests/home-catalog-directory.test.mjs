import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { catalogNavigationNode } from "../src/components/catalog/catalog-navigation.ts";
import { CATALOG_DIRECTORY } from "../src/lib/catalog-directory.ts";
import { medusaDirectory } from "../src/lib/medusa-directory.ts";
import { daribarCategoryIds, mapDaribarProduct } from "../src/lib/daribar/catalog-data.ts";

test("retired Daribar directory mapping retains its isolated legacy contract", () => {
  assert.ok(CATALOG_DIRECTORY.length >= 8);
  const ids = new Set();
  const handles = new Set();

  for (const group of CATALOG_DIRECTORY) {
    assert.ok(group.children.length >= 3, `${group.handle} must expose useful subcategories`);
    assert.ok(!ids.has(group.id), `duplicate id ${group.id}`);
    assert.ok(!handles.has(group.handle), `duplicate handle ${group.handle}`);
    ids.add(group.id);
    handles.add(group.handle);
    assert.ok(group.daribarIds.every((id) => daribarCategoryIds(group.handle).includes(id)));
    assert.ok(catalogNavigationNode(group.handle), `${group.handle} must have a catalogue route`);

    for (const child of group.children) {
      assert.ok(!("children" in child), `${child.handle} creates an unexpected third level`);
      assert.ok(!ids.has(child.id), `duplicate id ${child.id}`);
      assert.ok(!handles.has(child.handle), `duplicate handle ${child.handle}`);
      assert.match(child.handle, /^[a-z0-9-]+$/);
      ids.add(child.id);
      handles.add(child.handle);
      assert.deepEqual(daribarCategoryIds(child.handle), [...child.daribarIds]);
      assert.equal(catalogNavigationNode(child.handle)?.name, child.name);
    }
  }
});

test("Daribar child category IDs become filterable storefront handles", () => {
  for (const group of CATALOG_DIRECTORY) {
    const child = group.children[0];
    const product = mapDaribarProduct({
      sku: `TEST-${child.daribarIds[0]}`,
      name: `Тестовый товар ${child.name}`,
      manufacturer: "Test",
      categories_ids: [child.daribarIds[0], group.daribarIds[0], "145", "2"],
      min_customer_price: 1_000,
      quantity: 1,
      in_stock: true,
      recipe_needed: "0",
    });
    assert.ok(product?.categoryHandles.includes(child.handle), child.handle);
  }
});

test("two-level directory is the final homepage block and has responsive accessible navigation", async () => {
  const [page, component] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/home/CatalogDirectory.tsx", import.meta.url), "utf8"),
  ]);

  assert.ok(page.indexOf("<CatalogDirectory tree={categoryTree} />") > page.indexOf("<LoyaltyBanner />"));
  assert.match(page, /getCatTree\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(component, /medusaDirectory\(tree\)/);
  assert.doesNotMatch(component, /CATALOG_DIRECTORY|catalog-navigation/);
  assert.match(component, /aria-labelledby="catalog-directory-title"/);
  assert.match(component, /<nav[\s\S]*aria-label=/);
  assert.match(component, /<details/);
  assert.match(component, /<summary/);
  assert.match(component, /md:hidden/);
  assert.match(component, /hidden gap-x-7 gap-y-9 md:grid/);
  assert.doesNotMatch(component, /overflow-x-auto|no-scrollbar/);
  assert.match(component, /min-h-11/);
});

test("public directory uses only supplied native categories, never Daribar child slugs", () => {
  const tree = [{ id: "pcat_MAMA", handle: "mama-i-malysh", name: "Мама и малыш", children: [
    { id: "pcat_FOOD", handle: "native-detskoe-pitanie", name: "Детское питание", children: [
      { id: "pcat_INFANT", handle: "native-infant-food", name: "Смеси", children: [] },
    ] },
  ] }];
  const result = medusaDirectory(tree);
  assert.deepEqual(result, [{ id: "pcat_MAMA", handle: "mama-i-malysh", name: "Мама и малыш", icon: "Baby", children: [
    { id: "pcat_FOOD", handle: "native-detskoe-pitanie", name: "Детское питание" },
  ] }]);
  const oldChild = CATALOG_DIRECTORY.find(group => group.handle === "mama-i-malysh").children[0].handle;
  assert.ok(!result[0].children.some(child => child.handle === oldChild));
  assert.deepEqual(medusaDirectory([]), []);
});

test("directory does not expose pseudo IDs or invent missing category alternatives", () => {
  assert.deepEqual(medusaDirectory([
    { id: "directory-medicines", handle: "lekarstva-i-bady", name: "Лекарства", children: [] },
    { id: "pcat_ROOT", handle: "site", name: "Сайт", children: [] },
    { id: "pcat_MAMA", handle: "mama-i-malysh", name: "Мама и малыш", children: [
      { id: "123", handle: "podguzniki", name: "Подгузники", children: [] },
    ] },
  ]), [{ id: "pcat_MAMA", handle: "mama-i-malysh", name: "Мама и малыш", icon: "Baby", children: [] }]);
});
