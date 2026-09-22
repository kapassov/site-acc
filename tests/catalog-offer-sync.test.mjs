import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizePharmacyPayload,
  parseOfferSyncArgs,
  retryableTransactionError,
  transactionRetryDelayMs,
  validProductId,
} from "../scripts/lib/medusa-offer-sync.mjs";

test("offer payload is normalized and duplicate pharmacy ids are deterministic", () => {
  const result = normalizePharmacyPayload({ pharmacies: [
    { id: "ph_2", name: "Аптека г. Алматы", price: 5200 },
    { id: "ph_1", name: "Аптека 1", city: "Астана", address: "Абая 1", price: 5000 },
    { id: "ph_1", name: "Аптека 1", city: "Астана", price: 5100 },
  ] });
  assert.equal(result.status, "valid");
  assert.deepEqual(result.offers.map(({ id, price }) => ({ id, price })), [
    { id: "ph_1", price: 5000 },
    { id: "ph_2", price: 5200 },
  ]);
  assert.equal(result.offers[1].city, "Алматы");
});

test("empty and partially malformed snapshots are never accepted for replacement", () => {
  assert.equal(normalizePharmacyPayload({ pharmacies: [] }).status, "empty");
  assert.equal(normalizePharmacyPayload({ pharmacies: [{ id: "ph_1", price: 0 }] }).status, "invalid");
  assert.equal(normalizePharmacyPayload({ pharmacies: [{ id: "ph_1", price: 100 }, null] }).status, "invalid");
  assert.equal(normalizePharmacyPayload({}).status, "invalid");
});

test("only deadlock and serialization failures receive bounded transaction retries", () => {
  assert.equal(retryableTransactionError({ code: "40P01" }), true);
  assert.equal(retryableTransactionError({ code: "40001" }), true);
  assert.equal(retryableTransactionError({ code: "23505" }), false);
  assert.equal(retryableTransactionError(new Error("deadlock text without SQLSTATE")), false);
  assert.equal(transactionRetryDelayMs(1, 0), 100);
  assert.equal(transactionRetryDelayMs(5, 99), 1_699);
  assert.equal(transactionRetryDelayMs(99, 99), 2_099);
});

test("sync options are bounded and apply is explicit", () => {
  const defaults = parseOfferSyncArgs([], {});
  assert.equal(defaults.apply, false);
  assert.equal(defaults.limit, 300);
  assert.equal(defaults.concurrency, 3);
  assert.equal(parseOfferSyncArgs(["--apply", "--limit", "12"], {}).apply, true);
  assert.equal(parseOfferSyncArgs(["--full"], {}).limit, 100_000);
  assert.equal(parseOfferSyncArgs(["--full"], {}).full, true);
  assert.equal(parseOfferSyncArgs(["--full"], { CATALOG_OFFER_SYNC_LIMIT: "7" }).limit, 100_000);
  assert.throws(() => parseOfferSyncArgs(["--concurrency", "9"], {}), /between 1 and 8/);
  assert.equal(validProductId("prod_01ABC"), true);
  assert.equal(validProductId("../products"), false);
});

test("worker statically preserves last-known-good offers on failed or empty reads", async () => {
  const worker = await readFile(new URL("../scripts/sync-medusa-pharmacy-offers.mjs", import.meta.url), "utf8");
  const readThroughCache = await readFile(new URL("../src/lib/catalog-db.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../db/migrations/006_catalog_offer_sync_state.sql", import.meta.url), "utf8");
  assert.match(worker, /pg_try_advisory_lock/);
  assert.match(worker, /greatest\([\s\S]+offer_updated_at[\s\S]+last_attempt_at/);
  assert.match(worker, /if \(result\.normalized\.status !== "valid"\)[\s\S]+recordNonSuccess/);
  assert.match(worker, /await client\.query\("BEGIN"\)[\s\S]+DELETE FROM catalog_pharmacy_offers[\s\S]+COMMIT/);
  assert.match(worker, /if \(options\.full\) process\.exitCode = 75/);
  assert.match(worker, /scope: options\.full \? "full" : "incremental"/);
  assert.match(worker, /FOR NO KEY UPDATE/);
  assert.match(worker, /offer_sync_db_transaction_retry/);
  assert.match(worker, /FROM incoming\s+ORDER BY id\s+ON CONFLICT/);
  assert.match(readThroughCache, /RETRYABLE_PHARMACY_WRITE_CODES = new Set\(\["40P01", "40001"\]\)/);
  assert.match(readThroughCache, /FOR NO KEY UPDATE/);
  assert.match(readThroughCache, /FROM incoming\s+ORDER BY id\s+ON CONFLICT/);
  assert.ok(
    readThroughCache.indexOf("INSERT INTO catalog_pharmacies")
      < readThroughCache.indexOf("UPDATE catalog_pharmacy_offers"),
    "all offer writers must lock pharmacies before product offers",
  );
  assert.match(migration, /catalog_offer_sync_state/);
});

test("one-time offer backfill has no runtime deadline and retries lock contention", async () => {
  const unit = await readFile(new URL("../deploy/systemd/inkar-shop-offer-backfill.service", import.meta.url), "utf8");
  const coverage = await readFile(new URL("../deploy/sql/check-offer-backfill-coverage.sql", import.meta.url), "utf8");
  assert.match(unit, /^ExecStart=.*sync-medusa-pharmacy-offers\.mjs --apply --full/m);
  assert.match(unit, /^TimeoutStartSec=infinity$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^StartLimitIntervalSec=0$/m);
  assert.doesNotMatch(unit, /^\[Install\]$/m);
  assert.match(coverage, /never_attempted/);
  assert.match(coverage, /attempted_pct/);
  assert.match(coverage, /successful_at_least_once/);
});
