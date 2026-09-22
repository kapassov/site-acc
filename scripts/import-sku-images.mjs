#!/usr/bin/env node

/**
 * Production-safe Medusa product-image importer.
 *
 * Safety invariants:
 * - dry-run unless --apply is present;
 * - no fuzzy matching: basename === one globally unique SKU, while ware_id must
 *   either match the basename exactly or be strictly empty (audited fallback);
 * - products with an existing thumbnail or image are never changed;
 * - one file per upload, maximum 5 MiB;
 * - uploaded content is de-duplicated by SHA-256;
 * - product writes use at most two workers and retry only 429/5xx responses;
 * - every decision and write is appended to a resumable JSONL manifest.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import process from "node:process";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PRODUCT_PAGE_SIZE = 100;
const UPDATE_CONCURRENCY = 2;
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
let activeManifest = null;
let activeMode = "unknown";

function usage() {
  return `
Usage:
  node scripts/import-sku-images.mjs --images-dir <directory> [options]

Options:
  --images-dir <path>  Extracted sku_images directory (required)
  --apply              Enable uploads and product updates (default: dry-run)
  --limit <n>          Process at most n eligible products (recommended canary)
  --manifest <path>    JSONL output path (default: ./sku-image-import-<time>.jsonl)
  --resume <path>      Append to and resume an existing JSONL manifest
  --help               Show this help

Required environment variables:
  MEDUSA_URL
  MEDUSA_ADMIN_EMAIL
  MEDUSA_ADMIN_PASSWORD

Examples:
  node scripts/import-sku-images.mjs --images-dir C:\\work\\sku_images
  node scripts/import-sku-images.mjs --images-dir C:\\work\\sku_images --apply --limit 5
  node scripts/import-sku-images.mjs --images-dir C:\\work\\sku_images --apply --resume .\\sku-image-import-....jsonl
`;
}

function parseArgs(argv) {
  const args = {
    apply: false,
    imagesDir: "",
    limit: null,
    manifest: "",
    resume: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      args.apply = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (["--images-dir", "--limit", "--manifest", "--resume"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--images-dir") args.imagesDir = value;
      if (argument === "--manifest") args.manifest = value;
      if (argument === "--resume") args.resume = value;
      if (argument === "--limit") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
          throw new Error("--limit must be a positive integer");
        }
        args.limit = parsed;
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!args.imagesDir) throw new Error("--images-dir is required");
  if (args.manifest && args.resume) {
    throw new Error("Use either --manifest or --resume, not both");
  }
  return args;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeIdentifier(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().toUpperCase();
}

function increment(record, key) {
  record[key] = (record[key] || 0) + 1;
}

function isSafeMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim(), "https://relative-media.invalid");
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeError(error) {
  if (error instanceof HttpError) {
    return `${error.method} ${error.path} -> HTTP ${error.status}`;
  }
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

class ManifestWriter {
  constructor(path, runId, needsLeadingNewline = false) {
    this.path = path;
    this.runId = runId;
    this.pending = Promise.resolve();
    this.needsLeadingNewline = needsLeadingNewline;
  }

  write(event) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      run_id: this.runId,
      ...event,
    });
    this.pending = this.pending.then(async () => {
      if (this.needsLeadingNewline) {
        await appendFile(this.path, "\n", "utf8");
        this.needsLeadingNewline = false;
      }
      await appendFile(this.path, `${line}\n`, "utf8");
    });
    return this.pending;
  }

  flush() {
    return this.pending;
  }
}

async function readResumeState(path) {
  const raw = await readFile(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const endsWithNewline = /\r?\n$/.test(raw);
  const uploadedByHash = new Map();
  const updatedProducts = new Map();
  let ignoredTrailingLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      const isLastPhysicalLine = index === lines.length - 1 && !endsWithNewline;
      if (!isLastPhysicalLine) {
        throw new Error(`Invalid JSON in resume manifest at line ${index + 1}`);
      }
      ignoredTrailingLine = true;
      continue;
    }

    if (event.event === "upload_succeeded" && event.sha256 && isSafeMediaUrl(event.url)) {
      uploadedByHash.set(String(event.sha256), {
        url: String(event.url),
        fileId: event.file_id ? String(event.file_id) : null,
      });
    }
    if (event.event === "product_update_succeeded" && event.product_id && event.sha256) {
      updatedProducts.set(String(event.product_id), {
        sha256: String(event.sha256),
        url: String(event.url || ""),
      });
    }
  }

  return {
    uploadedByHash,
    updatedProducts,
    needsLeadingNewline: !endsWithNewline,
    ignoredTrailingLine,
  };
}

async function requestJson(baseUrl, token, path, options = {}) {
  const {
    method = "GET",
    body,
    form,
    timeoutMs = 30_000,
    retryStatuses = new Set(),
    retries = 0,
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
        body: form || (body === undefined ? undefined : JSON.stringify(body)),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const retryAfterSeconds = Number.parseFloat(response.headers.get("retry-after") || "");
        const retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds * 1_000)
          : null;
        throw new HttpError(method, path.split("?")[0], response.status, retryAfterMs);
      }

      if (response.status === 204) return null;
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${method} ${path.split("?")[0]} returned invalid JSON`);
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const retryableStatus = error instanceof HttpError && retryStatuses.has(error.status);
      const retryableNetwork = !(error instanceof HttpError) && error?.name === "AbortError";
      if (attempt >= retries || (!retryableStatus && !retryableNetwork)) throw error;
      const delay = error instanceof HttpError && error.retryAfterMs !== null
        ? Math.min(error.retryAfterMs, 30_000)
        : Math.min(750 * (2 ** attempt), 8_000);
      await wait(delay);
    }
  }
  throw lastError;
}

async function authenticate(baseUrl, email, password) {
  const response = await requestJson(baseUrl, "", "/auth/user/emailpass", {
    method: "POST",
    body: { email, password },
    retries: 2,
    retryStatuses: new Set([429, 500, 502, 503, 504]),
  });
  const token = typeof response?.token === "string" ? response.token : "";
  if (!token) throw new Error("Medusa authentication response did not contain a token");
  return token;
}

async function fetchAllProducts(baseUrl, token) {
  const products = [];
  let offset = 0;
  let expectedCount = null;

  while (true) {
    const query = new URLSearchParams({
      limit: String(PRODUCT_PAGE_SIZE),
      offset: String(offset),
      fields: "id,title,handle,thumbnail,*images,*variants,+metadata",
    });
    const response = await requestJson(baseUrl, token, `/admin/products?${query}`, {
      retries: 3,
      retryStatuses: new Set([429, 500, 502, 503, 504]),
    });
    const page = Array.isArray(response?.products) ? response.products : null;
    if (!page) throw new Error("Medusa product-list response did not contain products[]");
    products.push(...page);

    if (Number.isFinite(Number(response?.count))) expectedCount = Number(response.count);
    offset += page.length;
    if (page.length === 0 || page.length < PRODUCT_PAGE_SIZE) break;
    if (expectedCount !== null && offset >= expectedCount) break;
    if (offset > 100_000) throw new Error("Product pagination safety limit exceeded");
  }

  if (expectedCount !== null && products.length !== expectedCount) {
    throw new Error(`Product pagination incomplete: received ${products.length} of ${expectedCount}`);
  }
  return products;
}

async function walkImageFiles(root) {
  const files = [];
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function inspectImage(path, root) {
  const info = await stat(path);
  const extension = extname(path).toLowerCase();
  const key = normalizeIdentifier(basename(path, extension));
  const source = relative(root, path).replaceAll("\\", "/");

  if (!UUID_RE.test(key)) {
    return { path, source, key, size: info.size, valid: false, reason: "filename_is_not_canonical_uuid" };
  }
  if (info.size === 0) {
    return { path, source, key, size: info.size, valid: false, reason: "empty_file" };
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    return { path, source, key, size: info.size, valid: false, reason: "file_exceeds_5_mib" };
  }

  const handle = await open(path, "r");
  let header;
  try {
    header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = header.subarray(0, 4).toString("ascii") === "RIFF"
    && header.subarray(8, 12).toString("ascii") === "WEBP";
  const signatureMatches = extension === ".png" ? isPng : extension === ".webp" ? isWebp : isJpeg;
  if (!signatureMatches) {
    return { path, source, key, size: info.size, valid: false, reason: "extension_signature_mismatch" };
  }

  const hash = createHash("sha256");
  const bytes = await readFile(path);
  hash.update(bytes);
  return {
    path,
    source,
    key,
    size: info.size,
    sha256: hash.digest("hex"),
    mime: isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg",
    valid: true,
  };
}

function buildProductIndexes(products) {
  const byWareId = new Map();
  const skuOccurrences = new Map();

  for (const product of products) {
    const wareId = normalizeIdentifier(product?.metadata?.ware_id);
    if (wareId) {
      const matches = byWareId.get(wareId) || [];
      matches.push(product);
      byWareId.set(wareId, matches);
    }
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      const sku = normalizeIdentifier(variant?.sku);
      if (!sku) continue;
      const matches = skuOccurrences.get(sku) || [];
      matches.push({ product, variant });
      skuOccurrences.set(sku, matches);
    }
  }
  return { byWareId, skuOccurrences };
}

function classifyMapping(image, indexes) {
  const wareProducts = indexes.byWareId.get(image.key) || [];
  const skuMatches = indexes.skuOccurrences.get(image.key) || [];

  const classifyProduct = (product, variant, mappingSource) => {
    const hasThumbnail = typeof product.thumbnail === "string" && product.thumbnail.trim().length > 0;
    const hasImages = Array.isArray(product.images) && product.images.length > 0;
    if (hasThumbnail || hasImages) {
      return {
        status: "skipped_existing_media",
        product_id: product.id,
        variant_id: variant.id,
        has_thumbnail: hasThumbnail,
        image_count: Array.isArray(product.images) ? product.images.length : 0,
        mapping_source: mappingSource,
      };
    }
    return {
      status: "eligible",
      product,
      variant,
      mapping_source: mappingSource,
    };
  };

  if (wareProducts.length === 0 && skuMatches.length === 0) {
    return { status: "quarantined", reason: "unmatched_ware_id_and_sku" };
  }
  if (wareProducts.length === 0 && skuMatches.length === 1) {
    const skuMatch = skuMatches[0];
    const productWareId = normalizeIdentifier(skuMatch.product?.metadata?.ware_id);
    if (!productWareId) {
      return classifyProduct(skuMatch.product, skuMatch.variant, "unique_variant_sku_fallback");
    }
  }
  if (wareProducts.length > 1 || skuMatches.length > 1) {
    return {
      status: "quarantined",
      reason: "ambiguous_ware_id_or_sku",
      ware_product_ids: wareProducts.map((product) => product.id),
      sku_product_ids: skuMatches.map((match) => match.product.id),
    };
  }
  if (wareProducts.length !== 1 || skuMatches.length !== 1) {
    return {
      status: "quarantined",
      reason: "ware_id_sku_presence_mismatch",
      ware_product_ids: wareProducts.map((product) => product.id),
      sku_product_ids: skuMatches.map((match) => match.product.id),
    };
  }
  const product = wareProducts[0];
  const skuMatch = skuMatches[0];
  if (product.id !== skuMatch.product.id) {
    return {
      status: "quarantined",
      reason: "ware_id_sku_product_mismatch",
      ware_product_id: product.id,
      sku_product_id: skuMatch.product.id,
    };
  }

  return classifyProduct(product, skuMatch.variant, "ware_id_and_unique_variant_sku");
}

function parseUploadResponse(response) {
  const files = Array.isArray(response?.files)
    ? response.files
    : response?.file && typeof response.file === "object"
      ? [response.file]
      : Array.isArray(response)
        ? response
        : [];
  if (files.length !== 1) return null;
  const file = files[0];
  const url = typeof file?.url === "string" ? file.url.trim() : "";
  if (!isSafeMediaUrl(url)) return null;
  return { url, fileId: file?.id ? String(file.id) : null };
}

async function uploadImage(baseUrl, token, image) {
  const bytes = await readFile(image.path);
  if (bytes.length !== image.size || bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error("File changed after scan or exceeds 5 MiB");
  }
  const currentHash = createHash("sha256").update(bytes).digest("hex");
  if (currentHash !== image.sha256) {
    throw new Error("File content changed after scan");
  }
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: image.mime }), basename(image.path));
  const response = await requestJson(baseUrl, token, "/admin/uploads", {
    method: "POST",
    form,
    timeoutMs: 60_000,
    retries: 0,
  });
  const uploaded = parseUploadResponse(response);
  if (!uploaded) throw new Error("Upload response was not an unambiguous single-file mapping");
  return uploaded;
}

async function updateProduct(baseUrl, token, task, uploaded) {
  await requestJson(baseUrl, token, `/admin/products/${encodeURIComponent(task.product.id)}`, {
    method: "POST",
    body: {
      thumbnail: uploaded.url,
      images: [{ url: uploaded.url }],
    },
    retries: 4,
    retryStatuses: new Set([429, 500, 502, 503, 504]),
  });

  const query = new URLSearchParams({ fields: "id,thumbnail,*images" });
  const verification = await requestJson(
    baseUrl,
    token,
    `/admin/products/${encodeURIComponent(task.product.id)}?${query}`,
    {
      retries: 3,
      retryStatuses: new Set([429, 500, 502, 503, 504]),
    },
  );
  const product = verification?.product;
  const imageUrls = Array.isArray(product?.images)
    ? product.images.map((image) => String(image?.url || ""))
    : [];
  if (product?.id !== task.product.id || product.thumbnail !== uploaded.url || !imageUrls.includes(uploaded.url)) {
    throw new Error("Product update could not be verified");
  }
}

async function mapPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof fetch !== "function" || typeof FormData !== "function" || typeof Blob !== "function") {
    throw new Error("Node.js 20+ is required (fetch/FormData/Blob are unavailable)");
  }

  const imagesDir = resolve(args.imagesDir);
  const imagesInfo = await stat(imagesDir);
  if (!imagesInfo.isDirectory()) throw new Error("--images-dir must point to a directory");

  const medusaUrlObject = new URL(requiredEnvironment("MEDUSA_URL"));
  if (!["http:", "https:"].includes(medusaUrlObject.protocol)) {
    throw new Error("MEDUSA_URL must use http:// or https://");
  }
  if (medusaUrlObject.username || medusaUrlObject.password) {
    throw new Error("Do not embed credentials in MEDUSA_URL");
  }
  const medusaUrl = medusaUrlObject.toString().replace(/\/$/, "");
  const email = requiredEnvironment("MEDUSA_ADMIN_EMAIL");
  const password = requiredEnvironment("MEDUSA_ADMIN_PASSWORD");

  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const manifestPath = resolve(args.resume || args.manifest || `sku-image-import-${timestamp}.jsonl`);
  let resumeState = {
    uploadedByHash: new Map(),
    updatedProducts: new Map(),
    needsLeadingNewline: false,
    ignoredTrailingLine: false,
  };
  if (args.resume) resumeState = await readResumeState(manifestPath);
  await mkdir(dirname(manifestPath), { recursive: true });

  const runId = randomUUID();
  const manifest = new ManifestWriter(manifestPath, runId, resumeState.needsLeadingNewline);
  activeManifest = manifest;
  activeMode = args.apply ? "apply" : "dry_run";
  const summary = {
    image_files: 0,
    valid_images: 0,
    products: 0,
    eligible: 0,
    selected: 0,
    uploaded: 0,
    resumed_uploads: 0,
    updated: 0,
    failed_uploads: 0,
    failed_updates: 0,
    skipped_existing_media: 0,
    skipped_resume: 0,
    skipped_limit: 0,
    quarantined: 0,
    quarantine_reasons: {},
  };

  await manifest.write({
    event: "run_started",
    mode: args.apply ? "apply" : "dry_run",
    images_dir: imagesDir,
    manifest: manifestPath,
    limit: args.limit,
    resumed: Boolean(args.resume),
    ignored_truncated_resume_line: resumeState.ignoredTrailingLine,
    max_upload_bytes: MAX_UPLOAD_BYTES,
    update_concurrency: UPDATE_CONCURRENCY,
  });

  console.log(`[sku-images] mode=${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[sku-images] manifest=${manifestPath}`);
  if (args.apply && args.limit === null) {
    console.warn("[sku-images] WARNING: --apply has no --limit; every eligible product may be processed");
  }

  console.log("[sku-images] Authenticating and reading the full admin product catalogue...");
  const token = await authenticate(medusaUrl, email, password);
  const products = await fetchAllProducts(medusaUrl, token);
  summary.products = products.length;
  await manifest.write({ event: "catalogue_loaded", product_count: products.length });
  console.log(`[sku-images] products=${products.length}`);

  const paths = await walkImageFiles(imagesDir);
  summary.image_files = paths.length;
  console.log(`[sku-images] image_files=${paths.length}; validating and hashing...`);
  const images = [];
  for (const path of paths) {
    const image = await inspectImage(path, imagesDir);
    if (!image.valid) {
      summary.quarantined += 1;
      increment(summary.quarantine_reasons, image.reason);
      await manifest.write({
        event: "image_classified",
        status: "quarantined",
        quarantine_reason: image.reason,
        source: image.source,
        basename: image.key,
        size: image.size,
      });
      continue;
    }
    summary.valid_images += 1;
    images.push(image);
  }

  const byKey = new Map();
  for (const image of images) {
    const group = byKey.get(image.key) || [];
    group.push(image);
    byKey.set(image.key, group);
  }

  const uniqueImages = [];
  for (const [key, group] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const hashes = new Set(group.map((image) => image.sha256));
    if (hashes.size > 1) {
      for (const image of group) {
        summary.quarantined += 1;
        increment(summary.quarantine_reasons, "ambiguous_multiple_files_for_basename");
        await manifest.write({
          event: "image_classified",
          status: "quarantined",
          quarantine_reason: "ambiguous_multiple_files_for_basename",
          source: image.source,
          basename: key,
          sha256: image.sha256,
          size: image.size,
        });
      }
      continue;
    }
    const selected = group[0];
    uniqueImages.push(selected);
    for (const duplicate of group.slice(1)) {
      await manifest.write({
        event: "image_classified",
        status: "duplicate_source_same_content",
        source: duplicate.source,
        canonical_source: selected.source,
        basename: key,
        sha256: duplicate.sha256,
        size: duplicate.size,
      });
    }
  }

  const indexes = buildProductIndexes(products);
  const eligible = [];
  for (const image of uniqueImages) {
    const mapping = classifyMapping(image, indexes);
    if (mapping.status === "quarantined") {
      summary.quarantined += 1;
      increment(summary.quarantine_reasons, mapping.reason);
      await manifest.write({
        event: "image_classified",
        status: "quarantined",
        quarantine_reason: mapping.reason,
        source: image.source,
        basename: image.key,
        sha256: image.sha256,
        size: image.size,
        ...Object.fromEntries(Object.entries(mapping).filter(([key]) => !["status", "reason"].includes(key))),
      });
      continue;
    }
    if (mapping.status === "skipped_existing_media") {
      summary.skipped_existing_media += 1;
      await manifest.write({
        event: "image_classified",
        status: mapping.status,
        source: image.source,
        basename: image.key,
        sha256: image.sha256,
        product_id: mapping.product_id,
        variant_id: mapping.variant_id,
        has_thumbnail: mapping.has_thumbnail,
        image_count: mapping.image_count,
        mapping_source: mapping.mapping_source,
      });
      continue;
    }
    if (resumeState.updatedProducts.has(mapping.product.id)) {
      summary.skipped_resume += 1;
      await manifest.write({
        event: "image_classified",
        status: "skipped_resume_product_already_updated",
        source: image.source,
        basename: image.key,
        sha256: image.sha256,
        product_id: mapping.product.id,
        variant_id: mapping.variant.id,
        mapping_source: mapping.mapping_source,
      });
      continue;
    }
    eligible.push({
      image,
      product: mapping.product,
      variant: mapping.variant,
      mappingSource: mapping.mapping_source,
    });
    await manifest.write({
      event: "image_classified",
      status: "eligible",
      source: image.source,
      basename: image.key,
      sha256: image.sha256,
      size: image.size,
      product_id: mapping.product.id,
      variant_id: mapping.variant.id,
      mapping_source: mapping.mapping_source,
    });
  }
  summary.eligible = eligible.length;

  const selected = args.limit === null ? eligible : eligible.slice(0, args.limit);
  summary.selected = selected.length;
  summary.skipped_limit = eligible.length - selected.length;
  for (const task of eligible.slice(selected.length)) {
    await manifest.write({
      event: "image_classified",
      status: "skipped_limit",
      source: task.image.source,
      basename: task.image.key,
      sha256: task.image.sha256,
      product_id: task.product.id,
      variant_id: task.variant.id,
      mapping_source: task.mappingSource,
    });
  }

  if (!args.apply) {
    await manifest.write({ event: "run_completed", mode: "dry_run", summary });
    await manifest.flush();
    activeManifest = null;
    console.log(`[sku-images] dry-run complete; eligible=${summary.eligible}, selected=${summary.selected}, quarantined=${summary.quarantined}, existing_media=${summary.skipped_existing_media}`);
    console.log("[sku-images] No Medusa data was changed.");
    return;
  }

  const uploadedByHash = new Map(resumeState.uploadedByHash);
  const uploadRepresentatives = new Map();
  for (const task of selected) {
    if (!uploadedByHash.has(task.image.sha256) && !uploadRepresentatives.has(task.image.sha256)) {
      uploadRepresentatives.set(task.image.sha256, task.image);
    }
  }

  for (const [sha256, uploaded] of uploadedByHash) {
    if (selected.some((task) => task.image.sha256 === sha256)) {
      summary.resumed_uploads += 1;
      await manifest.write({
        event: "upload_reused",
        status: "resumed",
        sha256,
        url: uploaded.url,
        file_id: uploaded.fileId,
      });
    }
  }

  console.log(`[sku-images] unique uploads required=${uploadRepresentatives.size}`);
  for (const [sha256, image] of uploadRepresentatives) {
    await manifest.write({
      event: "upload_started",
      source: image.source,
      basename: image.key,
      sha256,
      size: image.size,
    });
    try {
      const uploaded = await uploadImage(medusaUrl, token, image);
      uploadedByHash.set(sha256, uploaded);
      summary.uploaded += 1;
      await manifest.write({
        event: "upload_succeeded",
        source: image.source,
        basename: image.key,
        sha256,
        size: image.size,
        url: uploaded.url,
        file_id: uploaded.fileId,
      });
    } catch (error) {
      summary.failed_uploads += 1;
      await manifest.write({
        event: "upload_failed",
        source: image.source,
        basename: image.key,
        sha256,
        size: image.size,
        error: safeError(error),
      });
    }
  }

  const updateTasks = selected.filter((task) => uploadedByHash.has(task.image.sha256));
  console.log(`[sku-images] product updates ready=${updateTasks.length}`);
  await mapPool(updateTasks, UPDATE_CONCURRENCY, async (task) => {
    const uploaded = uploadedByHash.get(task.image.sha256);
    await manifest.write({
      event: "product_update_started",
      product_id: task.product.id,
      variant_id: task.variant.id,
      mapping_source: task.mappingSource,
      source: task.image.source,
      basename: task.image.key,
      sha256: task.image.sha256,
      url: uploaded.url,
    });
    try {
      await updateProduct(medusaUrl, token, task, uploaded);
      summary.updated += 1;
      await manifest.write({
        event: "product_update_succeeded",
        product_id: task.product.id,
        variant_id: task.variant.id,
        mapping_source: task.mappingSource,
        source: task.image.source,
        basename: task.image.key,
        sha256: task.image.sha256,
        url: uploaded.url,
      });
    } catch (error) {
      summary.failed_updates += 1;
      await manifest.write({
        event: "product_update_failed",
        product_id: task.product.id,
        variant_id: task.variant.id,
        mapping_source: task.mappingSource,
        source: task.image.source,
        basename: task.image.key,
        sha256: task.image.sha256,
        url: uploaded.url,
        error: safeError(error),
      });
    }
  });

  await manifest.write({ event: "run_completed", mode: "apply", summary });
  await manifest.flush();
  activeManifest = null;
  console.log(`[sku-images] apply complete; uploaded=${summary.uploaded}, updated=${summary.updated}, upload_failures=${summary.failed_uploads}, update_failures=${summary.failed_updates}`);
  if (summary.failed_uploads || summary.failed_updates) process.exitCode = 2;
}

main().catch(async (error) => {
  if (activeManifest) {
    try {
      await activeManifest.write({
        event: "run_failed",
        mode: activeMode,
        error: safeError(error),
      });
      await activeManifest.flush();
    } catch {
      // Preserve the original failure; a manifest write error must not hide it.
    }
  }
  console.error(`[sku-images] fatal: ${safeError(error)}`);
  process.exitCode = 1;
});
