import assert from "node:assert/strict";
import test from "node:test";

import {
  dependencyReadiness,
  recentSuccessfulProbeAge,
} from "../src/lib/health-readiness.ts";

test("a confirmed Medusa success is usable only inside the bounded grace window", () => {
  const now = 1_000_000;
  assert.equal(recentSuccessfulProbeAge(now, now - 119_999, 120_000), 119_999);
  assert.equal(recentSuccessfulProbeAge(now, now - 120_000, 120_000), 120_000);
  assert.equal(recentSuccessfulProbeAge(now, now - 120_001, 120_000), null);
  assert.equal(recentSuccessfulProbeAge(now, 0, 120_000), null);
});

test("recent stale Medusa success keeps readiness honest but degraded", () => {
  assert.deepEqual(dependencyReadiness({
    postgresRequired: true,
    postgresReady: true,
    medusaRequired: true,
    medusaReachable: true,
    medusaStale: true,
  }), { ready: true, degraded: true });
});

test("an expired or absent Medusa success remains a hard readiness failure", () => {
  assert.deepEqual(dependencyReadiness({
    postgresRequired: true,
    postgresReady: true,
    medusaRequired: true,
    medusaReachable: false,
  }), { ready: false, degraded: true });
});

test("an unconfigured optional dependency does not degrade readiness", () => {
  assert.deepEqual(dependencyReadiness({
    postgresRequired: false,
    postgresReady: false,
    medusaRequired: false,
    medusaReachable: false,
  }), { ready: true, degraded: false });
});
