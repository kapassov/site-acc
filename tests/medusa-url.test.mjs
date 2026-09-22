import assert from "node:assert/strict";
import test from "node:test";

import {
  MedusaUrlConfigurationError,
  secureMedusaBaseUrl,
} from "../src/lib/medusaUrl.ts";

test("remote Medusa origins require verified HTTPS", () => {
  assert.equal(
    secureMedusaBaseUrl("https://medusa.example.kz/"),
    "https://medusa.example.kz",
  );

  for (const value of [
    "http://78.140.246.238:9000",
    "http://medusa.internal:9000",
    "ftp://medusa.example.kz",
    "https://user:password@medusa.example.kz",
    "https://medusa.example.kz?token=secret",
  ]) {
    assert.throws(
      () => secureMedusaBaseUrl(value),
      MedusaUrlConfigurationError,
      value,
    );
  }
});

test("missing configuration stays disabled and loopback HTTP remains usable in development", () => {
  assert.equal(secureMedusaBaseUrl(undefined), null);
  assert.equal(secureMedusaBaseUrl(""), null);
  assert.equal(secureMedusaBaseUrl("http://localhost:9000/"), "http://localhost:9000");
  assert.equal(secureMedusaBaseUrl("http://127.0.0.1:9000"), "http://127.0.0.1:9000");
  assert.equal(secureMedusaBaseUrl("http://[::1]:9000/"), "http://[::1]:9000");
});

test("legacy HTTP is opt-in and restricted to the exact temporary origin", () => {
  const previous = process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP;
  process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP = "true";
  try {
    assert.equal(
      secureMedusaBaseUrl("http://78.140.246.238:9000"),
      "http://78.140.246.238:9000",
    );
    for (const value of [
      "http://78.140.246.238:9001",
      "http://78.140.246.238:9000/store",
      "http://medusa.internal:9000",
    ]) {
      assert.throws(
        () => secureMedusaBaseUrl(value),
        MedusaUrlConfigurationError,
        value,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP;
    else process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP = previous;
  }
});
