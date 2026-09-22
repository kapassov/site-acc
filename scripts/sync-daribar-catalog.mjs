#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SNAPSHOT_SCHEMA = "daribar.catalog.snapshot.v1";
export const SNAPSHOT_SOURCE = "daribar";
export const ROOT_CATEGORY = "145";
export const CATEGORY_ENDPOINT = "/api/v1/search/category";

const ALLOWED_HOSTS = new Set(["backoffice.daribar.com", "prod-backoffice.daribar.com"]);
const SKU = /^[A-Za-z0-9._:-]{1,96}$/;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_PRODUCTS = 200_000;
const MAX_PAGES = 2_000;

function integer(value, fallback, min, max, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    if (fallback !== undefined) return fallback;
    throw new Error(`invalid_${name}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    output: process.env.DARIBAR_CATALOG_SNAPSHOT_PATH || "data/daribar-catalog.snapshot.json",
    city: process.env.DARIBAR_DEFAULT_CITY || "Алматы",
    concurrency: 4,
    pageSize: 500,
    timeoutMs: 25_000,
    retries: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") return { ...options, help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value_${flag.slice(2)}`);
    index += 1;
    if (flag === "--output") options.output = value;
    else if (flag === "--city") options.city = value;
    else if (flag === "--concurrency") options.concurrency = integer(value, undefined, 1, 4, "concurrency");
    else if (flag === "--page-size") options.pageSize = integer(value, undefined, 1, 500, "page_size");
    else if (flag === "--timeout-ms") options.timeoutMs = integer(value, undefined, 1_000, 30_000, "timeout_ms");
    else if (flag === "--retries") options.retries = integer(value, undefined, 0, 5, "retries");
    else throw new Error(`unknown_option_${flag.replace(/^--/, "")}`);
  }
  options.city = String(options.city).trim();
  if (options.city.length < 2 || options.city.length > 100) throw new Error("invalid_city");
  return options;
}

function apiOrigin() {
  let url;
  try {
    url = new URL(process.env.DARIBAR_API_URL || "https://backoffice.daribar.com");
  } catch {
    throw new Error("invalid_daribar_api_url");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())
      || url.username || url.password || (url.pathname !== "/" && url.pathname !== "")
      || url.search || url.hash) {
    throw new Error("invalid_daribar_api_url");
  }
  return url;
}

async function boundedJson(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("daribar_response_too_large");
  if (!response.body) throw new Error("daribar_empty_response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("daribar_response_too_large");
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((value) => Buffer.from(value)), length);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("daribar_invalid_json");
  }
}

function retryDelay(attempt, response) {
  const retryAfter = Number(response?.headers?.get("retry-after") || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(60_000, retryAfter * 1_000);
  // Daribar occasionally returns short bursts of 500/502/503 while its
  // internal catalogue worker reconnects. Give it enough time to recover;
  // every retry remains an idempotent GET and no partial snapshot is served.
  return Math.min(30_000, 1_000 * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

const wait = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export async function fetchJsonWithRetry(url, { token, timeoutMs, retries, fetchImpl = fetch }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const headers = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.ok) return await boundedJson(response);
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
        throw new Error(`daribar_http_${response.status}`);
      }
      await response.body?.cancel();
    } catch (error) {
      const retryableNetworkError = error?.name === "AbortError" || error instanceof TypeError;
      if (attempt >= retries) throw error;
      if (!retryableNetworkError && (!response || !RETRYABLE_STATUS.has(response.status))) throw error;
      try { await response?.body?.cancel(); } catch { /* response already closed */ }
    } finally {
      clearTimeout(timer);
    }
    await wait(retryDelay(attempt, response));
  }
  throw new Error("daribar_retry_exhausted");
}

function productArray(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("daribar_payload_invalid");
  if (Array.isArray(payload.products)) return payload.products;
  if (payload.result && typeof payload.result === "object" && Array.isArray(payload.result.products)) {
    return payload.result.products;
  }
  throw new Error("daribar_products_missing");
}

function providerInteger(value, name, min = 0) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > MAX_PRODUCTS) {
    throw new Error(`daribar_${name}_invalid`);
  }
  return parsed;
}

function validatePage(payload, requestedPage, expected) {
  const products = productArray(payload);
  if (products.length > expected.pageSize) throw new Error("daribar_page_over_limit");
  const currentPage = providerInteger(payload.current_page, "current_page", 1);
  const totalCount = providerInteger(payload.total_count, "total_count", 1);
  const totalPages = providerInteger(payload.total_pages, "total_pages", 1);
  if (currentPage !== requestedPage) throw new Error("daribar_page_mismatch");
  if (expected.totalCount != null && totalCount !== expected.totalCount) throw new Error("daribar_total_changed");
  if (expected.totalPages != null && totalPages !== expected.totalPages) throw new Error("daribar_total_pages_changed");
  return { products, currentPage, totalCount, totalPages };
}

