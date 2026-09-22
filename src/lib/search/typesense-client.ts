/** Server-side only. Search keys must never use a NEXT_PUBLIC_ environment variable. */
import { PRODUCT_SEARCH_MODEL_VERSION } from "./product-search-model.ts";

export const TYPESENSE_PRODUCT_SEARCH_SCHEMA = "daribar.product-search.v1";
export const TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION = PRODUCT_SEARCH_MODEL_VERSION;
export const TYPESENSE_MAX_PRODUCTS = 200_000;
const PAGE_SIZE = 250;
const COLLECTION_NAME = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 4 * 1024;

export type TypesenseConfig = {
  url: string;
  apiKey: string;
  collection: string;
  timeoutMs?: number;
  freshSeconds?: number;
  maxAgeSeconds?: number;
};

export type TypesenseIndexMetadata = {
  schema: typeof TYPESENSE_PRODUCT_SEARCH_SCHEMA;
  modelVersion: typeof TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION;
  source: "daribar";
  city: string;
  generatedAt: string;
  indexedAt: string;
  documentCount: number;
  sourceCount: number;
  previousCollection?: string;
};

export type TypesenseIndexStatus = {
  collection: string;
  metadata: TypesenseIndexMetadata;
  stale: boolean;
};

export type TypesenseSearchInput = {
  /** A name-only query; dosage, pack count and form are separate exact filters. */
  query: string;
  numbers?: readonly string[];
  forms?: readonly string[];
  expectedCity?: string;
  expectedGeneratedAt?: string;
  typos?: 0 | 1 | 2;
  useAliases?: boolean;
  prefix?: boolean;
  /** Total deadline, including metadata and every page. Partial lists are never returned. */
  timeoutMs?: number;
  maxMatches?: number;
};

export type TypesenseClientOptions = {
  config?: TypesenseConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class TypesenseSearchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.name = "TypesenseSearchError";
    this.code = code;
    this.status = status;
  }
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown, min = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= TYPESENSE_MAX_PRODUCTS;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validateTypesenseConfig(config: TypesenseConfig): TypesenseConfig {
  if (typeof window !== "undefined") throw new TypesenseSearchError("typesense_server_only", 500);
  let origin: URL;
  try { origin = new URL(config.url); } catch { throw new TypesenseSearchError("typesense_url_invalid", 500); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname.toLowerCase());
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback))
      || origin.username || origin.password || origin.search || origin.hash
      || (origin.pathname !== "/" && origin.pathname !== "")) {
    throw new TypesenseSearchError("typesense_url_invalid", 500);
  }
  if (!COLLECTION_NAME.test(config.collection) || config.collection.length > 100) {
    throw new TypesenseSearchError("typesense_collection_invalid", 500);
  }
  if (!config.apiKey || config.apiKey.length > 8_192 || /\s/.test(config.apiKey)) {
    throw new TypesenseSearchError("typesense_api_key_invalid", 500);
  }
  return { ...config, url: origin.origin };
}

export function typesenseSearchConfigured(): boolean {
  return Boolean(process.env.TYPESENSE_URL?.trim() && process.env.TYPESENSE_SEARCH_API_KEY?.trim());
}

