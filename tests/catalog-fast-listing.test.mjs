import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("catalogue listing delegates bounded filtering to Medusa mirror without Daribar hydration", async () => {
  const route = await readFile(new URL("../src/app/api/catalog/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /getDaribar|getRemoteCatalog|daribar\/catalog/);
  assert.match(route, /getMedusaCatalogPage/);
  assert.match(route, /"x-catalog-source": "medusa"/);
  assert.match(route, /cataloguePagination\(page.count, query\)/);
});
