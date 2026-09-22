#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapDaribarProduct } from "../src/lib/daribar/catalog-data.ts";
import { daribarCatalogSnapshotPath, readDaribarCatalogSnapshot } from "../src/lib/daribar/snapshot-file.ts";
import { createProductSearchDocument } from "../src/lib/search/product-search-model.ts";
import {
  TYPESENSE_MAX_PRODUCTS,
  TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION,
  TYPESENSE_PRODUCT_SEARCH_SCHEMA,
  getTypesenseConfig,
  typesenseRequest,
  validateTypesenseConfig,
  validateTypesenseIndexMetadata,
} from "../src/lib/search/typesense-client.ts";

function fail(code) { throw new Error(code); }
function record(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function positiveInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function managedCollection(name, alias) {
  return typeof name === "string" && name.startsWith(`${alias}__`)
    && /^\d{8}T\d{9}Z_[a-f0-9]{12}$/.test(name.slice(alias.length + 2));
}

export function buildTypesenseCollectionSchema(name, snapshot, documentCount, indexedAt, previousCollection) {
  return {
    name,
    fields: [
      { name: "sku", type: "string", index: false, optional: true },
      { name: "name", type: "string", index: false, optional: true },
      { name: "normalized_name", type: "string", locale: "ru" },
      { name: "aliases", type: "string[]", locale: "ru", optional: true },
      { name: "numbers", type: "string[]", facet: true, optional: true },
      { name: "forms", type: "string[]", facet: true, optional: true },
    ],
    metadata: {
      schema: TYPESENSE_PRODUCT_SEARCH_SCHEMA,
      modelVersion: TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION,
      source: "daribar",
      generatedAt: snapshot.generatedAt,
      indexedAt,
      city: snapshot.city,
      documentCount,
      sourceCount: snapshot.uniqueCount,
      ...(previousCollection ? { previousCollection } : {}),
    },
  };
}

export function prepareTypesenseDocuments(snapshot) {
  const documents = [];
  const ids = new Set();
  for (const raw of snapshot.products) {
    const product = mapDaribarProduct(raw);
    if (!product) continue;
    if (product.source !== "daribar") fail("typesense_source_invalid");
    const document = createProductSearchDocument(product);
    if (!document || !document.id || !document.name || !document.normalized_name || ids.has(document.id)) {
      fail("typesense_document_invalid");
    }
    // This is an explicit allow-list: price, images and inventory are never search authority.
    documents.push({
      id: document.id,
      sku: document.sku,
      name: document.name,
      normalized_name: document.normalized_name,
      aliases: document.aliases,
      numbers: document.numbers,
      forms: document.forms,
    });
    ids.add(document.id);
  }
  if (documents.length === 0 || documents.length > TYPESENSE_MAX_PRODUCTS
      || documents.length < Math.floor(snapshot.uniqueCount * 0.9)) fail("typesense_document_count_invalid");
  return documents;
}

export function validateTypesenseImportResponse(serialized, documents) {
  if (typeof serialized !== "string") fail("typesense_import_invalid_response");
  const lines = serialized.trim().split(/\r?\n/);
  if (lines.length !== documents.length) fail("typesense_import_incomplete");
  for (let index = 0; index < lines.length; index += 1) {
    let result;
    try { result = JSON.parse(lines[index]); } catch { fail("typesense_import_invalid_json"); }
    // HTTP 200 can contain failed individual imports. Do not publish even one missing SKU.
    if (!record(result) || result.success !== true || result.id !== documents[index].id) {
      fail("typesense_import_failed");
    }
  }
}

async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") fail("typesense_sync_already_running");
    fail("typesense_sync_lock_failed");
  }
  const token = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: randomUUID() });
  try { await file.writeFile(token, "utf8"); await file.sync(); }
  catch { await file.close(); try { await unlink(path); } catch { /* file may be unavailable */ } fail("typesense_sync_lock_failed"); }
  await file.close();
  return async () => {
    // Never remove a lock belonging to another process after external intervention.
    try { if (await readFile(path, "utf8") === token) await unlink(path); } catch { /* fail closed on next run */ }
  };
}

