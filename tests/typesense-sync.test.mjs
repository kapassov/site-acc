import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { atomicWriteSnapshot, buildSnapshotDocument } from "../scripts/sync-daribar-catalog.mjs";
import {
  buildTypesenseCollectionSchema,
  prepareTypesenseDocuments,
  pruneTypesenseVersions,
  syncTypesenseCatalog,
  validateTypesenseImportResponse,
} from "../scripts/sync-typesense-catalog.mjs";

const config = { url: "http://127.0.0.1:8108", apiKey: "test-admin-key", collection: "daribar-products" };
const NOW = Date.now();
const beforeTime = new Date(NOW - 1000).toISOString();
const raw = (sku) => ({ sku, name: `Парацетамол ${sku} 500 мг таблетки №10`, min_customer_price: 100, quantity: 3 });
function snapshot(products = [raw("SKU-ONE"), raw("SKU-TWO")], generatedAt = beforeTime) {
  return buildSnapshotDocument({
    products, totalCount: products.length, totalPages: 1, pagesFetched: 1,
    rawCount: products.length, duplicateCount: 0, invalidSkuCount: 0,
  }, { city: "Алматы", pageSize: 500, generatedAt });
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

async function fixture(callback, document = snapshot()) {
  const directory = await mkdtemp(join(tmpdir(), "inkar-typesense-test-"));
  const path = join(directory, "snapshot.json");
  atomicWriteSnapshot(path, document);
  try { return await callback(path, document); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}

function mockEngine({ failImport = false, countMismatch = false, afterImport, onAliasRead } = {}) {
  const collections = new Map();
  const aliases = new Map();
  const calls = [];
  let aliasReads = 0;
  return {
    collections, aliases, calls,
    fetchImpl: async (url, options) => {
      const path = decodeURIComponent(url.pathname);
      const method = options.method;
      calls.push({ path, method, body: options.body });
      if (path === "/aliases") {
        onAliasRead?.(++aliasReads, aliases);
        return json({ aliases: [...aliases.entries()].map(([name, collection_name]) => ({ name, collection_name })) });
      }
      if (path.startsWith("/aliases/")) {
        const name = path.slice("/aliases/".length);
        if (method === "PUT") aliases.set(name, JSON.parse(options.body).collection_name);
        return aliases.has(name) ? json({ name, collection_name: aliases.get(name) }) : json({}, 404);
      }
      if (path === "/collections" && method === "POST") {
        const schema = JSON.parse(options.body);
        collections.set(schema.name, { ...schema, num_documents: 0, documents: [] });
        return json(schema);
      }
      if (path === "/collections") return json([...collections.values()]);
      const collectionName = path.split("/")[2];
      const collection = collections.get(collectionName);
      if (!collection) return json({}, 404);
      if (path.endsWith("/documents/import")) {
        const docs = options.body.split("\n").map((line) => JSON.parse(line));
        collection.documents.push(...docs);
        collection.num_documents = collection.documents.length + (countMismatch ? 1 : 0);
        await afterImport?.(collection);
        return new Response(docs.map((doc, index) => JSON.stringify({ success: !(failImport && index === 0), id: doc.id })).join("\n"));
      }
      if (method === "DELETE") collections.delete(collectionName);
      return json(collection);
    },
  };
}

function managed(index, overrides = {}) {
  const name = `daribar-products__20260827T12000${index}000Z_123456abcde${index}`;
  const schema = buildTypesenseCollectionSchema(name, snapshot(), 2, new Date(NOW - (10 - index) * 1000).toISOString());
  return { ...schema, num_documents: 2, ...overrides };
}

test("only searchable Daribar identity fields enter the schema/documents", () => {
  const document = snapshot();
  const docs = prepareTypesenseDocuments(document);
  assert.equal(docs.length, 2);
  assert.deepEqual(Object.keys(docs[0]).sort(), ["aliases", "forms", "id", "name", "normalized_name", "numbers", "sku"]);
  assert.ok(docs[0].numbers.includes("mg:500"));
  const schema = buildTypesenseCollectionSchema("x", document, 2, new Date(NOW).toISOString());
  assert.equal(schema.metadata.source, "daribar");
  assert.equal(schema.metadata.city, "Алматы");
  assert.equal(schema.fields.find((field) => field.name === "numbers").facet, true);
  assert.ok(!JSON.stringify(schema).includes("price"));
});

test("imports validate every success flag, returned identity and line count despite HTTP200", () => {
  const docs = [{ id: "one" }, { id: "two" }];
  assert.doesNotThrow(() => validateTypesenseImportResponse('{"success":true,"id":"one"}\n{"success":true,"id":"two"}', docs));
  for (const value of ['{"success":true,"id":"one"}', '{"success":false,"id":"one"}\n{"success":true,"id":"two"}', '{"success":true,"id":"two"}\n{"success":true,"id":"one"}']) {
    assert.throws(() => validateTypesenseImportResponse(value, docs), /typesense_import_(incomplete|failed)/);
  }
});

test("complete index is imported/checked before alias switch and source is never mutated", async () => {
  await fixture(async (path) => {
    const engine = mockEngine();
    const original = await readFile(path, "utf8");
    const result = await syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl, now: () => NOW, batchSize: 1 });
    assert.equal(result.count, 2);
    assert.equal(result.skipped, false);
    assert.equal(engine.aliases.get(config.collection), result.collection);
    assert.equal(await readFile(path, "utf8"), original);
    const switchIndex = engine.calls.findIndex((call) => call.method === "PUT");
    assert.ok(switchIndex > engine.calls.findLastIndex((call) => call.path.endsWith("/documents/import")));
    assert.ok(switchIndex > engine.calls.findIndex((call) => call.path === `/collections/${result.collection}`));
    assert.equal(engine.calls.some((call) => call.method === "DELETE"), false);
    const again = await syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl, now: () => NOW });
    assert.equal(again.skipped, true);
    assert.equal(engine.calls.filter((call) => call.method === "POST" && call.path === "/collections").length, 1);
  });
});

