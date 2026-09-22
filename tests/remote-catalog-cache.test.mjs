import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("remote catalogue pages use a short server cache while PDP stays live", async () => {
  const source = await readFile(new URL("../src/lib/remote-catalog.ts", import.meta.url), "utf8");
  const catalogBlock = source.slice(
    source.indexOf("export async function getRemoteCatalogPayload"),
    source.indexOf("export async function getRemoteProducts"),
  );
  const productBlock = source.slice(
    source.indexOf("export async function getRemoteProduct"),
    source.indexOf("export async function getRemoteCategoryTree"),
  );

  assert.match(catalogBlock, /next:\s*\{\s*revalidate:\s*30\s*\}/);
  assert.doesNotMatch(catalogBlock, /cache:\s*["']no-store["']/);
  assert.match(productBlock, /cache:\s*["']no-store["']/);
});