export function getTypesenseConfig(role: "search" | "admin" = "search"): TypesenseConfig {
  const url = String(process.env.TYPESENSE_URL || "").trim();
  // An admin key is deliberately NOT a fallback for the live search runtime.
  const apiKey = String(role === "admin"
    ? process.env.TYPESENSE_ADMIN_API_KEY || ""
    : process.env.TYPESENSE_SEARCH_API_KEY || "").trim();
  if (!url || !apiKey) throw new TypesenseSearchError("typesense_not_configured");
  return validateTypesenseConfig({
    url,
    apiKey,
    collection: String(process.env.TYPESENSE_COLLECTION || "daribar-products").trim(),
    timeoutMs: integer(process.env.TYPESENSE_TIMEOUT_MS, 2_000, 100, 30_000),
    freshSeconds: integer(process.env.DARIBAR_CATALOG_SNAPSHOT_FRESH_SECONDS, 90 * 60, 1, 7 * 86_400),
    maxAgeSeconds: integer(process.env.DARIBAR_CATALOG_SNAPSHOT_MAX_AGE_SECONDS, 86_400, 1, 7 * 86_400),
  });
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new TypesenseSearchError("typesense_response_too_large");
  }
  if (!response.body) throw new TypesenseSearchError("typesense_response_empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new TypesenseSearchError("typesense_response_too_large");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function httpErrorCode(response: Response, maxBytes: number): Promise<string> {
  const fallback = `typesense_http_${response.status}`;
  if (response.status !== 422) {
    await response.body?.cancel();
    return fallback;
  }
  try {
    // Resource rejection is operationally actionable. Read only a small bounded
    // JSON body and return fixed codes; never retain provider text or documents.
    const value: unknown = JSON.parse(await boundedText(response, Math.min(maxBytes, MAX_ERROR_RESPONSE_BYTES)));
    if (!record(value)) return fallback;
    if (value.message === "Rejecting write: running out of resource type: OUT_OF_DISK") {
      return "typesense_disk_capacity_exceeded";
    }
    if (value.message === "Rejecting write: running out of resource type: OUT_OF_MEMORY") {
      return "typesense_memory_capacity_exceeded";
    }
  } catch { /* Malformed/oversized error bodies must preserve the original HTTP failure. */ }
  return fallback;
}

