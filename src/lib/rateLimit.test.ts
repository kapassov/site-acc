import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BoundedRateLimiter, clientIp } from "./rateLimit.ts";

test("clientIp trusts only the nginx-authenticated address", () => {
  const proxied = new Request("https://example.test/api/otp/send", {
    headers: {
      "x-forwarded-for": "198.51.100.99, 192.0.2.10",
      "x-real-ip": "203.0.113.7",
    },
  });
  const rotatedForwarding = new Request("https://example.test/api/checkout", {
    headers: {
      "x-forwarded-for": "192.0.2.200",
      "x-real-ip": "203.0.113.7",
    },
  });
  const directSpoof = new Request("https://example.test/api/otp/send", {
    headers: { "x-forwarded-for": "198.51.100.99" },
  });
  const malformed = new Request("https://example.test/api/otp/send", {
    headers: { "x-real-ip": "not-an-ip-address" },
  });

  assert.equal(clientIp(proxied), "203.0.113.7");
  assert.equal(clientIp(rotatedForwarding), clientIp(proxied));
  assert.equal(clientIp(directSpoof), "unknown");
  assert.equal(clientIp(malformed), "unknown");
});

test("shipped nginx configs overwrite caller forwarding chains", () => {
  for (const path of ["deploy/nginx.conf", "deploy/nginx.conf.template"]) {
    const config = readFileSync(path, "utf8");
    assert.doesNotMatch(config, /\$proxy_add_x_forwarded_for/);
    assert.match(config, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
    assert.match(config, /proxy_set_header\s+X-Real-IP\s+\$remote_addr;/);
  }
});

test("limiter keeps each bucket's own expiry during cleanup", () => {
  const limiter = new BoundedRateLimiter({
    maxBuckets: 2,
    cleanupIntervalMs: 1_000,
  });

  assert.equal(limiter.take("long-window", 1, 10_000, 0), true);
  assert.equal(limiter.take("short-window", 1, 1_000, 0), true);
  assert.equal(limiter.take("new-key", 1, 1_000, 0), false);

  // Only the short bucket is stale. Cleanup must not reset the long limit.
  assert.equal(limiter.take("new-key", 1, 1_000, 1_000), true);
  assert.equal(limiter.take("long-window", 1, 10_000, 1_000), false);
});

test("limiter fails closed at its key and cardinality bounds", () => {
  const limiter = new BoundedRateLimiter({ maxBuckets: 1, maxKeyLength: 8 });

  assert.equal(limiter.take("primary", 2, 1_000, 0), true);
  assert.equal(limiter.take("second", 2, 1_000, 0), false);
  assert.equal(limiter.take("123456789", 2, 1_000, 0), false);
  assert.equal(limiter.bucketCount, 1);
});

test("limiter preserves normal sliding-window behavior", () => {
  const limiter = new BoundedRateLimiter({ maxBuckets: 4 });

  assert.equal(limiter.take("customer", 2, 1_000, 0), true);
  assert.equal(limiter.take("customer", 2, 1_000, 100), true);
  assert.equal(limiter.take("customer", 2, 1_000, 999), false);
  assert.equal(limiter.take("customer", 2, 1_000, 1_000), true);
});
