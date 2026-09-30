import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { daribarJson } from "../src/lib/daribar/client.ts";
import { genCode, sendSms, smscResponseResult } from "../src/lib/otp.ts";
import * as contract from "../src/lib/otpContract.ts";

test("OTP accepts one complete destination in local, international and formatted notation", () => {
  for (const input of ["7061234567", "77061234567", "87061234567", "+7 (706) 123-45-67"]) {
    assert.equal(contract.normalizeOtpPhone(input), "77061234567");
  }
  for (const input of ["", "706123456", "770612345678", "17061234567", "phone77061234567", "+7 706123456", "+7061234567", "++77061234567", "7706+1234567", {}, 77061234567]) {
    assert.equal(contract.normalizeOtpPhone(input), "");
  }
});

test("generated login codes follow the exact four-digit client contract", () => {
  assert.equal(contract.OTP_CODE_LENGTH, 4);
  for (let index = 0; index < 100; index += 1) {
    assert.match(genCode(), /^\d{4}$/);
  }
});

test("SMSC response parsing fails closed without exposing provider text", () => {
  assert.deepEqual(smscResponseResult(true, 200, { id: 42, cnt: 1 }), { ok: true });
  assert.deepEqual(smscResponseResult(true, 200, { error: "PRIVATE", error_code: 7 }), {
    ok: false,
    error: "smsc_7",
  });
  assert.deepEqual(smscResponseResult(false, 503, { error: "PRIVATE" }), {
    ok: false,
    error: "http_503",
  });
  assert.deepEqual(smscResponseResult(true, 200, {}), { ok: false, error: "smsc_invalid_response" });
});

test("SMSC credentials are submitted server-side by POST", async t => {
  const previous = {
    provider: process.env.SMS_PROVIDER,
    login: process.env.SMSC_LOGIN,
    password: process.env.SMSC_PASSWORD,
    apiKey: process.env.SMSC_API_KEY,
  };
  process.env.SMS_PROVIDER = "smsc";
  process.env.SMSC_LOGIN = "test-login";
  process.env.SMSC_PASSWORD = "test-password";
  delete process.env.SMSC_API_KEY;
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url: String(url), options };
    return Response.json({ id: 1, cnt: 1 });
  });
  try {
    assert.deepEqual(await sendSms("77061234567", "AptekaSoSklada: 0123"), { ok: true });
    assert.equal(request.url, "https://smsc.kz/sys/send.php");
    assert.equal(request.options.method, "POST");
    const form = new URLSearchParams(request.options.body);
    assert.equal(form.get("phones"), "77061234567");
    assert.equal(form.get("login"), "test-login");
    assert.equal(form.get("psw"), "test-password");
    assert.equal(form.get("fmt"), "3");
  } finally {
    if (previous.provider === undefined) delete process.env.SMS_PROVIDER; else process.env.SMS_PROVIDER = previous.provider;
    if (previous.login === undefined) delete process.env.SMSC_LOGIN; else process.env.SMSC_LOGIN = previous.login;
    if (previous.password === undefined) delete process.env.SMSC_PASSWORD; else process.env.SMSC_PASSWORD = previous.password;
    if (previous.apiKey === undefined) delete process.env.SMSC_API_KEY; else process.env.SMSC_API_KEY = previous.apiKey;
  }
});

test("send and confirmation routes use the same normalizer and first-party store", () => {
  const send = readFileSync("src/app/api/otp/send/route.ts", "utf8");
  const customer = readFileSync("src/app/api/customer/route.ts", "utf8");
  for (const source of [send, customer]) assert.match(source, /normalizeOtpPhone\(body\.phone\)/);
  assert.match(send, /await reserveCode\(phone, code\)/);
  assert.match(customer, /await validateCode\(phone, code\)/);
  assert.doesNotMatch(send + customer, /sendDaribarOtp|verifyDaribarOtp/);
});

test("HTML throttling responses retain HTTP status and bounded Retry-After, not their body", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>private-proxy-error</html>", {
    status: 429, headers: { "retry-after": "75" },
  }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "daribar_http_429");
    assert.equal(error.retryAfter, 75);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test("oversized Retry-After is bounded and non-JSON success is still rejected", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 429, headers: { "retry-after": "9999999" } }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => error.retryAfter === 3600);
  t.mock.method(globalThis, "fetch", async () => new Response("not-json", { status: 200 }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => error.status === 502 && error.code === "daribar_invalid_json");
});
