import assert from "node:assert/strict";
import test from "node:test";

import { secureMedusaUrl } from "../scripts/lib/secure-medusa-url.mjs";

test("offer synchronization rejects cleartext remote Medusa origins", () => {
  assert.equal(secureMedusaUrl("https://medusa.example.kz/").href, "https://medusa.example.kz/");

  for (const value of [
    "http://78.140.246.238:9000",
    "http://medusa.internal:9000",
    "https://user:password@medusa.example.kz",
    "https://medusa.example.kz?secret=value",
  ]) {
    assert.throws(() => secureMedusaUrl(value), /MEDUSA_URL|credentials/, value);
  }
});

test("offer synchronization retains localhost development support", () => {
  assert.equal(
    secureMedusaUrl("http://localhost:9000").href,
    "http://localhost:9000/",
  );
  assert.equal(
    secureMedusaUrl("http://127.0.0.1:9000").href,
    "http://127.0.0.1:9000/",
  );
});

test("offer synchronization allows only the explicitly opted-in legacy origin", () => {
  const previous = process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP;
  process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP = "true";
  try {
    assert.equal(
      secureMedusaUrl("http://78.140.246.238:9000").href,
      "http://78.140.246.238:9000/",
    );
    assert.throws(
      () => secureMedusaUrl("http://78.140.246.238:9001"),
      /MEDUSA_URL/,
    );
    assert.throws(
      () => secureMedusaUrl("http://78.140.246.238:9000/store"),
      /MEDUSA_URL/,
    );
  } finally {
    if (previous === undefined) delete process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP;
    else process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP = previous;
  }
});
