import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkoutAttemptDecision,
  checkoutAttemptStorageMode,
} from "../src/lib/checkout-attempts-model.ts";
import { browserUuidV4 } from "../src/lib/client-uuid.ts";

const ROUTE = new URL("../src/app/api/checkout/route.ts", import.meta.url);
const STORE = new URL("../src/lib/checkout-attempts.ts", import.meta.url);
const MIGRATION = new URL("../db/migrations/013_checkout_attempts.sql", import.meta.url);

test("Medusa checkout reserves a durable attempt before the idempotent order POST", async () => {
  const route = await readFile(ROUTE, "utf8");
  const begin = route.indexOf("await beginCheckoutAttempt");
  const boundary = route.indexOf("await markCheckoutProviderStarted");
  const order = route.indexOf('await medusaCommerce<{ order: StandardNOrder }>');

  assert.ok(begin >= 0 && boundary > begin && order > boundary);
  assert.match(route, /profile = await getDaribarUser\(access\)/);
  assert.match(route, /daribarCustomerActorKey\(profile\.phone, secret\)/);
  assert.match(route, /attempt\.outcome === "replay" \|\| attempt\.outcome === "uncertain"/);
  assert.match(route, /attempt\.outcome === "pending"/);
  assert.match(route, /idempotencyKey: durableAttemptId/);
  assert.match(route, /await completeCheckoutAttempt\(durableAttemptId/);
  assert.match(route, /await releaseCheckoutAttempt\(durableAttemptId\)/);
});

test("checkout attempt schema prevents two active attempts for one actor and cart", async () => {
  const migration = await readFile(MIGRATION, "utf8");
  const store = await readFile(STORE, "utf8");

  assert.match(migration, /id\s+uuid PRIMARY KEY/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*\(actor_key, idempotency_key\)/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*\(actor_key, cart_instance_key\)/);
  assert.match(migration, /state IN \('pending', 'uncertain', 'replay'\)/);
  assert.doesNotMatch(store, /DELETE FROM checkout_attempts\s+WHERE[^;]*retain_until/);
  assert.doesNotMatch(store, /row\.state === "replay" && dateValue\(row\.retain_until\)/);
  assert.match(store, /ON CONFLICT DO NOTHING/);
  assert.match(store, /provider_started_at/);
  assert.doesNotMatch(migration, /phone|address|email/i);
  assert.match(store, /readCheckoutAttemptByKeyForActor/);
  assert.match(store, /WHERE idempotency_key = \$1 AND actor_key = \$2/);
});

test("Medusa order identity and recipient phone come only from the verified SMS profile", async () => {
  const route = await readFile(ROUTE, "utf8");

  assert.match(route, /phone: profile\.phone/);
  assert.match(route, /customerId = daribarCustomerIdFromActorKey\(actorKey\)/);
  assert.match(route, /error: "cart_instance_required"/);
  assert.doesNotMatch(route, /legacy:\$\{cartHash\}/);
  assert.match(route, /customer: \{ externalId: actorKey, phone: profile\.phone/);
  assert.doesNotMatch(route, /phone: body\.phone/);
});

test("uncertain attempts fail closed when durable finalization is unavailable", async () => {
  const route = await readFile(ROUTE, "utf8");

  assert.match(route, /state: "uncertain"/);
  assert.match(route, /completeCheckoutAttempt\(durableAttemptId, \{ state: "uncertain"/);
  assert.match(route, /return respond\(payload, 502\)/);
  assert.match(route, /"order_status_uncertain"/);
});

test("attempt state machine rejects request mutation and never resumes a provider-started lease", () => {
  const identity = {
    idempotencyKey: "checkout:key:one",
    actorKey: "a".repeat(64),
    cartInstanceKey: "b".repeat(64),
    cartHash: "c".repeat(64),
    requestHash: "d".repeat(64),
  };
  const base = {
    ...identity,
    state: "pending",
    leaseExpiresAt: 1_000,
    providerStarted: false,
  };

  assert.equal(checkoutAttemptDecision(base, identity, 2_000), "resume");
  assert.equal(checkoutAttemptDecision({ ...base, providerStarted: true }, identity, 2_000), "mark_uncertain");
  assert.equal(checkoutAttemptDecision({ ...base, leaseExpiresAt: 3_000 }, identity, 2_000), "pending");
  assert.equal(
    checkoutAttemptDecision(base, { ...identity, requestHash: "e".repeat(64) }, 2_000),
    "conflict",
  );
});

test("production checkout attempts fail closed without PostgreSQL", () => {
  assert.equal(checkoutAttemptStorageMode("postgres://orders", undefined, "production"), "postgres");
  assert.equal(checkoutAttemptStorageMode(undefined, undefined, "test"), "file");
  assert.throws(
    () => checkoutAttemptStorageMode(undefined, undefined, "production"),
    /checkout_attempts_database_required/,
  );
});

test("cart UUID fallback works without Crypto.randomUUID", () => {
  const value = browserUuidV4({
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    },
  });
  assert.equal(value, "00000000-0000-4000-8000-000000000000");
});
