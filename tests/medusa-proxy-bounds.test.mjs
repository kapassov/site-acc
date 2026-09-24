import assert from "node:assert/strict";
import test from "node:test";

const ROUTE_URL = new URL("../src/app/api/medusa/[...path]/route.ts", import.meta.url);
const CONTEXT = { params: Promise.resolve({ path: ["store", "products"] }) };

test("Medusa catalogue proxy is retired when Daribar owns the storefront", async () => {
  const previous = process.env.STOREFRONT_CATALOG_PROVIDER;
  const originalFetch = globalThis.fetch;
  process.env.STOREFRONT_CATALOG_PROVIDER = "daribar";
  globalThis.fetch = async () => { throw new Error("medusa_must_not_be_contacted"); };
  try {
    const { GET } = await import(`${ROUTE_URL.href}?daribar-cutover=${Date.now()}`);
    const response = await GET(new Request("https://shop.example/api/medusa/store/products"), CONTEXT);
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: "medusa_catalog_retired" });
  } finally {
    if (previous === undefined) delete process.env.STOREFRONT_CATALOG_PROVIDER;
    else process.env.STOREFRONT_CATALOG_PROVIDER = previous;
    globalThis.fetch = originalFetch;
  }
});

function preserveEnvironment(...keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Medusa proxy rejects an oversized response before consuming its stream", async () => {
  const originalFetch = globalThis.fetch;
  const previous = preserveEnvironment(
    "MEDUSA_URL",
    "MEDUSA_PUBLISHABLE_KEY",
    "MEDUSA_PROXY_MAX_RESPONSE_BYTES",
  );
  let cancelled = false;
  process.env.MEDUSA_URL = "https://medusa-size.example";
  process.env.MEDUSA_PUBLISHABLE_KEY = "pk_test";
  process.env.MEDUSA_PROXY_MAX_RESPONSE_BYTES = "1024";
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  }), {
    headers: { "content-length": "1025", "content-type": "application/json" },
  });

  try {
    const { GET } = await import(`${ROUTE_URL.href}?oversized-response=${Date.now()}`);
    const response = await GET(
      new Request("https://shop.example/api/medusa/store/products?q=oversized"),
      CONTEXT,
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "medusa_response_too_large" });
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Medusa proxy stops a chunked response as soon as it crosses the byte limit", async () => {
  const originalFetch = globalThis.fetch;
  const previous = preserveEnvironment(
    "MEDUSA_URL",
    "MEDUSA_PUBLISHABLE_KEY",
    "MEDUSA_PROXY_MAX_RESPONSE_BYTES",
  );
  let cancelled = false;
  process.env.MEDUSA_URL = "https://medusa-chunked.example";
  process.env.MEDUSA_PUBLISHABLE_KEY = "pk_test";
  process.env.MEDUSA_PROXY_MAX_RESPONSE_BYTES = "1024";
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(700));
      controller.enqueue(new Uint8Array(400));
    },
    cancel() {
      cancelled = true;
    },
  }), {
    headers: { "content-type": "application/json" },
  });

  try {
    const { GET } = await import(`${ROUTE_URL.href}?chunked-response=${Date.now()}`);
    const response = await GET(
      new Request("https://shop.example/api/medusa/store/products?q=chunked"),
      CONTEXT,
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "medusa_response_too_large" });
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Medusa proxy rejects writes regardless of body size before calling upstream", async () => {
  const originalFetch = globalThis.fetch;
  const previous = preserveEnvironment(
    "MEDUSA_URL",
    "MEDUSA_PUBLISHABLE_KEY",
    "MEDUSA_PROXY_MAX_BODY_BYTES",
  );
  let calls = 0;
  process.env.MEDUSA_URL = "https://medusa-write.example";
  process.env.MEDUSA_PUBLISHABLE_KEY = "pk_test";
  process.env.MEDUSA_PROXY_MAX_BODY_BYTES = "1024";
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ ok: true });
  };

  try {
    const { POST } = await import(`${ROUTE_URL.href}?oversized-request=${Date.now()}`);
    const response = await POST(new Request(
      "https://shop.example/api/medusa/store/products",
      {
        method: "POST",
        headers: { "content-length": "1025", "content-type": "application/json" },
        body: new Uint8Array(1025),
      },
    ), CONTEXT);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Medusa proxy fails closed for a remote cleartext origin", async () => {
  const originalFetch = globalThis.fetch;
  const previous = preserveEnvironment("MEDUSA_URL", "MEDUSA_PUBLISHABLE_KEY");
  let calls = 0;
  process.env.MEDUSA_URL = "http://medusa.example:9000";
  process.env.MEDUSA_PUBLISHABLE_KEY = "pk_test";
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ products: [] });
  };

  try {
    const { GET } = await import(`${ROUTE_URL.href}?cleartext-origin=${Date.now()}`);
    const response = await GET(
      new Request("https://shop.example/api/medusa/store/products"),
      CONTEXT,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "medusa_not_configured" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
