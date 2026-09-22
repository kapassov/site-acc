import assert from "node:assert/strict";
import test from "node:test";

import {
  activateCode,
  canSend,
  discardCode,
  reserveCode,
  validateCode,
} from "./otp.ts";

test("exhausting verify attempts does not erase resend cooldown", () => {
  const phone = "77000000001";
  const startedAt = 1_000_000;

  assert.equal(reserveCode(phone, "123456", startedAt), true);
  assert.equal(activateCode(phone, "123456"), true);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(validateCode(phone, "000000", startedAt + attempt), {
      ok: false,
      reason: "mismatch",
    });
  }
  assert.deepEqual(validateCode(phone, "000000", startedAt + 5), {
    ok: false,
    reason: "too_many",
  });

  assert.equal(canSend(phone, startedAt + 29_999), false);
  assert.equal(canSend(phone, startedAt + 30_000), true);
});

test("provider failure releases both reservation and resend cooldown", () => {
  const phone = "77000000002";
  const startedAt = 2_000_000;

  assert.equal(reserveCode(phone, "654321", startedAt), true);
  discardCode(phone, "654321");
  assert.equal(canSend(phone, startedAt), true);
});
