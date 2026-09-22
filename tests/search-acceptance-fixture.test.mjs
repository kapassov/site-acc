import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assessSearchCase, parseArguments, percentile, summarizeAcceptance, validateAcceptanceFixture } from "../scripts/evaluate-product-search.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/daribar-search-acceptance.json", import.meta.url), "utf8"));
const families = validateAcceptanceFixture(fixture);
const source = readFileSync(new URL("../scripts/evaluate-product-search.mjs", import.meta.url), "utf8");
const product = (record) => ({ ...record, source: "daribar" });

// Independent textbook edit distance, used only to validate authored test inputs.
// This is not the product matching implementation and does not produce expected IDs.
function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]));
    }
  }
  return rows[left.length][right.length];
}

test("real Daribar acceptance fixture has 150 positives and 30 safety checks across 30 medicines", () => {
  assert.equal(fixture.cases.length, 180);
  assert.equal(fixture.families.length, 30);
  assert.equal(fixture.families.reduce((sum, family) => sum + family.products.length, 0), 268);
  assert.equal(fixture.source.totalCount, 29215);
  assert.match(fixture.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.cases.filter((entry) => entry.group === "positive").length, 150);
  assert.equal(fixture.cases.filter((entry) => entry.group === "safety").length, 30);
  for (const [kind, count] of Object.entries({ exact: 30, one_edit: 30, transposition: 30, wrong_layout: 30, latin_alias: 15, two_edits: 15, dose_negative: 10, form_negative: 10, numeric_disambiguation: 10 })) {
    assert.equal(fixture.cases.filter((entry) => entry.kind === kind).length, count, kind);
  }
  assert.equal(new Set(fixture.cases.map((entry) => entry.query)).size, 180);
});

