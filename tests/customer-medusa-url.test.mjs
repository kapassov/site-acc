import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("customer authentication no longer depends on the retired Medusa origin", () => {
  const source = readFileSync("src/app/api/customer/route.ts", "utf8");

  assert.match(source, /verifyDaribarOtp\(phone, code\)/);
  assert.match(source, /getDaribarUser\(access\)/);
  assert.doesNotMatch(source, /secureMedusaBaseUrl|process\.env\.MEDUSA_URL|MEDUSA_ON/);
  assert.doesNotMatch(source, /http:\/\/78\.140\.246\.238:9000/);
});
