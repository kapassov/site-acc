import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/customer/route.ts", "utf8");
const session = readFileSync("src/lib/customerSession.ts", "utf8");

test("customer authentication has no demo or Daribar runtime branch", () => {
  assert.doesNotMatch(route, /action\s*===\s*["']demo["']/);
  assert.doesNotMatch(route, /customerAuthMode|createDemoSession|readDemoSession/);
  assert.doesNotMatch(route, /verifyDaribarOtp|getDaribarUser|refreshDaribarAuth/);
  assert.match(route, /\/auth\/customer\/emailpass/);
  assert.match(route, /\/store\/customers/);
});

test("OTP establishes an HttpOnly first-party session and returns a token only for an explicit mobile request", () => {
  assert.match(route, /checked = await validateCode\(phone, code\)/);
  assert.match(route, /if \(!await consumeCode\(phone, code\)\)/);
  assert.match(route, /body\.withToken === true \? \{ token: result\.token \} : \{\}/);
  assert.match(route, /response\.cookies\.set\(CUSTOMER_COOKIE, result\.token, cookieOptions\)/);
  assert.doesNotMatch(route, /refreshToken/);
});

test("customer mutations accept only bounded JSON", () => {
  assert.match(route, /readBoundedJson<unknown>\(req, MAX_BODY_BYTES\)/);
  assert.match(route, /const MAX_BODY_BYTES = 8 \* 1024/);
});

test("profile update and deletion remain in our Medusa customer record", () => {
  assert.match(route, /method: "POST", token, body: patch/);
  assert.match(route, /account_deletion_status: "requested"/);
  assert.match(route, /status: "requested"/);
});

test("shared customerSession validates the Medusa token and uses its stable customer id", () => {
  assert.match(session, /\/store\/customers\/me/);
  assert.match(session, /customerId/);
  assert.match(session, /CUSTOMER_COOKIE = "ms_cust"/);
  assert.doesNotMatch(session, /DARIBAR_ACCESS_COOKIE|getDaribarUser/);
});
