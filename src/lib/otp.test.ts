import assert from "node:assert/strict";
import test from "node:test";

import { genCode, smscResponseResult } from "./otp.ts";

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