/** Shared with the one-shot indexer. Error bodies, URLs, queries and keys are never logged. */
export async function typesenseRequest(
  configInput: TypesenseConfig,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    rawBody?: string;
    responseType?: "json" | "text";
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<unknown> {
  const config = validateTypesenseConfig(configInput);
  if (!/^\/(?:collections|aliases|multi_search)(?:[/?]|$)/.test(path)
      || path.includes("\\") || path.includes("//") || path.includes("#")) {
    throw new TypesenseSearchError("typesense_path_invalid", 500);
  }
  const timeoutMs = integer(options.timeoutMs, integer(config.timeoutMs, 2_000, 1, 30_000), 1, 30_000);
  const maxBytes = integer(options.maxBytes, MAX_RESPONSE_BYTES, 1, 32 * 1024 * 1024);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(new URL(path, config.url), {
      method: options.method || "GET",
      headers: {
        accept: options.responseType === "text" ? "text/plain" : "application/json",
        "X-TYPESENSE-API-KEY": config.apiKey,
        ...(options.rawBody != null ? { "content-type": "text/plain" }
          : options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.rawBody != null ? { body: options.rawBody }
        : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TypesenseSearchError(await httpErrorCode(response, maxBytes), response.status);
    }
    const text = await boundedText(response, maxBytes);
    if (options.responseType === "text") return text;
    try { return JSON.parse(text) as unknown; }
    catch { throw new TypesenseSearchError("typesense_response_invalid_json"); }
  } catch (error) {
    if (error instanceof TypesenseSearchError) throw error;
    throw new TypesenseSearchError(controller.signal.aborted ? "typesense_timeout" : "typesense_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export function validateTypesenseIndexMetadata(
  value: unknown,
  documentCount?: unknown,
): TypesenseIndexMetadata {
  if (!record(value) || value.schema !== TYPESENSE_PRODUCT_SEARCH_SCHEMA
      || value.modelVersion !== TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION || value.source !== "daribar"
      || typeof value.city !== "string" || value.city.trim().length < 2 || value.city.length > 100
      || !timestamp(value.generatedAt) || !timestamp(value.indexedAt)
      || !count(value.documentCount, 1) || !count(value.sourceCount, 1)
      || value.documentCount > value.sourceCount
      || (documentCount !== undefined && documentCount !== value.documentCount)) {
    throw new TypesenseSearchError("typesense_index_metadata_invalid");
  }
  return {
    schema: TYPESENSE_PRODUCT_SEARCH_SCHEMA,
    modelVersion: TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION,
    source: "daribar",
    city: value.city,
    generatedAt: value.generatedAt,
    indexedAt: value.indexedAt,
    documentCount: value.documentCount,
    sourceCount: value.sourceCount,
    ...(typeof value.previousCollection === "string" && COLLECTION_NAME.test(value.previousCollection)
      ? { previousCollection: value.previousCollection } : {}),
  };
}

export async function getTypesenseIndexStatus(
  options: TypesenseClientOptions = {},
): Promise<TypesenseIndexStatus> {
  const config = validateTypesenseConfig(options.config || getTypesenseConfig());
  const collection = await typesenseRequest(config, `/collections/${encodeURIComponent(config.collection)}`, {
    fetchImpl: options.fetchImpl,
  });
  if (!record(collection) || typeof collection.name !== "string" || !COLLECTION_NAME.test(collection.name)
      || !count(collection.num_documents, 1)) {
    throw new TypesenseSearchError("typesense_collection_invalid_response");
  }
  const metadata = validateTypesenseIndexMetadata(collection.metadata, collection.num_documents);
  const ageMs = (options.now || Date.now)() - Date.parse(metadata.generatedAt);
  if (ageMs < -5 * 60_000) throw new TypesenseSearchError("typesense_index_future");
  const freshSeconds = integer(config.freshSeconds, 90 * 60, 1, 7 * 86_400);
  const maxAgeSeconds = Math.max(freshSeconds, integer(config.maxAgeSeconds, 86_400, 1, 7 * 86_400));
  if (ageMs > maxAgeSeconds * 1_000) throw new TypesenseSearchError("typesense_index_expired");
  return { collection: collection.name, metadata, stale: ageMs > freshSeconds * 1_000 };
}

function exactFilters(field: "numbers" | "forms", values: readonly string[] = []): string[] {
  if (values.length > 32 || values.some((value) => typeof value !== "string"
      || !/^[a-zA-Zа-яА-ЯёЁ0-9.:/%+_-]{1,100}$/.test(value))) {
    throw new TypesenseSearchError("typesense_constraint_invalid", 400);
  }
  return [...new Set(values)].map((value) => `${field}:=\`${value}\``);
}

export function buildTypesenseSearchParameters(input: TypesenseSearchInput): Record<string, string | number | boolean> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length > 300 || /[\u0000-\u001f\u007f]/.test(query) || query.includes("*")) {
    throw new TypesenseSearchError("typesense_query_invalid", 400);
  }
  const filter = [...exactFilters("numbers", input.numbers), ...exactFilters("forms", input.forms)].join(" && ");
  if (!query && !filter) throw new TypesenseSearchError("typesense_query_empty", 400);
  const withAliases = input.useAliases !== false;
  const typos = input.typos === 0 || input.typos === 1 ? input.typos : 2;
  // Even if a caller forgets to separate a mixed name such as B12, never prefix-match its number.
  const prefix = input.prefix !== false && !/\d/.test(query);
  return {
    q: query || "*",
    query_by: withAliases ? "normalized_name,aliases" : "normalized_name",
    query_by_weights: withAliases ? "4,1" : "4",
    num_typos: withAliases ? `${typos},${typos}` : String(typos),
    min_len_1typo: 5,
    // ICU's Russian tokenizer removes the soft sign: "вольторин" has nine
    // surface letters but an eight-letter index token. The source-name guard
    // still permits two edits only for actual query words of nine+ letters.
    min_len_2typo: 8,
    prefix: withAliases ? `${prefix},${prefix}` : String(prefix),
    enable_typos_for_numerical_tokens: false,
    enable_typos_for_alpha_numerical_tokens: false,
    drop_tokens_threshold: 0,
    // exhaustive_search overrides the no-token-dropping safety rule in Typesense.
    exhaustive_search: false,
    typo_tokens_threshold: TYPESENSE_MAX_PRODUCTS,
    max_candidates: 1_000,
    split_join_tokens: typos === 0 ? "off" : "fallback",
    enable_synonyms: false,
    enable_curations: false,
    filter_curated_hits: true,
    prioritize_exact_match: true,
    prioritize_token_position: true,
    text_match_type: "max_score",
    include_fields: "id",
    highlight_fields: "none",
    highlight_full_fields: "none",
    enable_highlight_v1: false,
    per_page: PAGE_SIZE,
    ...(filter ? { filter_by: filter } : {}),
  };
}

/**
 * Return EVERY matching ID in relevance order, not just an autocomplete-sized page.
 * Filters/facets/paging are applied to authoritative Daribar products by the caller.
 */
export async function searchTypesenseProductIds(
  input: TypesenseSearchInput,
  options: TypesenseClientOptions = {},
): Promise<TypesenseIndexStatus & { ids: string[]; total: number }> {
  const config = validateTypesenseConfig(options.config || getTypesenseConfig());
  const parameters = buildTypesenseSearchParameters(input);
  const now = options.now || Date.now;
  const deadline = now() + integer(input.timeoutMs, 5_000, 1, 30_000);
  const remaining = () => {
    const ms = deadline - now();
    if (ms <= 0) throw new TypesenseSearchError("typesense_timeout");
    return Math.min(ms, integer(config.timeoutMs, 2_000, 1, 30_000));
  };
  const status = await getTypesenseIndexStatus({
    ...options,
    config: { ...config, timeoutMs: remaining() },
  });
  if (input.expectedCity && input.expectedCity.trim().toLocaleLowerCase("ru") !== status.metadata.city.trim().toLocaleLowerCase("ru")) {
    throw new TypesenseSearchError("typesense_index_city_mismatch");
  }
  if (input.expectedGeneratedAt && input.expectedGeneratedAt !== status.metadata.generatedAt) {
    throw new TypesenseSearchError("typesense_index_snapshot_mismatch");
  }
  const maxMatches = integer(input.maxMatches, TYPESENSE_MAX_PRODUCTS, 1, TYPESENSE_MAX_PRODUCTS);
  const pages = new Map<number, string[]>();
  let expectedTotal: number | undefined;
  async function page(pageNumber: number): Promise<void> {
    // POST prevents pharmacy search phrases from appearing in URL/access logs.
    const envelope = await typesenseRequest(config, "/multi_search", {
      method: "POST",
      body: { searches: [{ ...parameters, collection: status.collection, page: pageNumber }] },
      fetchImpl: options.fetchImpl,
      timeoutMs: remaining(),
    });
    if (!record(envelope) || !Array.isArray(envelope.results) || envelope.results.length !== 1
        || !record(envelope.results[0])) {
      throw new TypesenseSearchError("typesense_search_invalid_response");
    }
    const result = envelope.results[0];
    if (result.error || result.search_cutoff === true) throw new TypesenseSearchError("typesense_search_incomplete");
    if (!count(result.found) || result.found > status.metadata.documentCount || result.found > maxMatches
        || !Array.isArray(result.hits) || result.hits.length > PAGE_SIZE) {
      throw new TypesenseSearchError("typesense_search_count_invalid");
    }
    if (expectedTotal !== undefined && expectedTotal !== result.found) {
      throw new TypesenseSearchError("typesense_search_count_changed");
    }
    expectedTotal = result.found;
    const ids = result.hits.map((hit: unknown) => {
      if (!record(hit) || !record(hit.document) || typeof hit.document.id !== "string"
          || !/^[A-Za-z0-9._:-]{1,160}$/.test(hit.document.id)) {
        throw new TypesenseSearchError("typesense_search_hit_invalid");
      }
      return hit.document.id;
    });
    const expectedLength = Math.max(0, Math.min(PAGE_SIZE, expectedTotal - (pageNumber - 1) * PAGE_SIZE));
    if (ids.length !== expectedLength) throw new TypesenseSearchError("typesense_search_incomplete");
    pages.set(pageNumber, ids);
  }
  await page(1);
  const total = expectedTotal ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  // Bounded parallel pages; every request pins the same immutable collection.
  for (let start = 2; start <= totalPages; start += 4) {
    await Promise.all(Array.from({ length: Math.min(4, totalPages - start + 1) }, (_, offset) => page(start + offset)));
  }
  const ids = [...pages.entries()].sort(([left], [right]) => left - right).flatMap(([, values]) => values);
  if (ids.length !== total || new Set(ids).size !== total) throw new TypesenseSearchError("typesense_search_incomplete");
  return { ...status, ids, total };
}
