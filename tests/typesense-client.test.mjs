import assert from "node:assert/strict";
import test from "node:test";
import {
  TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION,
  TYPESENSE_PRODUCT_SEARCH_SCHEMA,
  buildTypesenseSearchParameters,
  getTypesenseConfig,
  getTypesenseIndexStatus,
  searchTypesenseProductIds,
  typesenseRequest,
  validateTypesenseConfig,
} from "../src/lib/search/typesense-client.ts";

const NOW = Date.now();
const config = { url: "http://127.0.0.1:8108", apiKey: "test-search-key", collection: "daribar-products", timeoutMs: 500 };
const physical = "daribar-products__20260827T120000000Z_123456abcdef";
const metadata = (count = 1, overrides = {}) => ({
  schema: TYPESENSE_PRODUCT_SEARCH_SCHEMA,
  modelVersion: TYPESENSE_PRODUCT_SEARCH_MODEL_VERSION,
  source: "daribar", city: "Алматы",
  generatedAt: new Date(NOW - 1000).toISOString(), indexedAt: new Date(NOW).toISOString(),
  documentCount: count, sourceCount: count, ...overrides,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function mockSearch({ count = 1, overrides = {}, alterResult } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (url.pathname.startsWith("/collections/")) return json({ name: physical, num_documents: count, metadata: metadata(count, overrides) });
      assert.equal(url.pathname, "/multi_search");
      const query = JSON.parse(options.body).searches[0];
      const start = (query.page - 1) * query.per_page;
      const result = {
        found: count,
        hits: Array.from({ length: Math.max(0, Math.min(query.per_page, count - start)) }, (_, index) => ({ document: { id: `daribar:${start + index}` } })),
      };
      return json({ results: [alterResult ? alterResult(result, query) : result] });
    },
  };
}

test("Typesense accepts loopback HTTP and TLS, rejects credentials and public cleartext origins", () => {
  assert.equal(validateTypesenseConfig(config).url, "http://127.0.0.1:8108");
  assert.equal(validateTypesenseConfig({ ...config, url: "https://example.test" }).url, "https://example.test");
  for (const url of ["http://example.test", "http://user:password@127.0.0.1:8108", "http://127.0.0.1:8108/path", "http://127.0.0.1:8108?key=bad", "file:///a"]) {
    assert.throws(() => validateTypesenseConfig({ ...config, url }), /typesense_url_invalid/);
  }
});

