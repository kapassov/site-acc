import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("catalogue listing delegates to the feature-flagged storefront catalogue facade", async () => {
  const route = await readFile(new URL("../src/app/api/catalog/route.ts", import.meta.url), "utf8");
  assert.match(route, /getStorefrontCatalogPage/);
  assert.match(route, /storefrontCatalogSource/);
  assert.match(route, /"x-catalog-source": source/);
  assert.match(route, /cataloguePagination\(page.count, query\)/);
});
