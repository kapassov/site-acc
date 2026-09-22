import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedJson, RequestBodyError } from "../src/lib/httpBody.ts";

function jsonRequest(body, headers = {}) {
  return new Request("https://shop.example/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

test("bounded JSON accepts legitimate payloads", async () => {
  const payload = await readBoundedJson(jsonRequest('{"address":"Абая 1"}'), 128);
  assert.deepEqual(payload, { address: "Абая 1" });
});

test("bounded JSON rejects an oversized declared length before reading", async () => {
  const request = jsonRequest("{}", { "content-length": "4097" });
  await assert.rejects(
    readBoundedJson(request, 4096),
    (error) => error instanceof RequestBodyError
      && error.status === 413
      && error.code === "payload_too_large",
  );
});

test("bounded JSON rejects chunked payloads that cross the byte budget", async () => {
  const request = jsonRequest(JSON.stringify({ address: "x".repeat(200) }));
  await assert.rejects(
    readBoundedJson(request, 64),
    (error) => error instanceof RequestBodyError
      && error.status === 413
      && error.code === "payload_too_large",
  );
});

test("bounded JSON rejects malformed input without reinterpreting it", async () => {
  await assert.rejects(
    readBoundedJson(jsonRequest("{not-json"), 128),
    (error) => error instanceof RequestBodyError
      && error.status === 400
      && error.code === "invalid_json",
  );
});
