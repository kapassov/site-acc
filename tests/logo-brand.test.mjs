import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("logo renders СО in red and СКЛАДА in green in every shared placement", async () => {
  const source = await readFile(new URL("../src/components/layout/Logo.tsx", import.meta.url), "utf8");

  assert.match(source, /const red = light \? "#ff7a70" : "#e53935"/);
  assert.match(source, /style=\{\{ color: red \}\}>СО<\/span>/);
  assert.match(source, /style=\{\{ color: green \}\}>[^<]*СКЛАДА<\/span>/);
});
