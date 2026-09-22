import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as auth from "../src/lib/daribar/auth.ts";
import { daribarJson, DaribarHttpError } from "../src/lib/daribar/client.ts";
import * as contract from "../src/lib/otpContract.ts";
import * as bodyReader from "../src/lib/httpBody.ts";
import * as phone from "../src/lib/phone.ts";

function routeFixture(path, overrides = {}) {
  const cookieWrites = [];
  const calls = [];
  const fakeTokens = { accessToken: "fake-access-token-long-enough", refreshToken: "fake-refresh-token-long-enough" };
  const modules = {
    "next/server": { NextResponse: { json(body, options) {
      const response = Response.json(body, options);
      response.cookies = { set(...args) { cookieWrites.push(args); } };
      return response;
    } } },
    "next/headers": { cookies: async () => ({ get() { return undefined; } }) },
    "@/lib/daribar/auth": {
      ...auth,
      daribarOtpEnabled: () => true,
      sendDaribarOtp: async (...args) => { calls.push(["send", ...args]); },
      verifyDaribarOtp: async (...args) => { calls.push(["verify", ...args]); return fakeTokens; },
      getDaribarUser: async () => ({ phone: "77061234567", name: "", lastName: "", addresses: [], values: {} }),
      ...overrides.auth,
    },
    "@/lib/httpBody": bodyReader,
    "@/lib/otpContract": contract,
    "@/lib/phone": phone,
    "@/lib/rateLimit": { clientIp: () => "test-client", rateLimit: () => true, ...overrides.limiter },
  };
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in modules, `Unexpected route dependency: ${name}`);
    return modules[name];
  }, loaded, loaded.exports);
  return { ...loaded.exports, calls, cookieWrites };
}

function request(body) {
  return new Request("https://shop.test/api/test", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("OTP accepts one complete destination in local, international and formatted notation", () => {
  for (const input of ["7061234567", "77061234567", "87061234567", "+7 (706) 123-45-67"]) {
    assert.equal(contract.normalizeOtpPhone(input), "77061234567");
  }
  for (const input of ["", "706123456", "770612345678", "17061234567", "phone77061234567", "+7 706123456", "+7061234567", "++77061234567", "7706+1234567", {}, 77061234567]) {
    assert.equal(contract.normalizeOtpPhone(input), "");
  }
});

test("SMS request and confirmation use the same normalization without dropping digits", async () => {
  const send = routeFixture("src/app/api/otp/send/route.ts");
  const verify = routeFixture("src/app/api/customer/route.ts");
  for (const input of ["7061234567", "77061234567", "87061234567", "+7 (706) 123-45-67"]) {
    assert.equal((await send.POST(request({ phone: input }))).status, 200);
    assert.equal((await verify.POST(request({ action: "continue", phone: input, code: "0123" }))).status, 200);
  }
  assert.ok([...send.calls, ...verify.calls].every(call => call[1] === "77061234567"));
  assert.ok(verify.calls.every(call => call[2] === "0123"));
  assert.ok(verify.cookieWrites.some(([name, , settings]) => name === "daribar_access" && settings.httpOnly));
  const invalid = await verify.POST(request({ action: "continue", phone: "770612345678", code: "0123" }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "bad_phone");
  assert.equal(verify.calls.length, 4);
});

test("wrong-length codes never call upstream verification or issue session cookies", async () => {
  const route = routeFixture("src/app/api/customer/route.ts");
  for (const code of ["123", "12345", "123456", "12a4"]) {
    const response = await route.POST(request({ action: "continue", phone: "77061234567", code }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "bad_code");
  }
  assert.deepEqual(route.calls, []);
  assert.deepEqual(route.cookieWrites, []);
});

test("upstream OTP throttle preserves status and cooldown without returning provider details", async () => {
  for (const path of ["src/app/api/otp/send/route.ts", "src/app/api/customer/route.ts"]) {
    const failure = new DaribarHttpError(429, "PRIVATE_PROVIDER_REASON", "PRIVATE_TRACE", 75);
    const route = routeFixture(path, { auth: {
      sendDaribarOtp: async () => { throw failure; },
      verifyDaribarOtp: async () => { throw failure; },
    } });
    const response = await route.POST(request({ action: "continue", phone: "77061234567", code: "1234" }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "75");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.error, "too_many_requests");
    assert.equal(payload.retryAfter, 75);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|77061234567|1234/);
    assert.deepEqual(route.cookieWrites, []);
  }
});

test("wrong codes, throttling, timeouts and unavailable provider remain distinct", () => {
  assert.equal(auth.daribarOtpFailure(new DaribarHttpError(401, "private"), "verify").error, "bad_code");
  assert.equal(auth.daribarOtpFailure(new DaribarHttpError(400, "private"), "verify").error, "bad_code");
  assert.equal(auth.daribarOtpFailure(new DaribarHttpError(429, "private"), "verify").error, "too_many_requests");
  assert.equal(auth.daribarOtpFailure(new DaribarHttpError(504, "daribar_timeout"), "send").error, "provider_timeout");
  assert.equal(auth.daribarOtpFailure(new DaribarHttpError(403, "private"), "send").error, "provider_unavailable");
});

test("new account receives a session even if its optional profile temporarily cannot load", async () => {
  const route = routeFixture("src/app/api/customer/route.ts", { auth: {
    getDaribarUser: async () => { throw new DaribarHttpError(503, "temporary"); },
  } });
  const response = await route.POST(request({ action: "continue", phone: "7061234567", code: "1234" }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.phone, "77061234567");
  assert.equal(payload.profileComplete, false);
  assert.ok(route.cookieWrites.some(([name]) => name === "daribar_access"));
  assert.doesNotMatch(JSON.stringify(payload), /fake-access|fake-refresh/);
});

test("HTML throttling responses retain HTTP status and bounded Retry-After, not their body", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>private-proxy-error</html>", {
    status: 429, headers: { "retry-after": "75" },
  }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "daribar_http_429");
    assert.equal(error.retryAfter, 75);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test("oversized Retry-After is bounded and non-JSON success is still rejected", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 429, headers: { "retry-after": "9999999" } }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => error.retryAfter === 3600);
  t.mock.method(globalThis, "fetch", async () => new Response("not-json", { status: 200 }));
  await assert.rejects(daribarJson("/api/v1/auth", { origin: "auth", auth: false }), error => error.status === 502 && error.code === "daribar_invalid_json");
});