async function aliasTarget(config, fetchImpl) {
  try {
    const result = await typesenseRequest(config, `/aliases/${encodeURIComponent(config.collection)}`, { fetchImpl });
    if (!record(result) || typeof result.collection_name !== "string"
        || !/^[A-Za-z0-9_-]{1,160}$/.test(result.collection_name)) fail("typesense_alias_invalid");
    return result.collection_name;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function allAliasTargets(config, fetchImpl) {
  const payload = await typesenseRequest(config, "/aliases", { fetchImpl });
  if (!record(payload) || !Array.isArray(payload.aliases)) fail("typesense_aliases_invalid");
  const targets = new Set();
  for (const alias of payload.aliases) {
    if (!record(alias) || typeof alias.collection_name !== "string") fail("typesense_aliases_invalid");
    targets.add(alias.collection_name);
  }
  return targets;
}

function eligibleVersion(collection, alias) {
  if (!record(collection) || !managedCollection(collection.name, alias)) return false;
  try { validateTypesenseIndexMetadata(collection.metadata, collection.num_documents); return true; }
  catch { return false; }
}

/** Pruning is opt-in, applies only to our versioned namespace and never to a current alias target. */
export async function pruneTypesenseVersions({ config, current, previous, retainVersions, fetchImpl }) {
  positiveInteger(retainVersions, 2, 100, "typesense_retention_invalid");
  const payload = await typesenseRequest(config, "/collections?exclude_fields=fields", { fetchImpl, maxBytes: 8 * 1024 * 1024 });
  if (!Array.isArray(payload)) fail("typesense_collections_invalid");
  const candidates = payload.filter((collection) => eligibleVersion(collection, config.collection))
    .sort((left, right) => Date.parse(right.metadata.indexedAt) - Date.parse(left.metadata.indexedAt));
  const keep = new Set([current, previous, ...candidates.slice(0, retainVersions).map((collection) => collection.name)]);
  for (const target of await allAliasTargets(config, fetchImpl)) keep.add(target);
  let prunedCount = 0;
  for (const candidate of candidates) {
    if (keep.has(candidate.name)) continue;
    // Revalidate each exact target immediately before deletion; no wildcard/broad removal exists.
    const latestAliases = await allAliasTargets(config, fetchImpl);
    if (latestAliases.has(candidate.name)) continue;
    const latest = await typesenseRequest(config, `/collections/${encodeURIComponent(candidate.name)}`, { fetchImpl });
    if (!eligibleVersion(latest, config.collection) || latest.name !== candidate.name
        || candidate.name === current || candidate.name === previous) continue;
    // A second read closes the longer metadata-lookup race with an operator's alias switch.
    if ((await allAliasTargets(config, fetchImpl)).has(candidate.name)) continue;
    await typesenseRequest(config, `/collections/${encodeURIComponent(candidate.name)}`, { method: "DELETE", fetchImpl });
    prunedCount += 1;
  }
  return prunedCount;
}

/** Build a new collection and switch the alias only after the full Daribar snapshot is validated. */
export async function syncTypesenseCatalog(options = {}) {
  const config = validateTypesenseConfig(options.config || getTypesenseConfig("admin"));
  const snapshotPath = daribarCatalogSnapshotPath(options.snapshotPath);
  const lockPath = resolve(options.lockPath || `${snapshotPath}.typesense-${config.collection}.lock`);
  const batchSize = options.batchSize ?? 250;
  positiveInteger(batchSize, 1, 500, "typesense_batch_size_invalid");
  if (options.retainVersions !== undefined) positiveInteger(options.retainVersions, 2, 100, "typesense_retention_invalid");
  const releaseLock = await acquireLock(lockPath);
  const requestOptions = { fetchImpl: options.fetchImpl, timeoutMs: 30_000 };
  try {
    const snapshot = await readDaribarCatalogSnapshot(snapshotPath);
    const documents = prepareTypesenseDocuments(snapshot);
    const previous = await aliasTarget(config, options.fetchImpl);
    let currentSchema = null;
    if (previous) {
      currentSchema = await typesenseRequest(config, `/collections/${encodeURIComponent(previous)}`, requestOptions);
      if (record(currentSchema?.metadata) && currentSchema.metadata.source === "daribar"
          && Date.parse(currentSchema.metadata.generatedAt) > Date.parse(snapshot.generatedAt)) {
        fail("typesense_snapshot_would_go_backwards");
      }
    }
    let alreadyCurrent = false;
    try {
      const metadata = validateTypesenseIndexMetadata(currentSchema?.metadata, currentSchema?.num_documents);
      alreadyCurrent = metadata.generatedAt === snapshot.generatedAt && metadata.city === snapshot.city
        && metadata.documentCount === documents.length && metadata.sourceCount === snapshot.uniqueCount;
    } catch { /* First run or schema/model changed: build a fresh version. */ }
    if (alreadyCurrent) {
      let prunedCount = 0;
      let cleanupFailed = false;
      if (options.retainVersions !== undefined) {
        try {
          prunedCount = await pruneTypesenseVersions({
            config, current: previous, previous: currentSchema.metadata.previousCollection,
            retainVersions: options.retainVersions, fetchImpl: options.fetchImpl,
          });
        } catch { cleanupFailed = true; }
      }
      return { ok: true, skipped: true, collection: previous, count: documents.length, generatedAt: snapshot.generatedAt, prunedCount, cleanupFailed };
    }
    const indexedAt = new Date((options.now || Date.now)()).toISOString();
    const suffix = `${indexedAt.replace(/[-:.]/g, "")}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const collection = `${config.collection}__${suffix}`;
    const schema = buildTypesenseCollectionSchema(collection, snapshot, documents.length, indexedAt, previous);
    const created = await typesenseRequest(config, "/collections", { ...requestOptions, method: "POST", body: schema });
    if (!record(created) || created.name !== collection) fail("typesense_collection_create_failed");
    for (let offset = 0; offset < documents.length; offset += batchSize) {
      const batch = documents.slice(offset, offset + batchSize);
      const payload = batch.map((document) => JSON.stringify(document)).join("\n");
      if (Buffer.byteLength(payload, "utf8") > 8 * 1024 * 1024) fail("typesense_import_too_large");
      const result = await typesenseRequest(config, `/collections/${encodeURIComponent(collection)}/documents/import?action=create&dirty_values=reject&return_id=true`, {
        ...requestOptions, method: "POST", rawBody: payload, responseType: "text", maxBytes: 8 * 1024 * 1024,
      });
      validateTypesenseImportResponse(result, batch);
    }
    const verified = await typesenseRequest(config, `/collections/${encodeURIComponent(collection)}`, requestOptions);
    if (!record(verified) || verified.name !== collection || verified.num_documents !== documents.length) {
      fail("typesense_index_count_mismatch");
    }
    const metadata = validateTypesenseIndexMetadata(verified.metadata, verified.num_documents);
    if (metadata.generatedAt !== snapshot.generatedAt || metadata.city !== snapshot.city
        || metadata.sourceCount !== snapshot.uniqueCount) fail("typesense_index_source_mismatch");
    const latestSnapshot = await readDaribarCatalogSnapshot(snapshotPath);
    if (latestSnapshot.generatedAt !== snapshot.generatedAt || latestSnapshot.city !== snapshot.city
        || latestSnapshot.uniqueCount !== snapshot.uniqueCount) fail("typesense_snapshot_changed_during_sync");
    if (await aliasTarget(config, options.fetchImpl) !== previous) fail("typesense_alias_changed_during_sync");
    await typesenseRequest(config, `/aliases/${encodeURIComponent(config.collection)}`, {
      ...requestOptions, method: "PUT", body: { collection_name: collection },
    });
    if (await aliasTarget(config, options.fetchImpl) !== collection) fail("typesense_alias_switch_unconfirmed");
    let prunedCount = 0;
    let cleanupFailed = false;
    if (options.retainVersions !== undefined) {
      try { prunedCount = await pruneTypesenseVersions({ config, current: collection, previous, retainVersions: options.retainVersions, fetchImpl: options.fetchImpl }); }
      catch { cleanupFailed = true; }
    }
    return {
      ok: true, skipped: false, collection, previousCollection: previous,
      count: documents.length, sourceCount: snapshot.uniqueCount, generatedAt: snapshot.generatedAt,
      prunedCount, cleanupFailed,
    };
  } finally {
    await releaseLock();
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help") return { help: true };
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail("typesense_missing_argument");
    if (key === "--snapshot") options.snapshotPath = value;
    else if (key === "--lock-path") options.lockPath = value;
    else if (key === "--batch-size") options.batchSize = Number(value);
    else if (key === "--retain-versions") options.retainVersions = Number(value);
    else fail("typesense_unknown_argument");
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve().then(async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/sync-typesense-catalog.mjs [--snapshot PATH] [--batch-size 1-500] [--retain-versions 2-100]\n");
      return;
    }
    process.stdout.write(`${JSON.stringify(await syncTypesenseCatalog(options))}\n`);
  }).catch((error) => {
    // Never print server bodies, product queries, paths containing credentials, or API keys.
    const code = /^(?:typesense|daribar_snapshot)_[a-z0-9_]+$/.test(String(error?.message))
      ? error.message : "typesense_sync_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
}
