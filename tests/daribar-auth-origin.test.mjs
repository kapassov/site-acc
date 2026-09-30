import assert from "node:assert/strict";
import test from "node:test";
import {
  DaribarConfigError,
  daribarApiOrigin,
  daribarAuthApiOrigin,
  daribarCommerceApiOrigin,
  daribarOrderApiOrigin,
} from "../src/lib/daribar/config.ts";
import { daribarJson, daribarPathNeedsIntegrationCode } from "../src/lib/daribar/client.ts";

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

test("integration code is limited to v3 search and v1 prices", () => {
  assert.equal(daribarPathNeedsIntegrationCode("/api/v3/products/search"), true);
  assert.equal(daribarPathNeedsIntegrationCode("/api/v3/search/products"), true);
  assert.equal(daribarPathNeedsIntegrationCode("/api/v1/prices"), true);
  for (const path of ["/api/v2/orders", "/api/v1/orders", "/api/v2/delivery/claim"]) {
    assert.equal(daribarPathNeedsIntegrationCode(path), false, path);
  }
});

test("server token is used without leaking the integration header to other routes", async () => {
  const previousFetch = globalThis.fetch;
  try {
    await withEnv({
      DARIBAR_SERVICE_TOKEN: "server-b2b-token-1234567890",
      DARIBAR_INTEGRATION_CODE: "apteka_so_sklada",
      DARIBAR_COMMERCE_API_URL: "https://prod-backoffice.daribar.com",
      DARIBAR_ORDER_API_URL: "https://prod-backoffice.daribar.com",
    }, async () => {
      const seen = [];
      globalThis.fetch = async (url, init) => {
        const headers = new Headers(init?.headers);
        seen.push({ path: new URL(String(url)).pathname,
          auth: headers.get("authorization"), integration: headers.get("x-integration-code") });
        return Response.json({ status: "success", result: [] });
      };
      await daribarJson("/api/v1/prices", { method: "POST", origin: "commerce", body: [] });
      await daribarJson("/api/v2/orders", { method: "POST", origin: "order", body: {} });
      assert.deepEqual(seen, [
        { path: "/api/v1/prices", auth: "Bearer server-b2b-token-1234567890", integration: "apteka_so_sklada" },
        { path: "/api/v2/orders", auth: "Bearer server-b2b-token-1234567890", integration: null },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
