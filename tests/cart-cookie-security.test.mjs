import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTE = new URL("../src/app/api/cart/route.ts", import.meta.url);

test("Medusa cart bearer cookie is Secure in production", async () => {
  const source = await readFile(ROUTE, "utf8");
  assert.match(source, /const COOKIE_SECURE = process\.env\.NODE_ENV === "production"/);
  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: "lax"/);
  assert.match(source, /secure: COOKIE_SECURE/);
  assert.doesNotMatch(source, /secure:\s*false/);
});
