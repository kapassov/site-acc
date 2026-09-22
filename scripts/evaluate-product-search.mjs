#!/usr/bin/env node
/**
 * Read-only acceptance checks against the real Daribar snapshot + Typesense.
 * Examples (provide keys through the environment, never command arguments):
 * node --env-file=.env.local scripts/evaluate-product-search.mjs --snapshot data/daribar-catalog.snapshot.json --output work/search-report.json
 * node scripts/evaluate-product-search.mjs --snapshot data/daribar-catalog.snapshot.json --validate-only
 * node scripts/evaluate-product-search.mjs --snapshot data/daribar-catalog.snapshot.json --api-origin http://localhost:3101 --limit 20 --output work/search-api-report.json
 *
 * Only the explicitly requested JSON report is written. No product, index, account
 * or order mutations are performed. Console output contains test IDs and counts,
 * not credentials, raw HTTP bodies, URLs with queries, or real user searches.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { mapDaribarProduct } from "../src/lib/daribar/catalog-data.ts";
import { searchDaribarSnapshot } from "../src/lib/daribar/indexed-search.ts";

const DEFAULT_FIXTURE = fileURLToPath(new URL("../tests/fixtures/daribar-search-acceptance.json", import.meta.url));
const FIXTURE_SCHEMA = "daribar.product-search.acceptance.v1";
const safeCode = (error) => typeof error?.code === "string" && /^[a-z0-9_]{1,100}$/.test(error.code)
  ? error.code : typeof error?.message === "string" && /^[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "search_failed";
const rounded = (value) => Math.round(value * 100) / 100;

export function validateAcceptanceFixture(fixture) {
  if (!fixture || fixture.schema !== FIXTURE_SCHEMA || !Array.isArray(fixture.families) || !Array.isArray(fixture.cases)
      || fixture.families.length === 0 || fixture.cases.length === 0) throw new Error("acceptance_fixture_invalid");
  const families = new Map();
  for (const family of fixture.families) {
    if (!family || typeof family.id !== "string" || families.has(family.id) || typeof family.name !== "string"
        || !Array.isArray(family.products) || family.products.length === 0) throw new Error("acceptance_family_invalid");
    const skus = new Set();
    for (const product of family.products) {
      if (!product || typeof product.sku !== "string" || !product.sku || skus.has(product.sku)
          || typeof product.name !== "string" || !product.name.trim()) throw new Error("acceptance_evidence_invalid");
      skus.add(product.sku);
    }
    families.set(family.id, family);
  }
  const ids = new Set();
  for (const entry of fixture.cases) {
    if (!entry || typeof entry.id !== "string" || ids.has(entry.id) || !families.has(entry.familyId)
        || !["positive", "safety"].includes(entry.group) || typeof entry.kind !== "string"
        || typeof entry.query !== "string" || entry.query.length < 2 || entry.query.length > 120
        || /[\u0000-\u001f]/.test(entry.query) || !["family", "restricted", "empty"].includes(entry.expected?.type)) {
      throw new Error("acceptance_case_invalid");
    }
    ids.add(entry.id);
    if (entry.expected.type !== "empty" && ![1, 3].includes(entry.expected.rank)) throw new Error("acceptance_rank_invalid");
    if (entry.expected.type === "restricted") {
      const sourceSkus = new Set(families.get(entry.familyId).products.map((product) => product.sku));
      if (!Array.isArray(entry.expected.allowedSkus) || entry.expected.allowedSkus.length === 0
          || new Set(entry.expected.allowedSkus).size !== entry.expected.allowedSkus.length
          || entry.expected.allowedSkus.some((sku) => !sourceSkus.has(sku))) throw new Error("acceptance_constraint_invalid");
    }
  }
  return families;
}

/** This is a fixed SKU oracle, intentionally independent of the search normalizer. */
export function assessSearchCase(entry, family, products) {
  const familySkus = new Set(family.products.map((product) => product.sku));
  const allowedSkus = entry.expected.type === "restricted" ? new Set(entry.expected.allowedSkus) : familySkus;
  const rankIndex = products.findIndex((product) => allowedSkus.has(product?.sku));
  const rank = rankIndex < 0 ? null : rankIndex + 1;
  const invalidProducts = products.filter((product) => !product || product.source !== "daribar" || typeof product.sku !== "string");
  const unsafeProducts = entry.expected.type === "empty" ? products
    : entry.expected.type === "restricted" ? products.filter((product) => !allowedSkus.has(product?.sku)) : [];
  const uniqueSkus = new Set(products.map((product) => product?.sku));
  const provenanceOk = invalidProducts.length === 0 && uniqueSkus.size === products.length;
  const relevant = rank != null && rank <= (entry.expected.rank || 3);
  const pass = provenanceOk && (entry.expected.type === "empty" ? products.length === 0
    : entry.expected.type === "restricted" ? relevant && unsafeProducts.length === 0 : relevant);
  return {
    pass,
    rank: entry.expected.type === "empty" ? null : rank,
    top1: entry.expected.type === "empty" ? null : rank === 1,
    top3: entry.expected.type === "empty" ? null : rank != null && rank <= 3,
    resultCount: products.length,
    unsafeMatchCount: unsafeProducts.length,
    invalidProductCount: invalidProducts.length,
    duplicateCount: products.length - uniqueSkus.size,
    outsideFamilyCount: products.filter((product) => !familySkus.has(product?.sku)).length,
    topResults: products.slice(0, 5).map((product) => ({ sku: product?.sku ?? null, name: product?.name ?? null, source: product?.source ?? null })),
    unsafeResults: unsafeProducts.slice(0, 10).map((product) => ({ sku: product?.sku ?? null, name: product?.name ?? null })),
  };
}

