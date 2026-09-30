import assert from "node:assert/strict";
import test from "node:test";

import { genCode, p1smsResponseResult, smscResponseResult } from "./otp.ts";

test("OTP generator always emits four decimal digits", () => {
  for (let index = 0; index < 100; index += 1) assert.match(genCode(), /^\d{4}$/);
});

test("SMSC accepts an id or count and rejects ambiguous responses", () => {
  assert.deepEqual(smscResponseResult(true, 200, { id: 1 }), { ok: true });
  assert.deepEqual(smscResponseResult(true, 200, { cnt: 1 }), { ok: true });
  assert.deepEqual(smscResponseResult(true, 200, {}), {
    ok: false,
    error: "smsc_invalid_response",
  });
});

test("SMSC errors are normalized without upstream private text", () => {
  assert.deepEqual(smscResponseResult(false, 502, { error: "private gateway message" }), {
    ok: false,
    error: "http_502",
  });
  assert.deepEqual(smscResponseResult(true, 200, { error_code: 3, error: "private" }), {
    ok: false,
    error: "smsc_3",
  });
});

test("P1SMS accepts only a message the provider reports as sent", () => {
  assert.deepEqual(p1smsResponseResult(true, 200, {
    status: "success",
    data: [{ id: 370506708, status: "sent", phone: "redacted" }],
  }), { ok: true });
});

test("P1SMS rejects message errors and ambiguous success responses", () => {
  assert.deepEqual(p1smsResponseResult(true, 200, {
    status: "success",
    data: [{ status: "error", errors: ["private provider message"] }],
  }), { ok: false, error: "p1sms_message_error" });
  assert.deepEqual(p1smsResponseResult(true, 200, { status: "success", data: [] }), {
    ok: false,
    error: "p1sms_invalid_response",
  });
  assert.deepEqual(p1smsResponseResult(true, 200, {
    status: "success",
    data: [{ id: 1, status: "unknown" }],
  }), { ok: false, error: "p1sms_invalid_response" });
  assert.deepEqual(p1smsResponseResult(true, 200, {
    status: "success",
    data: [{ id: 2, status: "moderation" }],
  }), { ok: false, error: "p1sms_invalid_response" });
  assert.deepEqual(p1smsResponseResult(false, 502, {}), {
    ok: false,
    error: "http_502",
  });
});
