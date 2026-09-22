import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { normalizeOtpPhone } from "../src/lib/otpContract.ts";
import { formatPhone } from "../src/lib/phone.ts";

const source = ts.transpileModule(readFileSync("src/lib/auth/AuthContext.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  const slots = [];
  const effects = [];
  const calls = [];
  let cursor = 0;
  let mounted = false;
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useEffect: (effect) => { if (!mounted) effects.push(effect); },
  };
  const requestAuthJson = (url, init = {}) => new Promise((resolve, reject) => {
    calls.push({ url, init, resolve: (payload, status = 200) => resolve({ response: { ok: status < 400, status }, payload }), reject });
  });
  const context = vm.createContext({
    exports: {}, AbortController,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => new Promise(() => {}), // unrelated address read is not resolved in these tests
    require: (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "@/lib/auth/clientRequest") return { requestAuthJson };
      if (name === "@/lib/otpContract") return { normalizeOtpPhone };
      if (name === "@/lib/phone") return { formatPhone };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(source, context);
  const render = () => {
    cursor = 0;
    return context.exports.AuthProvider({ children: null }).props.value;
  };
  render();
  mounted = true;
  const cleanups = effects.map((effect) => effect());
  return { render, calls, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const profile = { phone: "77064433452", name: "Айдана" };

test("a late anonymous startup response cannot erase a completed OTP login", async () => {
  const h = harness();
  try {
    const login = h.render().continueWithPhone("7064433452", "1234");
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].init.signal.aborted, true);
    h.calls[1].resolve({ user: profile, profileComplete: true });
    assert.equal((await login).error, null);
    h.calls[0].resolve({ user: null });
    await tick();
    assert.equal(h.render().user.name, profile.name);
    assert.equal(h.render().authMode, "sms");
  } finally { h.cleanup(); }
});

test("logout while startup loads settles auth mode and aborts old cookie refresh", async () => {
  const h = harness();
  try {
    h.render().logout();
    assert.equal(h.render().authMode, "sms");
    assert.equal(h.calls[0].init.signal.aborted, true);
    h.calls[0].resolve({ user: profile, profileComplete: true });
    await tick();
    assert.equal(h.render().user, null);
    h.calls[1].resolve({ ok: true });
    await tick();
    assert.equal(h.render().authMode, "sms");
  } finally { h.cleanup(); }
});

test("new OTP verification waits for logout response before creating a new cookie", async () => {
  const h = harness();
  try {
    h.render().logout();
    const login = h.render().continueWithPhone("+7 (706) 443-34-52", "1234");
    await tick();
    assert.equal(h.calls.length, 2, "OTP must not be consumed before logout settles");
    h.calls[1].resolve({ ok: true });
    await tick();
    assert.equal(h.calls.length, 3);
    assert.equal(JSON.parse(h.calls[2].init.body).action, "continue");
    h.calls[2].resolve({ user: profile, profileComplete: true });
    assert.equal((await login).error, null);
    assert.equal(h.render().user.name, profile.name);
  } finally { h.cleanup(); }
});

test("failed pending logout prevents racing a new verification and consuming its code", async () => {
  const h = harness();
  try {
    h.render().logout();
    const login = h.render().continueWithPhone("77064433452", "1234");
    h.calls[1].reject(new Error("timeout"));
    assert.equal((await login).error, "auth_unavailable");
    assert.equal(h.calls.length, 2);
    assert.equal(h.render().user, null);
  } finally { h.cleanup(); }
});

test("cancelled OTP response never authenticates a newly opened dialog", async () => {
  const h = harness();
  try {
    const controller = new AbortController();
    const login = h.render().continueWithPhone("77064433452", "1234", { signal: controller.signal });
    controller.abort();
    h.calls[1].resolve({ user: profile, profileComplete: true });
    assert.equal((await login).error, "network_failed");
    assert.equal(h.render().user, null);
  } finally { h.cleanup(); }
});