export function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return rounded(sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1))]);
}

export function summarizeAcceptance(results) {
  const positives = results.filter((result) => result.group === "positive");
  const safety = results.filter((result) => result.group === "safety");
  const times = results.map((result) => result.latencyMs).filter(Number.isFinite);
  return {
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
    errors: results.filter((result) => result.errorCode).length,
    positive: {
      total: positives.length,
      passed: positives.filter((result) => result.pass).length,
      top1: positives.filter((result) => result.top1).length,
      top3: positives.filter((result) => result.top3).length,
    },
    safety: { total: safety.length, passed: safety.filter((result) => result.pass).length, unsafeMatches: safety.reduce((sum, result) => sum + (result.unsafeMatchCount || 0), 0) },
    apiConsistency: results.some((result) => result.consistent !== undefined)
      ? { checked: results.filter((result) => result.consistent !== undefined).length, passed: results.filter((result) => result.consistent).length } : null,
    latencyMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: times.length ? rounded(Math.max(...times)) : null },
    byKind: Object.fromEntries([...new Set(results.map((result) => result.kind))].map((kind) => {
      const selected = results.filter((result) => result.kind === kind);
      return [kind, { total: selected.length, passed: selected.filter((result) => result.pass).length, top3: selected.filter((result) => result.top3).length }];
    })),
  };
}

