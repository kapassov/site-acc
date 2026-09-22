import test from "node:test";
import assert from "node:assert/strict";
import { requestAuthJson } from "../src/lib/auth/clientRequest.ts";

test("auth requests keep cookies same-origin, bypass cache, and never retry", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ ok: true });
  };
  try {
    const result = await requestAuthJson("/api/otp/send", { method: "POST", body: "{}" });
    assert.equal(result.payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.cache, "no-store");
    assert.equal(calls[0].options.method, "POST");
  } finally { globalThis.fetch = original; }
});

test("auth request deadline aborts a stalled connection without a second SMS", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    calls += 1;
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    await assert.rejects(requestAuthJson("/api/otp/send", {}, 10), /aborted/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("closing the login dialog aborts its pending request", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    const pending = requestAuthJson("/api/customer", { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /aborted/);
  } finally { globalThis.fetch = original; }
});

test("request deadline also bounds a stalled JSON body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => ({
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
    }),
  });
  try {
    await assert.rejects(requestAuthJson("/api/customer", {}, 10), /body aborted/);
  } finally { globalThis.fetch = original; }
});

test("non-JSON gateway errors are returned for HTTP error mapping", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("Bad Gateway", { status: 502 });
  try {
    const { response, payload } = await requestAuthJson("/api/otp/send");
    assert.equal(response.status, 502);
    assert.deepEqual(payload, {});
  } finally { globalThis.fetch = original; }
});
