import assert from "node:assert/strict";
import test from "node:test";

import {
  prefersPostgresCatalog,
  resolveCatalogSource,
} from "../src/lib/catalog-source.ts";

function snapshot(ids, overrides = {}) {
  return {
    products: ids.map((id) => ({ id })),
    sourceCount: ids.length,
    loadedCount: ids.length,
    complete: true,
    stale: false,
    generatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

test("PostgreSQL catalogue is opt-in and whitespace/case tolerant", () => {
  assert.equal(prefersPostgresCatalog(undefined), false);
  assert.equal(prefersPostgresCatalog("medusa"), false);
  assert.equal(prefersPostgresCatalog(" POSTGRES "), true);
});

test("verified complete PostgreSQL snapshot is selected", async () => {
  let medusaReads = 0;
  const result = await resolveCatalogSource("postgres", {
    local: async () => snapshot(["local"]),
    medusa: async () => {
      medusaReads += 1;
      return snapshot(["remote"]);
    },
  });

  assert.equal(result.source, "postgres");
  assert.equal(result.degraded, false);
  assert.deepEqual(result.snapshot.products.map(({ id }) => id), ["local"]);
  assert.equal(medusaReads, 0);
});

test("local read failure falls back to Medusa without demo data", async () => {
  const result = await resolveCatalogSource("postgres", {
    local: async () => { throw new Error("database unavailable"); },
    medusa: async () => snapshot(["real-medusa"]),
  });

  assert.equal(result.source, "medusa_fallback");
  assert.equal(result.degraded, true);
  assert.deepEqual(result.snapshot.products.map(({ id }) => id), ["real-medusa"]);
});

test("unverified partial local snapshot is never served", async () => {
  const result = await resolveCatalogSource("postgres", {
    local: async () => snapshot(["partial"], { sourceCount: 2, complete: false }),
    medusa: async () => snapshot(["remote-a", "remote-b"]),
  });

  assert.equal(result.source, "medusa_fallback");
  assert.deepEqual(result.snapshot.products.map(({ id }) => id), ["remote-a", "remote-b"]);
});

test("Medusa remains the default and local database is not touched", async () => {
  let localReads = 0;
  const result = await resolveCatalogSource(undefined, {
    local: async () => {
      localReads += 1;
      return snapshot(["local"]);
    },
    medusa: async () => snapshot(["remote"]),
  });

  assert.equal(result.source, "medusa");
  assert.equal(result.degraded, false);
  assert.equal(localReads, 0);
});