test("live search never falls back to the admin key", () => {
  const names = ["TYPESENSE_URL", "TYPESENSE_SEARCH_API_KEY", "TYPESENSE_ADMIN_API_KEY"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.TYPESENSE_URL = config.url;
    process.env.TYPESENSE_ADMIN_API_KEY = "test-admin-key";
    delete process.env.TYPESENSE_SEARCH_API_KEY;
    assert.throws(() => getTypesenseConfig("search"), /typesense_not_configured/);
    assert.equal(getTypesenseConfig("admin").apiKey, "test-admin-key");
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("search never drops name terms or modifies numbers, units and forms", () => {
  const params = buildTypesenseSearchParameters({ query: "парацитомол", numbers: ["mg:500", "count:10"], forms: ["tablet"] });
  assert.equal(params.drop_tokens_threshold, 0);
  assert.equal(params.exhaustive_search, false);
  assert.equal(params.enable_typos_for_numerical_tokens, false);
  assert.equal(params.enable_typos_for_alpha_numerical_tokens, false);
  assert.equal(params.min_len_1typo, 5);
  assert.equal(params.min_len_2typo, 8);
  assert.equal(params.filter_by, "numbers:=`mg:500` && numbers:=`count:10` && forms:=`tablet`");
  assert.equal(params.enable_synonyms, false);
  assert.equal(params.enable_curations, false);
});

test("literal passes disable typos, aliases and split/join; alphanumeric names cannot prefix-match", () => {
  const params = buildTypesenseSearchParameters({ query: "b12", typos: 0, useAliases: false });
  assert.equal(params.query_by, "normalized_name");
  assert.equal(params.num_typos, "0");
  assert.equal(params.prefix, "false");
  assert.equal(params.split_join_tokens, "off");
  assert.equal(buildTypesenseSearchParameters({ query: "нурофен", typos: 1 }).num_typos, "1,1");
});

test("untrusted query constraints cannot inject a Typesense filter", () => {
  for (const value of ["x` || id:*", "mg:50 && id:*", "", "\n"]) {
    assert.throws(() => buildTypesenseSearchParameters({ query: "x", numbers: [value] }), /typesense_constraint_invalid/);
  }
  assert.throws(() => buildTypesenseSearchParameters({ query: "*" }), /typesense_query_invalid/);
  assert.throws(() => buildTypesenseSearchParameters({ query: "" }), /typesense_query_empty/);
  assert.equal(buildTypesenseSearchParameters({ query: "", numbers: ["alnum:b12"] }).q, "*");
});

test("retrieves all 1001 IDs in relevance order and pins immutable collection across pages", async () => {
  const mock = mockSearch({ count: 1001 });
  const result = await searchTypesenseProductIds({ query: "нурофен", expectedCity: "Алматы", expectedGeneratedAt: metadata().generatedAt }, { config, fetchImpl: mock.fetchImpl, now: () => NOW });
  assert.equal(result.total, 1001);
  assert.deepEqual(result.ids, Array.from({ length: 1001 }, (_, index) => `daribar:${index}`));
  assert.equal(mock.calls.length, 6);
  for (const call of mock.calls.slice(1)) {
    assert.equal(call.url, "http://127.0.0.1:8108/multi_search");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers["X-TYPESENSE-API-KEY"], "test-search-key");
    assert.equal(call.options.redirect, "error");
    assert.equal(JSON.parse(call.options.body).searches[0].collection, physical);
  }
});

test("stale-but-permitted metadata is visible; expired or mismatched city/snapshot is rejected", async () => {
  const stale = mockSearch({ overrides: { generatedAt: new Date(NOW - 120_000).toISOString() } });
  const custom = { ...config, freshSeconds: 60, maxAgeSeconds: 300 };
  assert.equal((await getTypesenseIndexStatus({ config: custom, fetchImpl: stale.fetchImpl, now: () => NOW })).stale, true);
  await assert.rejects(() => searchTypesenseProductIds({ query: "x", expectedCity: "Астана" }, { config, fetchImpl: stale.fetchImpl, now: () => NOW }), /typesense_index_city_mismatch/);
  await assert.rejects(() => searchTypesenseProductIds({ query: "x", expectedGeneratedAt: new Date(NOW).toISOString() }, { config, fetchImpl: stale.fetchImpl, now: () => NOW }), /typesense_index_snapshot_mismatch/);
  const expired = mockSearch({ overrides: { generatedAt: new Date(NOW - 301_000).toISOString() } });
  await assert.rejects(() => getTypesenseIndexStatus({ config: custom, fetchImpl: expired.fetchImpl, now: () => NOW }), /typesense_index_expired/);
});

test("a different catalogue authority or model version never supplies IDs", async () => {
  for (const overrides of [{ source: "medusa" }, { modelVersion: "old" }, { documentCount: 2 }]) {
    const mock = mockSearch({ overrides });
    await assert.rejects(() => searchTypesenseProductIds({ query: "x" }, { config, fetchImpl: mock.fetchImpl, now: () => NOW }), /typesense_index_metadata_invalid/);
    assert.equal(mock.calls.length, 1);
  }
});

test("partial, duplicated, cut-off and changing result pages fail instead of hiding products", async () => {
  for (const alterResult of [
    (value) => ({ ...value, hits: value.hits.slice(1) }),
    (value) => ({ ...value, hits: value.hits.map(() => ({ document: { id: "same" } })) }),
    (value) => ({ ...value, search_cutoff: true }),
    (value, query) => ({ ...value, found: query.page === 1 ? value.found : value.found - 1 }),
  ]) {
    const mock = mockSearch({ count: 251, alterResult });
    await assert.rejects(() => searchTypesenseProductIds({ query: "x" }, { config, fetchImpl: mock.fetchImpl, now: () => NOW }), /typesense_search_(incomplete|count_changed)/);
  }
});

test("valid zero matches return an empty list without interpreting server errors as no results", async () => {
  const mock = mockSearch({ count: 1, alterResult: () => ({ found: 0, hits: [] }) });
  assert.deepEqual((await searchTypesenseProductIds({ query: "nothing" }, { config, fetchImpl: mock.fetchImpl, now: () => NOW })).ids, []);
  const broken = mockSearch({ alterResult: () => ({ code: 400, error: "sensitive query text" }) });
  await assert.rejects(() => searchTypesenseProductIds({ query: "nothing" }, { config, fetchImpl: broken.fetchImpl, now: () => NOW }), /typesense_search_incomplete/);
});

test("transport bounds bytes and redacts upstream HTTP/network errors", async () => {
  await assert.rejects(() => typesenseRequest(config, "/collections/x", {
    fetchImpl: async () => new Response("SECRET KEY OR QUERY", { status: 401 }),
  }), (error) => error.message === "typesense_http_401");
  await assert.rejects(() => typesenseRequest(config, "/collections/x", {
    maxBytes: 5,
    fetchImpl: async () => new Response("TOO MUCH CONTENT"),
  }), /typesense_response_too_large/);
  await assert.rejects(() => typesenseRequest(config, "/collections/x", {
    fetchImpl: async () => { throw new TypeError("url with a secret"); },
  }), (error) => error.message === "typesense_unavailable");
});

test("transport timeout covers reading the response and cannot expose credentials", async () => {
  await assert.rejects(() => typesenseRequest(config, "/collections/x", {
    timeoutMs: 5,
    fetchImpl: async (_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  }), /typesense_timeout/);
});

test("capacity write failures report an actionable safe code while retaining HTTP422", async () => {
  for (const [resource, expected] of [
    ["OUT_OF_DISK", "typesense_disk_capacity_exceeded"],
    ["OUT_OF_MEMORY", "typesense_memory_capacity_exceeded"],
  ]) {
    await assert.rejects(() => typesenseRequest(config, "/collections", {
      method: "POST", body: { name: "private-product-query" },
      fetchImpl: async () => json({
        message: `Rejecting write: running out of resource type: ${resource}`,
        document: "SECRET KEY OR QUERY",
      }, 422),
    }), (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, expected);
      assert.equal(error.message, expected);
      assert.ok(!JSON.stringify(error).includes("SECRET"));
      assert.ok(!String(error.stack).includes("private-product-query"));
      return true;
    });
  }
});

test("unrecognized, malformed and oversized HTTP422 bodies remain generic and redacted", async () => {
  for (const makeResponse of [
    () => json({ message: "Validation failed for SECRET KEY OR QUERY OUT_OF_DISK" }, 422),
    () => json({ message: "Rejecting write: running out of resource type: OUT_OF_CPU" }, 422),
    () => json({ message: "Rejecting write: running out of resource type: OUT_OF_DISK", document: "s".repeat(4096) }, 422),
    () => new Response("SECRET KEY OR QUERY", { status: 422 }),
    () => new Response(null, { status: 422 }),
    () => new Response("SECRET", { status: 422, headers: { "content-length": "9999999" } }),
  ]) {
    await assert.rejects(() => typesenseRequest(config, "/collections", {
      method: "POST", body: {}, fetchImpl: async () => makeResponse(),
    }), (error) => error.status === 422 && error.code === "typesense_http_422" && error.message === "typesense_http_422");
  }
  await assert.rejects(() => typesenseRequest(config, "/collections", {
    method: "POST", body: {},
    fetchImpl: async () => json({ message: "Rejecting write: running out of resource type: OUT_OF_DISK" }, 500),
  }), (error) => error.status === 500 && error.message === "typesense_http_500");
});
