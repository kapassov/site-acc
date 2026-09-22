#!/usr/bin/env node

/**
 * Assign every Medusa product to one pinned storefront top category.
 *
 * Safety properties:
 * - dry-run unless --apply is explicitly present;
 * - all products and the complete category tree are read before planning;
 * - a restorable JSONL snapshot and SHA-256 sidecar are closed before any write;
 * - product matching is exact metadata.ware_id + globally unique variant SKU;
 * - the nine existing top categories are pinned by both id and handle;
 * - apply is a separate 10-product canary, followed by --full --resume;
 * - writes are idempotent, verified, journaled, retryable, and concurrency-limited.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import {
  OTHER_CATEGORY,
  PENDING_OTHER_CATEGORY_ID,
  ROOT_CATEGORY,
  TOP_CATEGORIES,
  buildAssignmentPlan,
  matchMappingToProducts,
  normalizeMapping,
  validateRequiredTaxonomy,
  equalIdSets,
} from "./lib/medusa-top-category-plan.mjs";

const PRODUCT_PAGE_SIZE = 100;
const CATEGORY_PAGE_SIZE = 100;
const DEFAULT_EXPECTED_PRODUCT_COUNT = 27_975;
const CANARY_SIZE = 10;
const MIN_MAPPING_COVERAGE = 0.95;
const MAX_MAPPING_BYTES = 32 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function usage() {
  return `
Usage:
  node scripts/assign-medusa-top-categories.mjs --mapping <mapping.json> [options]

Input JSON:
  { "WARE-UUID": "targetKey", ... }

Canonical targetKey values:
  bady, gigiyena, kosmetika, lekarstva-i-bady, linzy,
  mama-i-malysh, med-pribory-i-izdeliya, sport-i-fitnes, intim,
  drugoe

Modes:
  (default)                 Read, validate, snapshot and report; no Medusa writes
  --apply                   Apply and verify a canary of at most 10 changed products
  --apply --full --resume   Continue the verified canary journal with the full plan

Options:
  --mapping <path>          Required {wareId: targetKey} JSON file
  --expected-count <n>      Pinned Medusa product count (default: 27975)
  --snapshot <path>         Snapshot JSONL path (default: timestamped in cwd)
  --journal <path>          New journal path (default: timestamped in cwd)
  --resume <path>           Resume an existing journal; required with --full
  --report <path>           JSON report path (default: timestamped in cwd)
  --apply                   Enable the canary write phase
  --full                    Continue full apply after a completed canary
  --help                    Show help

Environment:
  MEDUSA_URL, MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD
`;
}

function parsePositiveInteger(raw, name) {
  if (!/^\d+$/.test(String(raw))) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const args = {
    apply: false,
    full: false,
    mapping: "",
    expectedCount: DEFAULT_EXPECTED_PRODUCT_COUNT,
    snapshot: "",
    journal: "",
    resume: "",
    report: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") args.apply = true;
    else if (argument === "--full") args.full = true;
    else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (["--mapping", "--expected-count", "--snapshot", "--journal", "--resume", "--report"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--mapping") args.mapping = value;
      if (argument === "--expected-count") args.expectedCount = parsePositiveInteger(value, argument);
      if (argument === "--snapshot") args.snapshot = value;
      if (argument === "--journal") args.journal = value;
      if (argument === "--resume") args.resume = value;
      if (argument === "--report") args.report = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!args.mapping) throw new Error("--mapping is required");
  if (args.full && (!args.apply || !args.resume)) {
    throw new Error("--full requires --apply and --resume <canary-journal.jsonl>");
  }
  if (args.resume && !args.apply) throw new Error("--resume requires --apply");
  if (args.journal && args.resume) throw new Error("Use either --journal or --resume, not both");

  const stamp = timestampSlug();
  args.mapping = resolve(args.mapping);
  args.snapshot = resolve(args.snapshot || `medusa-top-categories-snapshot-${stamp}.jsonl`);
  args.report = resolve(args.report || `medusa-top-categories-report-${stamp}.json`);
  args.journal = resolve(args.resume || args.journal || `medusa-top-categories-journal-${stamp}.jsonl`);
  args.resume = args.resume ? resolve(args.resume) : "";
  return args;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function medusaBaseUrl() {
  const parsed = new URL(requiredEnvironment("MEDUSA_URL"));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("MEDUSA_URL must use http or https");
  if (parsed.username || parsed.password) throw new Error("Do not embed credentials in MEDUSA_URL");
  return parsed.origin;
}

function safeError(error) {
  if (error instanceof HttpError) return `${error.method} ${error.path} -> HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

class HttpError extends Error {
  constructor(method, path, status, retryAfterMs = null) {
    super(`${method} ${path} -> HTTP ${status}`);
    this.name = "HttpError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function requestJson(baseUrl, token, path, options = {}) {
  const {
    method = "GET",
    body,
    retries = 0,
    timeoutMs = 45_000,
  } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "");
      if (!response.ok) {
        throw new HttpError(
          method,
          path.split("?")[0],
          response.status,
          Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1_000) : null,
        );
      }
      if (response.status === 204) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new Error(`${method} ${path.split("?")[0]} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error(`${method} ${path.split("?")[0]} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${method} ${path.split("?")[0]} returned invalid JSON`);
      }
    } catch (error) {
      lastError = error;
      const retryable = error instanceof HttpError
        ? RETRYABLE_STATUSES.has(error.status)
        : error?.name === "AbortError" || error instanceof TypeError;
      if (!retryable || attempt === retries) throw error;
      const delay = error instanceof HttpError && error.retryAfterMs !== null
        ? Math.min(error.retryAfterMs, 30_000)
        : Math.min(600 * (2 ** attempt), 8_000) + Math.floor(Math.random() * 150);
      await wait(delay);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function authenticate(baseUrl, email, password) {
  const response = await requestJson(baseUrl, "", "/auth/user/emailpass", {
    method: "POST",
    body: { email, password },
    retries: 2,
  });
  const token = typeof response?.token === "string" ? response.token : "";
  if (!token) throw new Error("Medusa authentication response did not contain a token");
  return token;
}

function compactProduct(raw) {
  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || ""),
    handle: String(raw?.handle || ""),
    wareId: typeof raw?.metadata?.ware_id === "string" ? raw.metadata.ware_id : "",
    variants: (Array.isArray(raw?.variants) ? raw.variants : []).map((variant) => ({
      id: String(variant?.id || ""),
      sku: typeof variant?.sku === "string" ? variant.sku : "",
    })),
    categoryIds: (Array.isArray(raw?.categories) ? raw.categories : [])
      .map((category) => String(category?.id || ""))
      .filter(Boolean),
  };
}

async function fetchAllProducts(baseUrl, token, expectedProductCount) {
  const products = [];
  const ids = new Set();
  let expected = null;
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({
      limit: String(PRODUCT_PAGE_SIZE),
      offset: String(offset),
      fields: "id,title,handle,*categories,*variants,+metadata",
    });
    const response = await requestJson(baseUrl, token, `/admin/products?${query}`, { retries: 4 });
    const page = Array.isArray(response?.products) ? response.products : null;
    if (!page) throw new Error("Medusa product response did not contain products[]");
    if (page.length > PRODUCT_PAGE_SIZE) throw new Error("Medusa product page exceeded the requested limit");
    const count = Number(response?.count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Medusa product response has no valid count");
    if (expected === null) expected = count;
    else if (expected !== count) throw new Error(`Medusa product count changed during scan (${expected} -> ${count})`);
    for (const raw of page) {
      const product = compactProduct(raw);
      if (!product.id || ids.has(product.id)) throw new Error(`Duplicate or missing Medusa product id: ${product.id}`);
      ids.add(product.id);
      products.push(product);
    }
    offset += page.length;
    if (offset % 1_000 === 0 || offset === expected) {
      console.log(JSON.stringify({ event: "products_scanned", products: offset, expected }));
    }
    if (offset >= expected) break;
    if (!page.length) throw new Error(`Medusa pagination stopped at ${offset} of ${expected}`);
    if (offset > 100_000) throw new Error("Medusa product pagination safety limit exceeded");
  }
  if (products.length !== expected || products.length !== expectedProductCount) {
    throw new Error(`Expected ${expectedProductCount} Medusa products, received ${products.length} (API count ${expected})`);
  }
  return products;
}

function compactCategory(raw) {
  return {
    id: String(raw?.id || ""),
    name: String(raw?.name || ""),
    handle: String(raw?.handle || ""),
    parent_category_id: raw?.parent_category_id ? String(raw.parent_category_id) : null,
    rank: Number.isFinite(Number(raw?.rank)) ? Number(raw.rank) : 0,
    is_active: raw?.is_active !== false,
    is_internal: raw?.is_internal === true,
  };
}

async function fetchAllCategories(baseUrl, token) {
  const categories = [];
  const ids = new Set();
  let expected = null;
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({
      limit: String(CATEGORY_PAGE_SIZE),
      offset: String(offset),
      fields: "id,name,handle,parent_category_id,rank,is_active,is_internal",
    });
    const response = await requestJson(baseUrl, token, `/admin/product-categories?${query}`, { retries: 4 });
    const page = Array.isArray(response?.product_categories) ? response.product_categories : null;
    if (!page) throw new Error("Medusa category response did not contain product_categories[]");
    const count = Number(response?.count);
    if (Number.isSafeInteger(count) && count >= 0) {
      if (expected === null) expected = count;
      else if (expected !== count) throw new Error(`Medusa category count changed during scan (${expected} -> ${count})`);
    }
    for (const raw of page) {
      const category = compactCategory(raw);
      if (!category.id || ids.has(category.id)) throw new Error(`Duplicate or missing category id: ${category.id}`);
      ids.add(category.id);
      categories.push(category);
    }
    offset += page.length;
    if (expected !== null && offset >= expected) break;
    if (!page.length) break;
    if (offset > 10_000) throw new Error("Medusa category pagination safety limit exceeded");
  }
  if (expected !== null && categories.length !== expected) {
    throw new Error(`Category pagination incomplete: received ${categories.length} of ${expected}`);
  }
  return categories;
}

async function loadMapping(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Mapping path is not a file");
  if (info.size <= 0 || info.size > MAX_MAPPING_BYTES) {
    throw new Error(`Mapping must be between 1 and ${MAX_MAPPING_BYTES} bytes`);
  }
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Mapping is not valid UTF-8 JSON");
  }
  return { entries: normalizeMapping(raw), sha256 };
}

async function createSnapshot(path, context) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "wx");
  const hash = createHash("sha256");
  let closed = false;
  const line = async (value) => {
    const encoded = `${JSON.stringify(value)}\n`;
    hash.update(encoded, "utf8");
    await file.write(encoded, null, "utf8");
  };
  try {
    await line({
      event: "snapshot_started",
      schema_version: 1,
      run_id: context.runId,
      created_at: new Date().toISOString(),
      medusa_origin: context.baseUrl,
      mapping_sha256: context.mappingSha256,
      product_count: context.products.length,
      category_count: context.categories.length,
    });
    for (const category of [...context.categories].sort((left, right) => left.id.localeCompare(right.id))) {
      await line({ event: "category", ...category });
    }
    for (const product of [...context.products].sort((left, right) => left.id.localeCompare(right.id))) {
      await line({
        event: "product",
        id: product.id,
        title: product.title,
        handle: product.handle,
        ware_id: product.wareId || null,
        variants: product.variants,
        category_ids: product.categoryIds,
      });
    }
    await line({
      event: "snapshot_completed",
      run_id: context.runId,
      product_count: context.products.length,
      category_count: context.categories.length,
    });
    await file.sync();
    await file.close();
    closed = true;
  } finally {
    if (!closed) await file.close().catch(() => undefined);
  }
  const sha256 = hash.digest("hex");
  const shaPath = `${path}.sha256`;
  await writeFile(shaPath, `${sha256}  ${basename(path)}\n`, { encoding: "utf8", flag: "wx" });
  return { path, shaPath, sha256 };
}

class Journal {
  constructor(path, needsLeadingNewline = false) {
    this.path = path;
    this.pending = Promise.resolve();
    this.needsLeadingNewline = needsLeadingNewline;
  }

  write(event) {
    const encoded = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`;
    this.pending = this.pending.then(async () => {
      if (this.needsLeadingNewline) {
        await appendFile(this.path, "\n", "utf8");
        this.needsLeadingNewline = false;
      }
      await appendFile(this.path, encoded, "utf8");
    });
    return this.pending;
  }

  flush() {
    return this.pending;
  }
}

async function readResumeState(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_JOURNAL_BYTES) throw new Error("Resume journal is missing or too large");
  const raw = await readFile(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const state = {
    mappingSha256: null,
    canaryCompleted: false,
    succeededIds: new Set(),
    needsLeadingNewline: raw.length > 0 && !/\r?\n$/.test(raw),
  };
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (!text) continue;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      if (index === lines.length - 1 && !/\r?\n$/.test(raw)) break;
      throw new Error(`Invalid JSON in resume journal at line ${index + 1}`);
    }
    if (event.event === "run_started" && event.mapping_sha256) {
      if (state.mappingSha256 && state.mappingSha256 !== event.mapping_sha256) {
        throw new Error("Resume journal contains multiple mapping hashes");
      }
      state.mappingSha256 = event.mapping_sha256;
    }
    if (event.event === "product_update_succeeded" && event.product_id) {
      state.succeededIds.add(String(event.product_id));
    }
    if (event.event === "canary_completed") state.canaryCompleted = true;
  }
  if (!state.mappingSha256) throw new Error("Resume journal has no mapping hash");
  return state;
}

async function initializeJournal(args) {
  await mkdir(dirname(args.journal), { recursive: true });
  if (args.resume) {
    const state = await readResumeState(args.journal);
    return { journal: new Journal(args.journal, state.needsLeadingNewline), state };
  }
  const handle = await open(args.journal, "wx");
  await handle.close();
  return {
    journal: new Journal(args.journal),
    state: { mappingSha256: null, canaryCompleted: false, succeededIds: new Set() },
  };
}

function summarizePlan(plans) {
  const targets = {};
  let changed = 0;
  for (const plan of plans) {
    targets[plan.targetHandle] = (targets[plan.targetHandle] || 0) + 1;
    if (plan.changed) changed += 1;
  }
  return { products: plans.length, changed, unchanged: plans.length - changed, targets };
}

async function writeReport(path, report, flag = "wx") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag });
}

async function ensureOtherCategory(baseUrl, token, journal) {
  await journal.write({ event: "other_category_create_started", handle: OTHER_CATEGORY.handle });
  let createError = null;
  try {
    await requestJson(baseUrl, token, "/admin/product-categories", {
      method: "POST",
      body: {
        name: OTHER_CATEGORY.name,
        handle: OTHER_CATEGORY.handle,
        parent_category_id: ROOT_CATEGORY.id,
        rank: OTHER_CATEGORY.rank,
        is_active: true,
        is_internal: false,
      },
      retries: 0,
    });
  } catch (error) {
    createError = error;
  }
  const categories = await fetchAllCategories(baseUrl, token);
  const validation = validateRequiredTaxonomy(categories);
  if (!validation.other) throw createError || new Error("Other category was not created");
  await journal.write({
    event: createError ? "other_category_create_recovered" : "other_category_created",
    category_id: validation.other.id,
    handle: validation.other.handle,
  });
  return { categories, validation };
}

async function verifyProductCategories(baseUrl, token, productId, desiredIds) {
  const query = new URLSearchParams({ fields: "id,*categories" });
  const response = await requestJson(
    baseUrl,
    token,
    `/admin/products/${encodeURIComponent(productId)}?${query}`,
    { retries: 4 },
  );
  const product = response?.product;
  const actualIds = (Array.isArray(product?.categories) ? product.categories : [])
    .map((category) => String(category?.id || ""))
    .filter(Boolean);
  if (product?.id !== productId || !equalIdSets(actualIds, desiredIds)) {
    throw new Error(`Category verification failed for ${productId}`);
  }
}

async function updateProductCategories(baseUrl, token, plan) {
  await requestJson(
    baseUrl,
    token,
    `/admin/pim/products/${encodeURIComponent(plan.productId)}/categories`,
    {
      method: "PATCH",
      body: { category_ids: plan.desiredCategoryIds },
      retries: 4,
      timeoutMs: 60_000,
    },
  );
  await verifyProductCategories(baseUrl, token, plan.productId, plan.desiredCategoryIds);
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        firstError = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

async function applyPlans(baseUrl, token, plans, concurrency, journal) {
  await runPool(plans, concurrency, async (plan) => {
    await journal.write({
      event: "product_update_started",
      product_id: plan.productId,
      target_handle: plan.targetHandle,
      previous_category_ids: plan.existingCategoryIds,
      desired_category_ids: plan.desiredCategoryIds,
    });
    try {
      await updateProductCategories(baseUrl, token, plan);
      await journal.write({
        event: "product_update_succeeded",
        product_id: plan.productId,
        target_handle: plan.targetHandle,
        desired_category_ids: plan.desiredCategoryIds,
      });
    } catch (error) {
      await journal.write({
        event: "product_update_failed",
        product_id: plan.productId,
        target_handle: plan.targetHandle,
        error: safeError(error),
      });
      throw error;
    }
  });
}

function buildReportBase(args, context) {
  const coverage = context.mappingEntries.length
    ? context.mappingResult.matches.length / context.mappingEntries.length
    : 1;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: !args.apply ? "dry_run" : args.full ? "full_apply" : "canary_apply",
    medusaOrigin: context.baseUrl,
    expectedProductCount: args.expectedCount,
    productCount: context.products.length,
    categoryCount: context.categories.length,
    mapping: {
      file: basename(args.mapping),
      sha256: context.mappingSha256,
      entries: context.mappingEntries.length,
      matched: context.mappingResult.matches.length,
      coverage,
      minimumApplyCoverage: MIN_MAPPING_COVERAGE,
      issues: context.mappingResult.issues,
    },
    taxonomy: {
      root: ROOT_CATEGORY,
      topCategories: TOP_CATEGORIES,
      other: context.validation.other
        ? { id: context.validation.other.id, handle: context.validation.other.handle, exists: true }
        : { id: null, handle: OTHER_CATEGORY.handle, exists: false },
    },
    snapshot: context.snapshot,
    journal: args.journal,
    plan: summarizePlan(context.plans),
  };
}

function applyGuard(mappingEntries, mappingResult) {
  const coverage = mappingEntries.length ? mappingResult.matches.length / mappingEntries.length : 1;
  const fatalIssues = mappingResult.issues.filter((issue) => issue.reason !== "unmatched_ware_id_or_sku");
  if (fatalIssues.length) throw new Error(`Mapping has ${fatalIssues.length} ambiguous or conflicting entries`);
  if (coverage < MIN_MAPPING_COVERAGE) {
    throw new Error(`Mapping coverage ${(coverage * 100).toFixed(2)}% is below ${MIN_MAPPING_COVERAGE * 100}%`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = randomUUID();
  const mapping = await loadMapping(args.mapping);
  const resume = await initializeJournal(args);
  if (resume.state.mappingSha256 && resume.state.mappingSha256 !== mapping.sha256) {
    throw new Error("Resume journal belongs to a different mapping file");
  }
  if (args.full && !resume.state.canaryCompleted) {
    throw new Error("Full apply requires a resume journal with a completed canary");
  }

  const baseUrl = medusaBaseUrl();
  const token = await authenticate(
    baseUrl,
    requiredEnvironment("MEDUSA_ADMIN_EMAIL"),
    requiredEnvironment("MEDUSA_ADMIN_PASSWORD"),
  );
  const [categories, products] = await Promise.all([
    fetchAllCategories(baseUrl, token),
    fetchAllProducts(baseUrl, token, args.expectedCount),
  ]);
  const validation = validateRequiredTaxonomy(categories);
  const mappingResult = matchMappingToProducts(mapping.entries, products);
  let plans = buildAssignmentPlan(
    products,
    mappingResult.assignments,
    validation.taxonomy,
    validation.other?.id || PENDING_OTHER_CATEGORY_ID,
  );

  await resume.journal.write({
    event: "run_started",
    run_id: runId,
    mode: !args.apply ? "dry_run" : args.full ? "full_apply" : "canary_apply",
    mapping_sha256: mapping.sha256,
    expected_product_count: args.expectedCount,
  });
  const snapshot = await createSnapshot(args.snapshot, {
    runId,
    baseUrl,
    mappingSha256: mapping.sha256,
    categories,
    products,
  });
  await resume.journal.write({ event: "snapshot_created", run_id: runId, ...snapshot });

  const context = {
    baseUrl,
    categories,
    products,
    validation,
    mappingEntries: mapping.entries,
    mappingResult,
    mappingSha256: mapping.sha256,
    snapshot,
    plans,
  };
  let report = buildReportBase(args, context);

  if (!args.apply) {
    await resume.journal.write({ event: "dry_run_completed", run_id: runId, plan: report.plan });
    await resume.journal.flush();
    await writeReport(args.report, { ...report, status: "completed_no_writes" });
    console.log(JSON.stringify({
      event: "dry_run_completed",
      products: products.length,
      changed: report.plan.changed,
      mapping_coverage: report.mapping.coverage,
      snapshot: snapshot.path,
      snapshot_sha256: snapshot.sha256,
      report: args.report,
      journal: args.journal,
    }));
    return;
  }

  // Reserve the report path before a new run mutates Medusa. A resumed run,
  // however, intentionally reuses the same durable report path; overwrite the
  // previous attempt so systemd retries can continue from the journal.
  await writeReport(
    args.report,
    { ...report, status: "ready_for_apply" },
    args.resume ? "w" : "wx",
  );

  try {
    applyGuard(mapping.entries, mappingResult);
    let currentCategories = categories;
    let currentValidation = validation;
    if (!currentValidation.other && plans.some((plan) => plan.targetHandle === OTHER_CATEGORY.handle)) {
      const ensured = await ensureOtherCategory(baseUrl, token, resume.journal);
      currentCategories = ensured.categories;
      currentValidation = ensured.validation;
      plans = buildAssignmentPlan(products, mappingResult.assignments, currentValidation.taxonomy, currentValidation.other.id);
      context.categories = currentCategories;
      context.validation = currentValidation;
      context.plans = plans;
      report = buildReportBase(args, context);
    }

    const changedPlans = plans.filter((plan) => plan.changed);
    if (!args.full) {
      const verifiedPrevious = plans.filter((plan) => (
        !plan.changed && resume.state.succeededIds.has(plan.productId)
      )).length;
      const remainingCanary = Math.max(0, CANARY_SIZE - verifiedPrevious);
      const canary = changedPlans.slice(0, remainingCanary);
      await applyPlans(baseUrl, token, canary, 1, resume.journal);
      await resume.journal.write({
        event: "canary_completed",
        run_id: runId,
        applied: canary.length,
        verified_previous: verifiedPrevious,
        requested_size: CANARY_SIZE,
      });
      report = {
        ...report,
        status: "canary_completed",
        apply: { attempted: canary.length, concurrency: 1, remaining: Math.max(0, changedPlans.length - canary.length) },
        nextCommand: `npm run catalog:categories:assign -- --mapping ${JSON.stringify(args.mapping)} --apply --full --resume ${JSON.stringify(args.journal)}`,
      };
    } else {
      await applyPlans(baseUrl, token, changedPlans, 2, resume.journal);
      await resume.journal.write({
        event: "full_apply_completed",
        run_id: runId,
        applied: changedPlans.length,
      });
      report = {
        ...report,
        status: "full_apply_completed",
        apply: { attempted: changedPlans.length, concurrency: 2, remaining: 0 },
      };
    }
    await resume.journal.flush();
    await writeReport(args.report, report, "w");
    console.log(JSON.stringify({
      event: report.status,
      products: products.length,
      changed_at_start: report.plan.changed,
      attempted: report.apply.attempted,
      snapshot: snapshot.path,
      snapshot_sha256: snapshot.sha256,
      report: args.report,
      journal: args.journal,
    }));
  } catch (error) {
    await resume.journal.write({ event: "run_failed", run_id: runId, error: safeError(error) });
    await resume.journal.flush();
    await writeReport(args.report, { ...report, status: "failed", error: safeError(error) }, "w").catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
