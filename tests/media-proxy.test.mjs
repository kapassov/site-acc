import assert from "node:assert/strict";
import test from "node:test";

import { GET, HEAD } from "../src/app/api/media/medusa/route.ts";
import {
  MEDIA_CACHE_CONTROL,
  proxyMedusaMedia,
  resolveMedusaStaticUrl,
} from "../src/lib/medusa-media-proxy.ts";

const BASE = "http://medusa.internal:9000";
const STATIC_PATH = "/static/1784545609759-19F5DBA7-C3FD-4502-BFE4-0876F4E50569.jpg";

function mediaRequest(path = STATIC_PATH) {
  return new Request("https://shop.example/api/media/medusa?path=" + encodeURIComponent(path), {
    headers: { authorization: "Bearer must-not-be-forwarded", cookie: "private=yes" },
  });
}

test("only fixed-origin /static paths are accepted", () => {
  const valid = resolveMedusaStaticUrl(STATIC_PATH + "?cache=bust", BASE);
  assert.equal(valid?.href, BASE + STATIC_PATH);

  for (const path of [
    "https://evil.example/static/a.jpg",
    "//evil.example/static/a.jpg",
    "/admin/a.jpg",
    "/static/../admin/a.jpg",
    "/static/%2e%2e/admin/a.jpg",
    "/static/%252e%252e/admin/a.jpg",
    "/static/%5c..%5cadmin/a.jpg",
  ]) {
    assert.equal(resolveMedusaStaticUrl(path, BASE), null, path);
  }
});

test("GET streams image bytes with bounded request and safe cache headers", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(url.href, BASE + STATIC_PATH);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(init.headers), ["accept"]);
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": "image/jpeg; charset=binary",
        "content-length": "3",
        etag: 'W/"three"',
        "last-modified": "Thu, 23 Jul 2026 00:00:00 GMT",
        "set-cookie": "must-not-leak=yes",
      },
    });
  };
  process.env.MEDUSA_URL = BASE;
  try {
    const response = await GET(mediaRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("content-length"), "3");
    assert.equal(response.headers.get("cache-control"), MEDIA_CACHE_CONTROL);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("etag"), 'W/"three"');
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MEDUSA_URL;
  }
});

test("HEAD uses upstream HEAD and returns headers without a body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url.href, BASE + STATIC_PATH);
    assert.equal(init.method, "HEAD");
    return new Response(null, {
      headers: { "content-type": "image/webp", "content-length": "22982" },
    });
  };
  process.env.MEDUSA_URL = BASE;
  try {
    const response = await HEAD(mediaRequest());
    assert.equal(response.status, 200);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("content-length"), "22982");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.MEDUSA_URL;
  }
});

test("invalid content types and redirects are not proxied", async () => {
  const html = await proxyMedusaMedia(mediaRequest(), "GET", {
    baseUrl: BASE,
    fetchImpl: async () => new Response("<html>", { headers: { "content-type": "text/html" } }),
  });
  assert.equal(html.status, 502);
  assert.deepEqual(await html.json(), { error: "invalid_media_type" });

  const redirect = await proxyMedusaMedia(mediaRequest(), "GET", {
    baseUrl: BASE,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/a.jpg" } }),
  });
  assert.equal(redirect.status, 502);
  assert.deepEqual(await redirect.json(), { error: "media_redirect_rejected" });
});

test("timeout aborts upstream fetch and HEAD errors never include a body", async () => {
  const timeout = await proxyMedusaMedia(mediaRequest(), "GET", {
    baseUrl: BASE,
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.equal(timeout.status, 504);
  assert.deepEqual(await timeout.json(), { error: "media_timeout" });

  const invalidHead = await HEAD(mediaRequest("https://evil.example/static/a.jpg"));
  assert.equal(invalidHead.status, 400);
  assert.equal(invalidHead.body, null);
  assert.equal(invalidHead.headers.get("cache-control"), "no-store");
});