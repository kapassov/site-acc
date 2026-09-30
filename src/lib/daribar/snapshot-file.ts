import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { DaribarRawProduct } from "./catalog-data.ts";
import { isDaribarSku } from "./ids.ts";

export const DARIBAR_CATALOG_SNAPSHOT_SCHEMA = "daribar.catalog.snapshot.v1";
export const DARIBAR_CATALOG_SNAPSHOT_SOURCE = "daribar";
export const DARIBAR_CATALOG_ROOT_CATEGORY = "145";
export const DARIBAR_CATALOG_ENDPOINT = "/api/v1/search/category";

const DEFAULT_SNAPSHOT_PATH = "data/daribar-catalog.snapshot.json";
const DEFAULT_FRESH_SECONDS = 90 * 60;
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_PRODUCTS = 200_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export type DaribarCatalogSnapshotDocument = {
  schema: typeof DARIBAR_CATALOG_SNAPSHOT_SCHEMA;
  source: typeof DARIBAR_CATALOG_SNAPSHOT_SOURCE;
  endpoint: typeof DARIBAR_CATALOG_ENDPOINT;
  rootCategory: typeof DARIBAR_CATALOG_ROOT_CATEGORY;
  generatedAt: string;
  city: string;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  pagesFetched: number;
  rawCount: number;
  uniqueCount: number;
  duplicateCount: number;
  invalidSkuCount: number;
  products: DaribarRawProduct[];
};

export type DaribarCatalogSnapshotRead = {
  products: DaribarRawProduct[];
  generatedAt: string;
  stale: boolean;
  ageMs: number;
  totalCount: number;
  uniqueCount: number;
  pagesFetched: number;
  city: string;
  sourceMode: "snapshot_file";
  path: string;
};

export class DaribarSnapshotFileError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.name = "DaribarSnapshotFileError";
    this.code = code;
    this.status = status;
  }
}

type SnapshotCacheEntry = {
  mtimeMs: number;
  size: number;
  document: DaribarCatalogSnapshotDocument;
};

type SnapshotRuntime = typeof globalThis & {
  __daribarSnapshotFiles?: Map<string, SnapshotCacheEntry>;
};

const runtime = globalThis as SnapshotRuntime;
const snapshotCache = runtime.__daribarSnapshotFiles ??= new Map<string, SnapshotCacheEntry>();

function boundedSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 7 * 24 * 60 * 60
    ? parsed
    : fallback;
}

function freshnessLimits(): { freshMs: number; maxAgeMs: number } {
  const freshSeconds = boundedSeconds(
    process.env.DARIBAR_CATALOG_SNAPSHOT_FRESH_SECONDS,
    DEFAULT_FRESH_SECONDS,
  );
  const maxAgeSeconds = boundedSeconds(
    process.env.DARIBAR_CATALOG_SNAPSHOT_MAX_AGE_SECONDS,
    DEFAULT_MAX_AGE_SECONDS,
  );
  return {
    freshMs: freshSeconds * 1_000,
    maxAgeMs: Math.max(freshSeconds, maxAgeSeconds) * 1_000,
  };
}

export function daribarCatalogSnapshotPath(pathOverride?: string): string {
  const configured = String(pathOverride || process.env.DARIBAR_CATALOG_SNAPSHOT_PATH || "").trim();
  const selected = configured || DEFAULT_SNAPSHOT_PATH;
  if (selected.includes("\0")) throw new DaribarSnapshotFileError("daribar_snapshot_path_invalid", 500);
  return isAbsolute(selected)
    ? selected
    : resolve(/* turbopackIgnore: true */ process.cwd(), selected);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function exactString(value: unknown, expected: string): boolean {
  return typeof value === "string" && value === expected;
}

function validateProducts(value: unknown, expectedCount: number): value is DaribarRawProduct[] {
  if (!Array.isArray(value) || value.length !== expectedCount || value.length > MAX_PRODUCTS) return false;
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!record(candidate) || !isDaribarSku(candidate.sku) || seen.has(candidate.sku)) return false;
    seen.add(candidate.sku);
  }
  return true;
}

