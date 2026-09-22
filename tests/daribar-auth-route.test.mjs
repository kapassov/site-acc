import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sendRoute = readFileSync("src/app/api/otp/send/route.ts", "utf8");
const customerRoute = readFileSync("src/app/api/customer/route.ts", "utf8");
const daribarAuth = readFileSync("src/lib/daribar/auth.ts", "utf8");

test("OTP send route is Daribar-only with no local-code fallback", () => {
  assert.match(sendRoute, /sendDaribarOtp\(phone\)/);
  assert.doesNotMatch(sendRoute, /genCode|reserveCode|sendSms|P1SMS/);
});

test("customer login verifies Daribar and stores only server cookies", () => {
  assert.match(customerRoute, /tokens = await verifyDaribarOtp\(phone, code\)/);
  assert.match(customerRoute, /setDaribarAuthCookies\(response, tokens\)/);
  assert.doesNotMatch(customerRoute, /getOrCreatePhone|store\/customers|withToken/);
});

test("logout and successful account deletion clear Daribar cookies", () => {
  assert.match(customerRoute, /function clearSession/);
  assert.match(customerRoute, /clearDaribarAuthCookies\(response\)/);
  const clears = customerRoute.match(/clearSession\(response\)/g) || [];
  assert.ok(clears.length >= 2);
});

test("Daribar auth follows the documented SMS and token contracts", () => {
  assert.match(daribarAuth, /"\/api\/v2\/sms"/);
  assert.match(daribarAuth, /body: \{ phone, sms_type: "auth" \}/);
  assert.match(daribarAuth, /"\/api\/v2\/auth"/);
  assert.doesNotMatch(daribarAuth, /X-Turnstile-Token|\/api\/v1\/(?:web\/)?users\/sms/);
  assert.match(daribarAuth, /"\/api\/v1\/logout"/);
  assert.match(daribarAuth, /validation_code: normalizedCode/);
});

test("Daribar credentials stay in HttpOnly server cookies", () => {
  assert.match(daribarAuth, /httpOnly: true/);
  assert.match(daribarAuth, /DARIBAR_ACCESS_COOKIE/);
  assert.match(daribarAuth, /DARIBAR_REFRESH_COOKIE/);
  assert.doesNotMatch(daribarAuth, /NEXT_PUBLIC_DARIBAR/);
  assert.doesNotMatch(customerRoute, /accessToken[^\n]+NextResponse\.json/);
  assert.doesNotMatch(customerRoute, /refreshToken[^\n]+NextResponse\.json/);
});
