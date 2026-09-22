import assert from "node:assert/strict";
import test from "node:test";

import {
  createDemoSession,
  createDemoSessionForInstallId,
  customerAuthMode,
  demoIdentity,
  isSyntheticCustomerEmail,
  isValidDemoInstallId,
  matchesDemoCustomer,
  readDemoSession,
} from "./customerAuthMode.ts";

const SECRET = "test-only-secret-that-is-long-enough";

test("customer auth is always production SMS even with a stale demo env", () => {
  const previous = process.env.CUSTOMER_AUTH_MODE;
  try {
    delete process.env.CUSTOMER_AUTH_MODE;
    assert.equal(customerAuthMode(), "sms");
    process.env.CUSTOMER_AUTH_MODE = " demo ";
    assert.equal(customerAuthMode(), "sms");
    process.env.CUSTOMER_AUTH_MODE = "anything-else";
    assert.equal(customerAuthMode(), "sms");
  } finally {
    if (previous == null) delete process.env.CUSTOMER_AUTH_MODE;
    else process.env.CUSTOMER_AUTH_MODE = previous;
  }
});

test("demo session is signed and tampering is rejected", () => {
  const session = createDemoSession(SECRET);
  const sessionId = readDemoSession(session, SECRET);

  assert.match(sessionId ?? "", /^[0-9a-f-]{36}$/i);
  const replacement = session.endsWith("x") ? "y" : "x";
  assert.equal(readDemoSession(`${session.slice(0, -1)}${replacement}`, SECRET), null);
  assert.equal(readDemoSession(session, `${SECRET}-wrong`), null);
  assert.equal(readDemoSession("not-a-session", SECRET), null);
  assert.throws(
    () => createDemoSession("please-change-to-a-long-random-string"),
    /not securely configured/,
  );
  assert.throws(() => createDemoSession("short"), /not securely configured/);
});

test("native install id produces a stable, isolated signed demo session", () => {
  const installId = "3f1e88b0-7e89-4db8-b8fa-2600d8bf88ac";
  const repeat = createDemoSessionForInstallId(installId, SECRET);
  assert.equal(createDemoSessionForInstallId(installId, SECRET), repeat);
  assert.notEqual(
    createDemoSessionForInstallId("10502f2f-32ac-47e2-897b-fe21e58a72c1", SECRET),
    repeat,
  );
  assert.ok(readDemoSession(repeat, SECRET));
  assert.equal(isValidDemoInstallId(installId), true);
  assert.equal(isValidDemoInstallId("77001234567"), false);
  assert.equal(isValidDemoInstallId("person@example.kz"), false);
  assert.equal(isValidDemoInstallId("contains spaces and pii"), false);
});

test("each demo browser receives stable isolated Medusa credentials", () => {
  const firstSession = readDemoSession(createDemoSession(SECRET), SECRET);
  const secondSession = readDemoSession(createDemoSession(SECRET), SECRET);
  assert.ok(firstSession);
  assert.ok(secondSession);

  const first = demoIdentity(firstSession, SECRET);
  const firstAgain = demoIdentity(firstSession, SECRET);
  const second = demoIdentity(secondSession, SECRET);

  assert.deepEqual(firstAgain, first);
  assert.notEqual(second.email, first.email);
  assert.notEqual(second.password, first.password);
  assert.notEqual(second.phone, first.phone);
  assert.match(first.email, /^demo-[0-9a-f]{24}@demo\.darihana\.kz$/);
  assert.match(first.phone, /^7\d{10}$/);
});

test("synthetic customer email addresses are not exposed to the UI", () => {
  assert.equal(isSyntheticCustomerEmail("77001234567@phone.darihana.kz"), true);
  assert.equal(isSyntheticCustomerEmail("demo-abcd@demo.darihana.kz"), true);
  assert.equal(isSyntheticCustomerEmail("buyer@example.kz"), false);
  assert.equal(isSyntheticCustomerEmail(null), false);
});

test("demo checkout requires a matching signed session, not metadata alone", () => {
  const signedSession = createDemoSession(SECRET);
  const sessionId = readDemoSession(signedSession, SECRET);
  assert.ok(sessionId);
  const identity = demoIdentity(sessionId, SECRET);
  const customer = {
    email: identity.email,
    metadata: { demo_customer: true, demo_session_hash: identity.sessionHash },
  };

  assert.equal(matchesDemoCustomer(customer, signedSession, SECRET), true);
  assert.equal(matchesDemoCustomer(customer, createDemoSession(SECRET), SECRET), false);
  assert.equal(matchesDemoCustomer(customer, `${signedSession}tampered`, SECRET), false);
  assert.equal(matchesDemoCustomer({ ...customer, metadata: { demo_customer: true } }, signedSession, SECRET), false);
});
