import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sendRoute = readFileSync("src/app/api/otp/send/route.ts", "utf8");
const customerRoute = readFileSync("src/app/api/customer/route.ts", "utf8");
const otpStore = readFileSync("src/lib/otp.ts", "utf8");
const migration = readFileSync("db/migrations/029_customer_otp_challenges.sql", "utf8");

test("OTP is sent by our backend through SMSC and persisted before activation", () => {
  assert.match(sendRoute, /await reserveCode\(phone, code\)/);
  assert.match(sendRoute, /await sendSms\(phone, text\)/);
  assert.match(sendRoute, /await activateCode\(phone, code\)/);
  assert.doesNotMatch(sendRoute, /sendDaribarOtp|verifyDaribarOtp/);
  assert.match(otpStore, /https:\/\/smsc\.kz\/sys\/send\.php/);
});

test("OTP values are stored in our PostgreSQL only as keyed digests", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_otp_challenges/);
  assert.match(migration, /code_digest text NOT NULL/);
  assert.doesNotMatch(migration, /\bcode\s+text/i);
  assert.match(otpStore, /createHmac\("sha256", secret\)/);
  assert.match(otpStore, /ordersDatabasePool\(\)/);
});

test("customer login verifies our OTP and creates a Medusa customer session", () => {
  assert.match(customerRoute, /checked = await validateCode\(phone, code\)/);
  assert.match(customerRoute, /await getOrCreateCustomer\(phone\)/);
  assert.match(customerRoute, /await consumeCode\(phone, code\)/);
  assert.match(customerRoute, /response\.cookies\.set\(CUSTOMER_COOKIE, result\.token, cookieOptions\)/);
  assert.match(customerRoute, /httpOnly: true/);
  assert.doesNotMatch(customerRoute, /verifyDaribarOtp|getDaribarUser|setDaribarAuthCookies|daribar\/auth/);
});

test("login and logout clear legacy Daribar customer cookies", () => {
  assert.match(customerRoute, /function clearLegacySessions/);
  assert.match(customerRoute, /LEGACY_DARIBAR_ACCESS_COOKIE = "daribar_access"/);
  assert.match(customerRoute, /LEGACY_DARIBAR_REFRESH_COOKIE = "daribar_refresh"/);
  const clears = customerRoute.match(/clearLegacySessions\(response\)/g) || [];
  assert.ok(clears.length >= 3);
});

test("contact email cannot replace the synthetic authentication identifier", () => {
  assert.match(customerRoute, /contact_email: email \|\| null/);
  assert.doesNotMatch(customerRoute, /patch\.email\s*=/);
});