test("failed individual import or final count never switches the previous alias", async () => {
  for (const options of [{ failImport: true }, { countMismatch: true }]) {
    await fixture(async (path) => {
      const engine = mockEngine(options);
      const old = managed(1);
      old.metadata.generatedAt = new Date(NOW - 5000).toISOString();
      engine.collections.set(old.name, old);
      engine.aliases.set(config.collection, old.name);
      await assert.rejects(() => syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl, now: () => NOW }), /typesense_(import_failed|index_count_mismatch)/);
      assert.equal(engine.aliases.get(config.collection), old.name);
      assert.ok(engine.collections.has(old.name));
      assert.equal(engine.calls.some((call) => call.method === "PUT" || call.method === "DELETE"), false);
    });
  }
});

test("replaced source snapshot during import cannot be published under current alias", async () => {
  await fixture(async (path) => {
    const engine = mockEngine({ afterImport: () => atomicWriteSnapshot(path, snapshot(undefined, new Date(NOW).toISOString())) });
    await assert.rejects(() => syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl, now: () => NOW }), /typesense_snapshot_changed_during_sync/);
    assert.equal(engine.aliases.size, 0);
  });
});

test("missing/malformed snapshot and concurrent lock fail before any engine mutations", async () => {
  await fixture(async (path) => {
    const engine = mockEngine();
    const lockPath = `${path}.typesense-${config.collection}.lock`;
    await writeFile(lockPath, "existing-owner", "utf8");
    await assert.rejects(() => syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl }), /typesense_sync_already_running/);
    assert.equal(await readFile(lockPath, "utf8"), "existing-owner");
    assert.equal(engine.calls.length, 0);
  });
  await fixture(async (path) => {
    const engine = mockEngine();
    await writeFile(path, "{}", "utf8");
    await assert.rejects(() => syncTypesenseCatalog({ config, snapshotPath: path, fetchImpl: engine.fetchImpl }), /daribar_snapshot_invalid/);
    assert.equal(engine.calls.length, 0);
  });
});

test("retention never deletes active, previous, foreign or other-alias-referenced collection", async () => {
  const engine = mockEngine();
  const versions = Array.from({ length: 6 }, (_, index) => managed(index));
  for (const version of versions) engine.collections.set(version.name, version);
  const foreign = managed(7, { metadata: { source: "medusa" } });
  engine.collections.set(foreign.name, foreign);
  const unmanaged = { ...managed(8), name: "customer-data" };
  engine.collections.set(unmanaged.name, unmanaged);
  engine.aliases.set(config.collection, versions[1].name);
  engine.aliases.set("manual-rollback", versions[0].name);
  const count = await pruneTypesenseVersions({ config, current: versions[1].name, previous: versions[2].name, retainVersions: 2, fetchImpl: engine.fetchImpl });
  assert.equal(count, 1);
  assert.deepEqual(engine.calls.filter((call) => call.method === "DELETE").map((call) => call.path), [`/collections/${versions[3].name}`]);
  for (const version of [versions[0], versions[1], versions[2], versions[4], versions[5], foreign, unmanaged]) assert.ok(engine.collections.has(version.name));
});

test("newly referenced collection is rechecked immediately before cleanup", async () => {
  const old = managed(0);
  const engine = mockEngine({ onAliasRead: (read, aliases) => { if (read >= 2) aliases.set("operator", old.name); } });
  for (const version of [old, managed(1), managed(2)]) engine.collections.set(version.name, version);
  const result = await pruneTypesenseVersions({ config, current: managed(2).name, previous: managed(1).name, retainVersions: 2, fetchImpl: engine.fetchImpl });
  assert.equal(result, 0);
  assert.ok(engine.collections.has(old.name));
});