function validateDocument(value: unknown): DaribarCatalogSnapshotDocument {
  if (!record(value)
      || !exactString(value.schema, DARIBAR_CATALOG_SNAPSHOT_SCHEMA)
      || !exactString(value.source, DARIBAR_CATALOG_SNAPSHOT_SOURCE)
      || !exactString(value.endpoint, DARIBAR_CATALOG_ENDPOINT)
      || !exactString(value.rootCategory, DARIBAR_CATALOG_ROOT_CATEGORY)
      || typeof value.generatedAt !== "string"
      || typeof value.city !== "string"
      || value.city.trim().length < 2
      || value.city.length > 100
      || !safeInteger(value.pageSize, 1, 500)
      || !safeInteger(value.totalCount, 1, MAX_PRODUCTS)
      || !safeInteger(value.totalPages, 1, 2_000)
      || !safeInteger(value.pagesFetched, 1, 2_000)
      || value.pagesFetched !== value.totalPages
      || !safeInteger(value.rawCount, 1, MAX_PRODUCTS)
      || !safeInteger(value.uniqueCount, 1, MAX_PRODUCTS)
      || !safeInteger(value.duplicateCount, 0, MAX_PRODUCTS)
      || !safeInteger(value.invalidSkuCount, 0, MAX_PRODUCTS)
      || value.rawCount !== value.uniqueCount + value.duplicateCount + value.invalidSkuCount
      || value.totalCount < value.uniqueCount
      || value.uniqueCount < Math.floor(value.totalCount * 0.9)
      || !validateProducts(value.products, value.uniqueCount)) {
    throw new DaribarSnapshotFileError("daribar_snapshot_invalid");
  }
  const generatedAtMs = Date.parse(value.generatedAt);
  if (!Number.isFinite(generatedAtMs) || new Date(generatedAtMs).toISOString() !== value.generatedAt) {
    throw new DaribarSnapshotFileError("daribar_snapshot_generated_at_invalid");
  }
  return value as DaribarCatalogSnapshotDocument;
}

async function loadDocument(path: string): Promise<DaribarCatalogSnapshotDocument> {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new DaribarSnapshotFileError("daribar_snapshot_file_missing");
    }
    throw new DaribarSnapshotFileError("daribar_snapshot_file_unreadable");
  }
  if (!details.isFile() || details.size < 2 || details.size > MAX_SNAPSHOT_BYTES) {
    throw new DaribarSnapshotFileError("daribar_snapshot_file_size_invalid");
  }
  const cached = snapshotCache.get(path);
  if (cached && cached.mtimeMs === details.mtimeMs && cached.size === details.size) return cached.document;

  let parsed: unknown;
  try {
    const serialized = await readFile(path, "utf8");
    if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new DaribarSnapshotFileError("daribar_snapshot_file_size_invalid");
    }
    parsed = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof DaribarSnapshotFileError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new DaribarSnapshotFileError("daribar_snapshot_file_missing");
    }
    throw new DaribarSnapshotFileError("daribar_snapshot_json_invalid");
  }
  const document = validateDocument(parsed);
  snapshotCache.clear();
  snapshotCache.set(path, { mtimeMs: details.mtimeMs, size: details.size, document });
  return document;
}

/**
 * Reads one complete Daribar snapshot. Missing, malformed or expired data throws:
 * callers must not silently fall back to a different catalogue authority.
 */
export async function readDaribarCatalogSnapshot(
  pathOverride?: string,
): Promise<DaribarCatalogSnapshotRead> {
  const path = daribarCatalogSnapshotPath(pathOverride);
  const document = await loadDocument(path);
  const generatedAtMs = Date.parse(document.generatedAt);
  const now = Date.now();
  if (generatedAtMs > now + MAX_FUTURE_SKEW_MS) {
    throw new DaribarSnapshotFileError("daribar_snapshot_generated_in_future");
  }
  const ageMs = Math.max(0, now - generatedAtMs);
  const { freshMs, maxAgeMs } = freshnessLimits();
  if (ageMs > maxAgeMs) throw new DaribarSnapshotFileError("daribar_snapshot_expired");
  return {
    products: document.products,
    generatedAt: document.generatedAt,
    stale: ageMs > freshMs,
    ageMs,
    totalCount: document.totalCount,
    uniqueCount: document.uniqueCount,
    pagesFetched: document.pagesFetched,
    city: document.city,
    sourceMode: "snapshot_file",
    path,
  };
}
