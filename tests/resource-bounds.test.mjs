import assert from "node:assert/strict";
import test from "node:test";

const ROUTE_URL = new URL("../src/app/api/medusa/[...path]/route.ts", import.meta.url);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition_timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("public Medusa GET proxy bounds distinct upstream work and rejects overflow", async () => {
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    MEDUSA_URL: process.env.MEDUSA_URL,
    MEDUSA_PUBLISHABLE_KEY: process.env.MEDUSA_PUBLISHABLE_KEY,
    MEDUSA_PROXY_GET_CONCURRENCY: process.env.MEDUSA_PROXY_GET_CONCURRENCY,
    MEDUSA_PROXY_GET_QUEUE: process.env.MEDUSA_PROXY_GET_QUEUE,
    MEDUSA_PROXY_GET_QUEUE_TIMEOUT_MS: process.env.MEDUSA_PROXY_GET_QUEUE_TIMEOUT_MS,
  };
  const gate = deferred();
  const requests = [];
  let active = 0;
  let calls = 0;
  let maxActive = 0;

  process.env.MEDUSA_URL = "https://medusa.example";
  process.env.MEDUSA_PUBLISHABLE_KEY = "pk_test";
  process.env.MEDUSA_PROXY_GET_CONCURRENCY = "2";
  process.env.MEDUSA_PROXY_GET_QUEUE = "2";
  process.env.MEDUSA_PROXY_GET_QUEUE_TIMEOUT_MS = "5000";
  globalThis.fetch = async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gate.promise;
    active -= 1;
    return Response.json({ products: [] });
  };

  try {
    const { GET } = await import(`${ROUTE_URL.href}?resource-bounds=${Date.now()}`);
    const request = (id) => {
      const pending = GET(
        new Request(`https://shop.example/api/medusa/store/products?q=${id}`),
        { params: Promise.resolve({ path: ["store", "products"] }) },
      );
      requests.push(pending);
      return pending;
    };

    request("one");
    request("two");
    await waitFor(() => calls === 2);

    request("three");
    request("four");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 2, "queued requests must not start more upstream work");

    const overflow = await Promise.race([
      request("five"),
      new Promise((resolve) => setTimeout(() => resolve("timed_out"), 250)),
    ]);
    assert.notEqual(overflow, "timed_out", "overflow admission must fail closed without waiting for upstream");
    assert.equal(overflow.status, 503);
    assert.deepEqual(await overflow.json(), { error: "medusa_overloaded" });
    assert.equal(calls, 2, "rejected overflow must not call upstream");

    gate.resolve();
    const responses = await Promise.all(requests.slice(0, 4));
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200]);
    assert.equal(calls, 4);
    assert.equal(maxActive, 2);
  } finally {
    gate.resolve();
    await Promise.allSettled(requests);
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
