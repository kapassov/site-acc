import assert from "node:assert/strict";
import test from "node:test";
import {
  DaribarConfigError,
  daribarApiOrigin,
  daribarAuthApiOrigin,
  daribarCommerceApiOrigin,
  daribarOrderApiOrigin,
} from "../src/lib/daribar/config.ts";

async function withEnv(patch, run) {
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Daribar customer auth uses an isolated production origin", async () => {
  await withEnv({
    DARIBAR_API_URL: "https://backoffice.daribar.com",
    DARIBAR_AUTH_API_URL: "https://prod-backoffice.daribar.com",
  }, async () => {
    assert.equal(daribarApiOrigin().origin, "https://backoffice.daribar.com");
    assert.equal(daribarAuthApiOrigin().origin, "https://prod-backoffice.daribar.com");
  });
});

test("Daribar order origin can differ from delivery pricing", async () => {
  await withEnv({
    DARIBAR_AUTH_API_URL: "https://prod-backoffice.daribar.com",
    DARIBAR_COMMERCE_API_URL: "https://prod-backoffice.daribar.com",
    DARIBAR_ORDER_API_URL: "https://backoffice.daribar.com",
  }, async () => {
    assert.equal(daribarAuthApiOrigin().origin, "https://prod-backoffice.daribar.com");
    assert.equal(daribarCommerceApiOrigin().origin, "https://prod-backoffice.daribar.com");
    assert.equal(daribarOrderApiOrigin().origin, "https://backoffice.daribar.com");
  });
});

test("Daribar auth origin rejects paths, credentials and unapproved hosts", async () => {
  for (const value of [
    "http://prod-backoffice.daribar.com",
    "https://prod-backoffice.daribar.com/api",
    "https://user:pass@prod-backoffice.daribar.com",
    "https://example.com",
  ]) {
    await withEnv({ DARIBAR_AUTH_API_URL: value }, async () => {
      assert.throws(() => daribarAuthApiOrigin(), DaribarConfigError);
    });
  }
});

test("Daribar order origin rejects paths, credentials and unapproved hosts", async () => {
  for (const value of [
    "http://backoffice.daribar.com",
    "https://backoffice.daribar.com/api",
    "https://user:pass@backoffice.daribar.com",
    "https://example.com",
  ]) {
    await withEnv({ DARIBAR_ORDER_API_URL: value }, async () => {
      assert.throws(() => daribarOrderApiOrigin(), DaribarConfigError);
    });
  }
});
