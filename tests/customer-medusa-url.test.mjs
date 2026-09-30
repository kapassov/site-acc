import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("customer authentication uses the configured first-party Medusa backend", () => {
  const source = readFileSync("src/app/api/customer/route.ts", "utf8");
  const store = readFileSync("src/lib/medusaStore.ts", "utf8");

  assert.match(source, /medusaStore<\{ token\?: unknown \}>\("\/auth\/customer\/emailpass"/);
  assert.match(source, /"\/store\/customers\/me"/);
  assert.match(store, /secureMedusaBaseUrl\(process\.env\.MEDUSA_URL\)/);
  assert.doesNotMatch(source, /verifyDaribarOtp|getDaribarUser/);
  assert.doesNotMatch(source, /http:\/\/78\.140\.246\.238:9000/);
});