export function dedupeRawProducts(rawProducts) {
  const products = [];
  const seen = new Set();
  let duplicateCount = 0;
  let invalidSkuCount = 0;
  for (const product of rawProducts) {
    const sku = product && typeof product === "object" && !Array.isArray(product)
      ? String(product.sku || "").trim()
      : "";
    if (!SKU.test(sku)) {
      invalidSkuCount += 1;
      continue;
    }
    if (seen.has(sku)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(sku);
    products.push({ ...product, sku });
  }
  return { products, duplicateCount, invalidSkuCount };
}

export async function collectProviderCatalog(fetchPage, { pageSize = 500, concurrency = 4 } = {}) {
  const firstPayload = await fetchPage(1, pageSize);
  const first = validatePage(firstPayload, 1, { pageSize, totalCount: null, totalPages: null });
  if (first.totalPages > MAX_PAGES) throw new Error("daribar_too_many_pages");
  if (first.totalCount > MAX_PRODUCTS) throw new Error("daribar_too_many_products");
  const pages = new Array(first.totalPages);
  pages[0] = first.products;
  let nextPage = 2;
  async function worker() {
    while (nextPage <= first.totalPages) {
      const page = nextPage;
      nextPage += 1;
      const payload = await fetchPage(page, pageSize);
      pages[page - 1] = validatePage(payload, page, {
        pageSize,
        totalCount: first.totalCount,
        totalPages: first.totalPages,
      }).products;
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(0, first.totalPages - 1)) },
    () => worker(),
  ));
  if (pages.some((page) => !Array.isArray(page))) throw new Error("daribar_snapshot_incomplete");
  const rawProducts = pages.flat();
  const deduped = dedupeRawProducts(rawProducts);
  if (deduped.products.length === 0 || deduped.products.length > first.totalCount) {
    throw new Error("daribar_snapshot_count_invalid");
  }
  // A large gap indicates partial/unstable provider pagination. Never publish it.
  if (deduped.products.length < Math.floor(first.totalCount * 0.9)) {
    throw new Error("daribar_snapshot_incomplete");
  }
  return {
    ...deduped,
    rawCount: rawProducts.length,
    totalCount: first.totalCount,
    totalPages: first.totalPages,
    pagesFetched: pages.length,
  };
}

export function buildSnapshotDocument(collected, { city, pageSize, generatedAt = new Date().toISOString() }) {
  return {
    schema: SNAPSHOT_SCHEMA,
    source: SNAPSHOT_SOURCE,
    endpoint: CATEGORY_ENDPOINT,
    rootCategory: ROOT_CATEGORY,
    generatedAt,
    city,
    pageSize,
    totalCount: collected.totalCount,
    totalPages: collected.totalPages,
    pagesFetched: collected.pagesFetched,
    rawCount: collected.rawCount,
    uniqueCount: collected.products.length,
    duplicateCount: collected.duplicateCount,
    invalidSkuCount: collected.invalidSkuCount,
    products: collected.products,
  };
}

export function atomicWriteSnapshot(output, document) {
  const path = isAbsolute(output) ? output : resolve(process.cwd(), output);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o750 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o640);
    writeFileSync(descriptor, `${JSON.stringify(document)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    try {
      const directoryFd = openSync(directory, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } catch {
      // Directory fsync is unsupported on some local filesystems; file fsync + rename succeeded.
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
    try { unlinkSync(temporary); } catch { /* nothing published */ }
    throw error;
  }
  return path;
}

function pageUrl(origin, { city, page, pageSize }) {
  const url = new URL(CATEGORY_ENDPOINT, origin);
  url.searchParams.set("category", ROOT_CATEGORY);
  url.searchParams.set("city", city);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("sorting", "false");
  url.searchParams.set("filter_by_ip", "false");
  url.searchParams.set("show_restricted", "true");
  url.searchParams.set("skip_price", "false");
  return url;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: npm run catalog:daribar:sync -- [--output PATH] [--city CITY] [--concurrency 1-4] [--page-size 1-500]\n");
    return;
  }
  // The catalogue search endpoint is public. A server-only service token is
  // attached when configured, but snapshot generation must not depend on it.
  const token = String(process.env.DARIBAR_SERVICE_TOKEN || process.env.DARIBAR_TOKEN || "").trim();
  const origin = apiOrigin();
  const collected = await collectProviderCatalog(
    (page, pageSize) => fetchJsonWithRetry(pageUrl(origin, { city: options.city, page, pageSize }), {
      token,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    }),
    options,
  );
  const document = buildSnapshotDocument(collected, options);
  const output = atomicWriteSnapshot(options.output, document);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output,
    generatedAt: document.generatedAt,
    totalCount: document.totalCount,
    uniqueCount: document.uniqueCount,
    pagesFetched: document.pagesFetched,
    duplicateCount: document.duplicateCount,
    invalidSkuCount: document.invalidSkuCount,
  })}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || "daribar_sync_failed") })}\n`);
    process.exitCode = 1;
  });
}
