import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("search results keep the query when CatalogView refreshes from the catalog API", async () => {
  const source = await readFile(
    new URL("../src/components/search/SearchResults.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<CatalogView[\s\S]*?searchQuery=\{q\}/);
});