export function parseArguments(argv) {
  const options = { fixture: DEFAULT_FIXTURE, snapshot: process.env.DARIBAR_CATALOG_SNAPSHOT_PATH || "data/daribar-catalog.snapshot.json", limit: 0, concurrency: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") { options.help = true; continue; }
    if (flag === "--validate-only") { options.validateOnly = true; continue; }
    if (!["--snapshot", "--fixture", "--output", "--api-origin", "--limit", "--kind", "--family", "--city", "--concurrency"].includes(flag)) throw new Error("acceptance_argument_invalid");
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error("acceptance_argument_missing");
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = ["limit", "concurrency"].includes(key) ? Number(value) : value;
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 0 || options.limit > 1_000
      || !Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) throw new Error("acceptance_argument_invalid");
  if (options.apiOrigin) {
    let url;
    try { url = new URL(options.apiOrigin); } catch { throw new Error("acceptance_origin_invalid"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("acceptance_origin_invalid");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("acceptance_origin_requires_https");
    options.apiOrigin = url.origin;
  }
  return options;
}

async function readInputs(options) {
  const fixture = JSON.parse(await readFile(options.fixture, "utf8"));
  const families = validateAcceptanceFixture(fixture);
  const buffer = await readFile(options.snapshot);
  const raw = JSON.parse(buffer.toString("utf8"));
  if (raw.schema !== "daribar.catalog.snapshot.v1" || raw.source !== "daribar" || !Array.isArray(raw.products)
      || raw.products.length === 0 || typeof raw.city !== "string" || !Number.isFinite(Date.parse(raw.generatedAt))) throw new Error("acceptance_snapshot_invalid");
  const evidence = new Map(raw.products.map((product) => [product.sku, product.name]));
  // Missing/changed source products make the oracle stale; fail before any search.
  for (const family of families.values()) {
    for (const product of family.products) if (evidence.get(product.sku) !== product.name) throw new Error("acceptance_snapshot_evidence_changed");
  }
  const products = raw.products.map(mapDaribarProduct).filter(Boolean);
  const city = options.city || raw.city;
  if (!options.apiOrigin && city !== raw.city) throw new Error("acceptance_snapshot_city_mismatch");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const selected = fixture.cases.filter((entry) => (!options.kind || entry.kind === options.kind) && (!options.family || entry.familyId === options.family));
  const cases = options.limit ? selected.slice(0, options.limit) : selected;
  if (cases.length === 0) throw new Error("acceptance_no_cases");
  return { fixture, families, products, cases, city, generatedAt: raw.generatedAt, sha256, snapshotCount: raw.products.length };
}

async function apiJson(origin, path, params) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(new URL(`${path}?${params.toString()}`, origin), { cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`api_http_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.products)) throw new Error("api_products_invalid");
    return {
      ...payload,
      sourceHeaders: { search: response.headers.get("x-search-source"), catalog: response.headers.get("x-catalog-source") },
      latencyMs: rounded(performance.now() - started),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("api_timeout");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function evaluateApiCase(entry, family, inputs, options) {
  const params = new URLSearchParams({ q: entry.query, city: inputs.city, limit: "24" });
  if (entry.exact === true) params.set("exact", "1");
  const catalogParams = new URLSearchParams(params);
  catalogParams.set("offset", "0");
  catalogParams.set("facets", "0");
  const [search, catalog] = await Promise.all([
    apiJson(options.apiOrigin, "/api/search", params),
    apiJson(options.apiOrigin, "/api/catalog", catalogParams),
  ]);
  const searchResult = assessSearchCase(entry, family, search.products);
  const catalogResult = assessSearchCase(entry, family, catalog.products);
  const searchEngine = search.meta?.engine;
  const catalogEngine = catalog.meta?.searchEngine;
  const feedback = search.meta?.search;
  const catalogFeedback = catalog.meta?.search;
  const consistent = JSON.stringify(search.products.map((product) => product.sku)) === JSON.stringify(catalog.products.map((product) => product.sku))
    && feedback?.query === entry.query && catalogFeedback?.query === entry.query
    && feedback?.matchType === catalogFeedback?.matchType && feedback?.matchedQuery === catalogFeedback?.matchedQuery;
  const sourceOk = search.meta?.source === "daribar" && catalog.meta?.source === "daribar"
    && search.sourceHeaders.search === "daribar" && catalog.sourceHeaders.catalog === "daribar";
  const engineOk = searchEngine === "typesense" && catalogEngine === "typesense" && feedback?.degraded === false && catalogFeedback?.degraded === false;
  return {
    ...searchResult,
    pass: searchResult.pass && catalogResult.pass && consistent && engineOk && sourceOk,
    unsafeMatchCount: Math.max(searchResult.unsafeMatchCount, catalogResult.unsafeMatchCount),
    consistent,
    engineOk,
    sourceOk,
    sourceHeaders: { search: search.sourceHeaders.search, catalog: catalog.sourceHeaders.catalog },
    engine: searchEngine || "unknown",
    catalogEngine: catalogEngine || "unknown",
    searchLatencyMs: search.latencyMs,
    catalogLatencyMs: catalog.latencyMs,
    catalogAssessment: catalogResult,
    metadata: feedback || null,
  };
}

export async function runAcceptance(options) {
  const inputs = await readInputs(options);
  const source = { city: inputs.city, generatedAt: inputs.generatedAt, snapshotCount: inputs.snapshotCount, mappedCount: inputs.products.length, sha256: inputs.sha256, matchesFixtureSnapshot: inputs.sha256 === inputs.fixture.source.sha256 };
  if (options.validateOnly) {
    const validation = { validated: true, cases: inputs.cases.length, families: inputs.families.size, source };
    console.log(JSON.stringify(validation));
    return validation;
  }
  const results = new Array(inputs.cases.length);
  let cursor = 0;
  async function worker() {
    while (cursor < inputs.cases.length) {
      const index = cursor++;
      const entry = inputs.cases[index];
      const started = performance.now();
      const base = { id: entry.id, group: entry.group, kind: entry.kind, query: entry.query, family: inputs.families.get(entry.familyId).name };
      try {
        let assessed;
        if (options.apiOrigin) assessed = await evaluateApiCase(entry, inputs.families.get(entry.familyId), inputs, options);
        else {
          const result = await searchDaribarSnapshot({ query: entry.query, products: inputs.products, city: inputs.city, generatedAt: inputs.generatedAt, exact: entry.exact === true });
          assessed = { ...assessSearchCase(entry, inputs.families.get(entry.familyId), result.products), metadata: result.search, stale: result.stale, engine: "typesense" };
        }
        results[index] = { ...base, ...assessed, latencyMs: rounded(performance.now() - started) };
      } catch (error) {
        results[index] = { ...base, pass: false, top1: false, top3: false, unsafeMatchCount: 0, errorCode: safeCode(error), latencyMs: rounded(performance.now() - started) };
      }
      if (!results[index].pass) console.log(`FAIL ${entry.id}${results[index].errorCode ? ` ${results[index].errorCode}` : ""}`);
      const completed = results.filter(Boolean).length;
      if (completed % 20 === 0 || completed === results.length) console.log(`Completed ${completed}/${results.length}`);
    }
  }
  await Promise.all(Array.from({ length: options.concurrency || 1 }, worker));
  const summary = summarizeAcceptance(results);
  const report = { schema: "daribar.product-search.acceptance-report.v1", generatedAt: new Date().toISOString(), mode: options.apiOrigin ? "api_consistency" : "typesense_snapshot", source, summary, results };
  console.log(JSON.stringify(summary, null, 2));
  if (options.output) {
    const output = resolve(options.output);
    if ([resolve(options.snapshot), resolve(options.fixture)].includes(output)) throw new Error("acceptance_report_would_overwrite_input");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`Report written: ${output}`);
  }
  return report;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log("Read-only search acceptance: --snapshot PATH [--output PATH] [--api-origin ORIGIN] [--limit N] [--kind KIND] [--family ID] [--concurrency 1..4] [--validate-only]. Set TYPESENSE_URL and TYPESENSE_SEARCH_API_KEY through environment variables.");
    else {
      const report = await runAcceptance(options);
      if (report.summary?.failed > 0) process.exitCode = 1;
    }
  } catch (error) {
    console.error(safeCode(error));
    process.exitCode = 1;
  }
}
