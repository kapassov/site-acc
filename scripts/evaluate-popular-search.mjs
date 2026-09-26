#!/usr/bin/env node
/** Deterministic 500-product search acceptance against a real Daribar snapshot. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mapDaribarProduct } from "../src/lib/daribar/catalog-data.ts";
import { searchDaribarSnapshot } from "../src/lib/daribar/indexed-search.ts";
import { boundedProductNameDistance } from "../src/lib/search/search-ranking.ts";
import { parseProductSearchQuery } from "../src/lib/search/product-search-model.ts";

const snapshotPath = resolve(process.argv[2] || "data/daribar-catalog.snapshot.json");
const reportPath = process.argv[3] ? resolve(process.argv[3]) : null;
const raw = JSON.parse(await readFile(snapshotPath, "utf8"));
if (raw.schema !== "daribar.catalog.snapshot.v1" || !Array.isArray(raw.products)
    || typeof raw.generatedAt !== "string" || !raw.city) throw new Error("popular_search_snapshot_invalid");

const products = raw.products.map(mapDaribarProduct).filter(Boolean);
const bySku = new Map(products.map((product) => [product.sku, product]));
const popular = [...raw.products]
  .filter((product) => bySku.has(product.sku) && Number(product.clicks) > 0)
  .sort((left, right) => Number(right.clicks) - Number(left.clicks) || String(left.sku).localeCompare(String(right.sku)))
  .slice(0, 500);
if (popular.length !== 500) throw new Error("popular_search_insufficient_clicked_products");

const lead = (name) => parseProductSearchQuery(name).nameQuery.split(/\s+/u)[0] || "";
const byLead = new Map();
for (const product of products) {
  const word = lead(product.name);
  if (!word) continue;
  const matches = byLead.get(word) || [];
  matches.push(product.id);
  byLead.set(word, matches);
}
const byLength = new Map();
for (const word of byLead.keys()) {
  const size = [...word].length;
  const words = byLength.get(size) || [];
  words.push(word);
  byLength.set(size, words);
}

// A source-backed test index supplies identity candidates. The production Typesense
// transport/configuration is covered separately; this suite exercises search parsing,
// spelling passes, source-name guards, constraints and final ranking for 500 real SKUs.
async function sourceIndex(request) {
  const word = request.query.split(/\s+/u)[0] || "";
  const matches = new Set(byLead.get(word) || []);
  const typos = request.typos || 0;
  if (typos && word.length >= 5) {
    const size = [...word].length;
    for (let length = size - typos; length <= size + typos; length += 1) {
      for (const candidate of byLength.get(length) || []) {
        if (candidate !== word && boundedProductNameDistance(candidate, word, typos) <= typos) {
          for (const id of byLead.get(candidate) || []) matches.add(id);
        }
      }
    }
  }
  const ids = [...matches];
  return { ids, total: ids.length, stale: false, collection: "source-fixture", metadata: {} };
}

const normalizedTitle = (name) => String(name).normalize("NFKC").toLocaleLowerCase("ru-RU")
  .replace(/\s+/gu, " ").trim();
const results = [];
for (const item of popular) {
  const expected = bySku.get(item.sku);
  const result = await searchDaribarSnapshot({
    query: item.name.trim(), products, city: raw.city, generatedAt: raw.generatedAt,
  }, sourceIndex);
  const top = result.products.slice(0, 3);
  results.push({
    kind: "exact_popular_product", sku: item.sku, clicks: Number(item.clicks), query: item.name.trim(),
    pass: top.some((product) => normalizedTitle(product.name) === normalizedTitle(expected.name)),
    top: top.map((product) => ({ sku: product.sku, name: product.name })),
  });
}

// Extra misspelling checks use a deterministic vowel change in popular lead names.
const testedLeads = new Set();
const swap = { а: "о", о: "а", е: "и", и: "е" };
for (const item of popular) {
  if (results.length >= 600) break;
  const expectedLead = lead(item.name);
  if (!/^[а-я]{6,40}$/u.test(expectedLead) || testedLeads.has(expectedLead)) continue;
  const position = [...expectedLead].findIndex((letter) => swap[letter]);
  if (position < 0) continue;
  const letters = [...expectedLead];
  letters[position] = swap[letters[position]];
  const query = letters.join("");
  if (byLead.has(query)) continue; // A real title must never be overwritten by a typo guess.
  testedLeads.add(expectedLead);
  const result = await searchDaribarSnapshot({
    query, products, city: raw.city, generatedAt: raw.generatedAt,
  }, sourceIndex);
  results.push({
    kind: "popular_name_typo", sku: item.sku, clicks: Number(item.clicks), query,
    expectedLead,
    pass: result.products.slice(0, 3).some((product) => lead(product.name) === expectedLead),
    top: result.products.slice(0, 3).map((product) => ({ sku: product.sku, name: product.name })),
  });
}

const aspirin = await searchDaribarSnapshot({ query: "оспирин", products, city: raw.city,
  generatedAt: raw.generatedAt }, sourceIndex);
results.push({ kind: "reported_typo", query: "оспирин", expectedLead: "аспирин",
  pass: aspirin.products.slice(0, 3).some((product) => lead(product.name) === "аспирин"),
  top: aspirin.products.slice(0, 3).map((product) => ({ sku: product.sku, name: product.name })) });

const summary = {
  snapshotGeneratedAt: raw.generatedAt, snapshotCount: raw.products.length,
  popularSelection: "Daribar clicks descending, 500 unique SKUs",
  total: results.length, passed: results.filter((item) => item.pass).length,
  failed: results.filter((item) => !item.pass).length,
  byKind: Object.fromEntries([...new Set(results.map((item) => item.kind))].map((kind) => [kind, {
    total: results.filter((item) => item.kind === kind).length,
    passed: results.filter((item) => item.kind === kind && item.pass).length,
  }])),
};
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ summary, results }, null, 2) + "\n");
}
console.log(JSON.stringify({ summary, failures: results.filter((item) => !item.pass).slice(0, 20) }, null, 2));
if (summary.failed) process.exitCode = 1;