test("positive fixture queries are exactly the authored edit class, not arbitrary matching strings", () => {
  for (const entry of fixture.cases.filter((entry) => entry.group === "positive")) {
    const name = families.get(entry.familyId).name.toLocaleLowerCase("ru");
    const query = entry.query.toLocaleLowerCase("ru");
    if (entry.kind === "exact") assert.equal(query, name);
    if (entry.kind === "one_edit") assert.equal(editDistance(name, query), 1, entry.id);
    if (entry.kind === "two_edits") {
      assert.equal(editDistance(name, query), 2, entry.id);
      assert.ok(query.length >= 9, entry.id);
    }
    if (entry.kind === "transposition") {
      const swaps = [...name].slice(0, -1).map((_, index) => `${name.slice(0, index)}${name[index + 1]}${name[index]}${name.slice(index + 2)}`);
      assert.notEqual(query, name);
      assert.ok(swaps.includes(query), entry.id);
    }
    if (entry.kind === "latin_alias") assert.match(entry.query, /^[a-z]+$/);
    if (entry.kind === "wrong_layout") assert.match(entry.query, /^[a-z\[\];',.`]+$/);
  }
});

test("source evidence consists of distinct literal Daribar SKU/name pairs, not predicted results", () => {
  for (const family of fixture.families) {
    assert.equal(new Set(family.products.map((row) => row.sku)).size, family.products.length);
    assert.ok(family.products.every((row) => row.name.toLocaleLowerCase("ru").startsWith(family.name.toLocaleLowerCase("ru"))));
  }
  assert.ok(!families.get("amoxicillin").products.some((row) => row.name.startsWith("Амоксициллин+")), "combination products are not the same base name");
  assert.doesNotMatch(source, /from ["'][^"']*product-search-model/);
  assert.doesNotMatch(source, /parseProductSearchQuery|matchesProductSearchConstraints|searchProductsByName/);
  assert.match(source, /evidence\.get\(product\.sku\) !== product\.name/);
});

test("fixed-SKU relevance oracle measures top1 and top3 separately", () => {
  const entry = fixture.cases.find((item) => item.kind === "one_edit");
  const family = families.get(entry.familyId);
  const correct = product(family.products[0]);
  const other = { sku: "different-drug", name: "Другой препарат", source: "daribar" };
  const second = assessSearchCase(entry, family, [other, correct]);
  assert.equal(second.pass, true);
  assert.equal(second.top1, false);
  assert.equal(second.top3, true);
  assert.equal(second.rank, 2);
  const exact = { ...entry, expected: { type: "family", rank: 1 } };
  assert.equal(assessSearchCase(exact, family, [other, correct]).pass, false);
  assert.equal(assessSearchCase(entry, family, [other]).pass, false);
  assert.equal(assessSearchCase(entry, family, []).pass, false);
});

test("safety oracle rejects unsafe results anywhere in the result set, not just top3", () => {
  const entry = fixture.cases.find((item) => item.expected.type === "restricted");
  const family = families.get(entry.familyId);
  const allowed = family.products.filter((row) => entry.expected.allowedSkus.includes(row.sku)).map(product);
  const forbidden = family.products.find((row) => !entry.expected.allowedSkus.includes(row.sku));
  assert.ok(allowed.length >= 3);
  assert.equal(assessSearchCase(entry, family, allowed).pass, true);
  const result = assessSearchCase(entry, family, [...allowed, product(forbidden)]);
  assert.equal(result.top3, true);
  assert.equal(result.pass, false);
  assert.equal(result.unsafeMatchCount, 1);
  assert.equal(assessSearchCase(entry, family, []).pass, false, "returning nothing is not a successful constrained lookup");
});

test("negative queries require a genuine empty result and do not accept different drugs", () => {
  const entry = fixture.cases.find((item) => item.expected.type === "empty");
  const family = families.get(entry.familyId);
  assert.equal(assessSearchCase(entry, family, []).pass, true);
  const result = assessSearchCase(entry, family, [product(family.products[0])]);
  assert.equal(result.pass, false);
  assert.equal(result.unsafeMatchCount, 1);
});

test("oracle rejects invalid provenance and duplicate IDs even if the right name is present", () => {
  const entry = fixture.cases[0];
  const family = families.get(entry.familyId);
  const correct = product(family.products[0]);
  assert.equal(assessSearchCase(entry, family, [{ ...correct, source: "other" }]).pass, false);
  assert.equal(assessSearchCase(entry, family, [correct, correct]).pass, false);
  assert.equal(assessSearchCase(entry, family, [null, correct]).pass, false);
});

test("summary reports genuine pass totals, safety violations and nearest-rank latency percentiles", () => {
  const rows = [
    { group: "positive", kind: "exact", pass: true, top1: true, top3: true, latencyMs: 10 },
    { group: "positive", kind: "one_edit", pass: true, top1: false, top3: true, latencyMs: 20 },
    { group: "safety", kind: "dose_negative", pass: false, unsafeMatchCount: 2, latencyMs: 30 },
    { group: "safety", kind: "form_negative", pass: false, errorCode: "typesense_timeout", latencyMs: 100 },
  ];
  const summary = summarizeAcceptance(rows);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 2);
  assert.equal(summary.errors, 1);
  assert.deepEqual(summary.positive, { total: 2, passed: 2, top1: 1, top3: 2 });
  assert.deepEqual(summary.safety, { total: 2, passed: 0, unsafeMatches: 2 });
  assert.deepEqual(summary.latencyMs, { p50: 20, p95: 100, max: 100 });
  assert.equal(percentile([], 0.95), null);
});

test("fixture validator rejects changed or invalid acceptance definitions", () => {
  const duplicate = structuredClone(fixture);
  duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => validateAcceptanceFixture(duplicate), /acceptance_case_invalid/);
  const unknownSku = structuredClone(fixture);
  unknownSku.cases.find((entry) => entry.expected.type === "restricted").expected.allowedSkus.push("manufactured-sku");
  assert.throws(() => validateAcceptanceFixture(unknownSku), /acceptance_constraint_invalid/);
});

test("CLI has read-only validation and API modes without accepting credentials as flags", () => {
  const args = parseArguments(["--snapshot", "snapshot.json", "--limit", "10", "--kind", "one_edit", "--validate-only"]);
  assert.equal(args.snapshot, "snapshot.json");
  assert.equal(args.limit, 10);
  assert.equal(args.validateOnly, true);
  assert.equal(parseArguments(["--api-origin", "http://localhost:3101"]).apiOrigin, "http://localhost:3101");
  assert.throws(() => parseArguments(["--api-origin", "https://user:password@example.test"]), /acceptance_origin_invalid/);
  assert.throws(() => parseArguments(["--api-key", "secret"]), /acceptance_argument_invalid/);
  assert.throws(() => parseArguments(["--limit", "-1"]), /acceptance_argument_invalid/);
  assert.throws(() => parseArguments(["--concurrency", "100"]), /acceptance_argument_invalid/);
  assert.match(source, /searchDaribarSnapshot\(/);
  assert.match(source, /raw\.products\.map\(mapDaribarProduct\)/);
  assert.match(source, /"\/api\/search"/);
  assert.match(source, /"\/api\/catalog"/);
  assert.match(source, /response\.headers\.get\("x-search-source"\)/);
  assert.match(source, /response\.headers\.get\("x-catalog-source"\)/);
  assert.match(source, /search\.meta\?\.source === "daribar" && catalog\.meta\?\.source === "daribar"/);
  assert.match(source, /consistent && engineOk && sourceOk/);
  assert.match(source, /if \(options\.validateOnly\)/);
  assert.match(source, /acceptance_report_would_overwrite_input/);
});
