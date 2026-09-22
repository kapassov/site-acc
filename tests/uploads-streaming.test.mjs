import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTE = new URL("../src/app/api/uploads/[name]/route.ts", import.meta.url);

test("upload HEAD has a metadata-only path with an authoritative size ceiling", async () => {
  const source = await readFile(ROUTE, "utf8");
  assert.match(source, /export async function HEAD/);
  assert.match(source, /await fs\.stat/);
  assert.match(source, /info\.size > MAX_PUBLIC_UPLOAD_BYTES/);
  assert.doesNotMatch(source, /fs\.readFile/);
});

test("upload GET streams instead of buffering the complete file", async () => {
  const source = await readFile(ROUTE, "utf8");
  assert.match(source, /createReadStream\(metadata\.filePath\)/);
  assert.match(source, /Readable\.toWeb\(nodeStream\)/);
  assert.doesNotMatch(source, /new Uint8Array\(body\)|arrayBuffer\(\)/);
});
