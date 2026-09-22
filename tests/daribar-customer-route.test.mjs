import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/customer/route.ts", "utf8");
const session = readFileSync("src/lib/customerSession.ts", "utf8");

test("customer authentication has no demo or Medusa runtime branch", () => {
  assert.doesNotMatch(route, /action\s*===\s*["']demo["']/);
  assert.doesNotMatch(route, /customerAuthMode|createDemoSession|readDemoSession/);
  assert.doesNotMatch(route, /secureMedusaBaseUrl|\/auth\/customer|\/store\/customers/);
  assert.doesNotMatch(session, /MEDUSA_URL|store\/customers\/me|customerAuthMode/);
});

test("OTP verification establishes an HttpOnly Daribar session without exposing tokens", () => {
  assert.match(route, /tokens\s*=\s*await verifyDaribarOtp\(phone, code\)/);
  assert.match(route, /setDaribarAuthCookies\(response, tokens\)/);
  assert.doesNotMatch(route, /withToken|token:\s*tokens\.accessToken/);
  assert.doesNotMatch(route, /refreshToken[^\n]*NextResponse\.json/);
  assert.doesNotMatch(route, /consumeCode|validateCode|getOrCreateCustomer|getOrCreatePhone/);
});

test("customer mutations accept only bounded JSON", () => {
  assert.match(route, /readBoundedJson<unknown>\(req, MAX_BODY_BYTES\)/);
  assert.match(route, /const MAX_BODY_BYTES = 8 \* 1024/);
});

test("current customer validates Daribar profile and refreshes at most once on 401", () => {
  assert.match(route, /getDaribarUser\(access\)/);
  assert.match(route, /providerStatus\(error\) !== 401/);
  assert.match(route, /providerCode\(error\) === "invalid_auth_response"/);
  assert.match(route, /rotated = await refreshDaribarAuth\(refresh\)/);
  assert.match(route, /if \(result\.rotated\) setDaribarAuthCookies\(response, result\.rotated\)/);
});

test("profile update and deletion use Daribar account endpoints", () => {
  assert.match(route, /await updateDaribarUser\(access,/);
  assert.match(route, /await deleteDaribarUser\(access\)/);
  assert.match(route, /status: "deleted"/);
});

test("public customer model does not invent loyalty balances or tiers", () => {
  const mapStart = route.indexOf("function mapDaribarCustomer");
  const mapEnd = route.indexOf("function profileComplete", mapStart);
  const mapper = route.slice(mapStart, mapEnd);
  assert.doesNotMatch(mapper, /bonus|level|Bronze|Silver|Gold|Platinum/);
});

test("shared customerSession validates Daribar and derives the common non-PII stable id", () => {
  assert.match(session, /getDaribarUser\(token\)/);
  assert.match(session, /daribarCustomerId\(phone\)/);
  assert.match(session, /DARIBAR_ACCESS_COOKIE/);
  assert.doesNotMatch(session, /customerId:\s*phone/);
});
