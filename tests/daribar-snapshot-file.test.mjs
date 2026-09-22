import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DaribarSnapshotFileError,
  readDaribarCatalogSnapshot,
} from "../src/lib/daribar/snapshot-file.ts";
import {
  atomicWriteSnapshot,
  buildSnapshotDocument,
  collectProviderCatalog,
  fetchJsonWithRetry,
} from "../scripts/sync-daribar-catalog.mjs";

function fixtureProducts(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    sku: `SNAP-${offset + index + 1}`,
    name: `Товар ${offset + index + 1}`,
    categories_ids: ["145"],
  }));
}

function collected(products) {
  return {
    products,
    totalCount: products.length,
    totalPages: 1,
    pagesFetched: 1,
    rawCount: products.length,
    duplicateCount: 0,
    invalidSkuCount: 0,
  };
}

function withSnapshotEnv(values, run) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("Daribar snapshot collector uses provider totals, bounded concurrency and complete pages", async () => {
  const byPage = [fixtureProducts(2), fixtureProducts(2, 2), fixtureProducts(1, 4)];
  let active = 0;
  let peak = 0;
  const result = await collectProviderCatalog(async (page) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, page === 1 ? 1 : 10));
    active -= 1;
    return {
      current_page: page,
      total_count: 5,
      total_pages: 3,
      products: byPage[page - 1],
    };
  }, { pageSize: 2, concurrency: 2 });
  assert.equal(peak, 2);
  assert.equal(result.totalCount, 5);
  assert.equal(result.pagesFetched, 3);
  assert.deepEqual(result.products.map((product) => product.sku), [
    "SNAP-1", "SNAP-2", "SNAP-3", "SNAP-4", "SNAP-5",
  ]);
});

test("Daribar snapshot collector refuses partial provider pagination", async () => {
  await assert.rejects(() => collectProviderCatalog(async (page) => ({
    current_page: page,
    total_count: 20,
    total_pages: 2,
    products: page === 1 ? fixtureProducts(10) : fixtureProducts(1, 10),
  }), { pageSize: 10, concurrency: 2 }), /daribar_snapshot_incomplete/);
});

test("Daribar synchronizer retries idempotent GET requests without exposing its token", async () => {
  const calls = [];
  const payload = await fetchJsonWithRetry(new URL("https://backoffice.daribar.com/api/v1/search/category"), {
    token: "test-secret",
    timeoutMs: 1_000,
    retries: 1,
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) throw new TypeError("temporary network failure");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((options) => options.method === "GET"));
  assert.ok(calls.every((options) => options.headers.authorization === "Bearer test-secret"));
});

test("snapshot writer and reader expose freshness metadata from a stable Daribar-only schema", async () => {
  const directory = mkdtempSync(join(tmpdir(), "daribar-snapshot-"));
  const path = join(directory, "catalog.json");
  try {
    const generatedAt = new Date(Date.now() - 2_000).toISOString();
    const document = buildSnapshotDocument(collected(fixtureProducts(2)), {
      city: "Алматы",
      pageSize: 500,
      generatedAt,
    });
    atomicWriteSnapshot(path, document);
    await withSnapshotEnv({
      DARIBAR_CATALOG_SNAPSHOT_FRESH_SECONDS: "1",
      DARIBAR_CATALOG_SNAPSHOT_MAX_AGE_SECONDS: "60",
    }, async () => {
      const snapshot = await readDaribarCatalogSnapshot(path);
      assert.equal(snapshot.sourceMode, "snapshot_file");
      assert.equal(snapshot.totalCount, 2);
      assert.equal(snapshot.uniqueCount, 2);
      assert.equal(snapshot.stale, true);
      assert.ok(snapshot.ageMs >= 1_000);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot reader fails closed for wrong authority and expired files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "daribar-snapshot-invalid-"));
  const invalidPath = join(directory, "wrong-source.json");
  const expiredPath = join(directory, "expired.json");
  try {
    const valid = buildSnapshotDocument(collected(fixtureProducts(1)), {
      city: "Алматы",
      pageSize: 500,
      generatedAt: new Date().toISOString(),
    });
    atomicWriteSnapshot(invalidPath, valid);
    const invalid = JSON.parse(readFileSync(invalidPath, "utf8"));
    invalid.source = "medusa";
    writeFileSync(invalidPath, JSON.stringify(invalid));
    await assert.rejects(
      () => readDaribarCatalogSnapshot(invalidPath),
      (error) => error instanceof DaribarSnapshotFileError && error.code === "daribar_snapshot_invalid",
    );

    atomicWriteSnapshot(expiredPath, {
      ...valid,
      generatedAt: new Date(Date.now() - 5_000).toISOString(),
    });
    await withSnapshotEnv({
      DARIBAR_CATALOG_SNAPSHOT_FRESH_SECONDS: "1",
      DARIBAR_CATALOG_SNAPSHOT_MAX_AGE_SECONDS: "1",
    }, async () => {
      await assert.rejects(
        () => readDaribarCatalogSnapshot(expiredPath),
        (error) => error instanceof DaribarSnapshotFileError && error.code === "daribar_snapshot_expired",
      );
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot reader reports a missing file instead of returning legacy data", async () => {
  await assert.rejects(
    () => readDaribarCatalogSnapshot(join(tmpdir(), `missing-daribar-${Date.now()}.json`)),
    (error) => error instanceof DaribarSnapshotFileError && error.code === "daribar_snapshot_file_missing",
  );
});

test("production catalogue sync uses Medusa as the only catalogue authority", () => {
  const script = readFileSync("scripts/sync-medusa-catalog.mjs", "utf8");
  const unit = readFileSync("deploy/systemd/inkar-shop-catalog-sync.service", "utf8");
  assert.match(script, /Replicate the public Medusa catalogue/);
  assert.match(script, /MEDUSA_URL, MEDUSA_PUBLISHABLE_KEY/);
  assert.match(unit, /sync-medusa-catalog\.mjs/);
  assert.match(unit, /mark-missing-inactive/);
  assert.doesNotMatch(unit, /sync-daribar-catalog|daribar-catalog\.snapshot/i);
});
