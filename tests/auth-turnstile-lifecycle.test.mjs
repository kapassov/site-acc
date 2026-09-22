import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/auth/turnstile.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const effects = [];
  const callbacks = [];
  const removed = [];
  const api = {
    render: (_container, options) => { callbacks.push(options); return `widget-${callbacks.length}`; },
    execute() {},
    remove(id) { removed.push(id); },
  };
  const context = vm.createContext({
    exports: {},
    process: { env: { NEXT_PUBLIC_DARIBAR_TURNSTILE_SITE_KEY: "public-test-site-key" } },
    window: { turnstile: api, setTimeout, clearTimeout },
    document: {},
    require: () => ({
      useRef: (current) => ({ current }),
      useCallback: (callback) => callback,
      useEffect: (effect) => effects.push(effect),
    }),
  });
  vm.runInContext(source, context);
  const hook = context.exports.useTurnstileToken(true);
  hook.containerRef.current = { isConnected: true };
  const cleanups = effects.map((effect) => effect());
  return { hook, callbacks, removed, exports: context.exports, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test("closing the modal while Turnstile loads never renders into its stale container", async () => {
  const h = harness();
  const pending = h.hook.requestToken();
  h.cleanup();
  await assert.rejects(pending, /turnstile_unavailable/);
  assert.equal(h.callbacks.length, 0);
});

test("a detached Turnstile container is rejected before rendering", async () => {
  const h = harness();
  h.hook.containerRef.current.isConnected = false;
  try {
    await assert.rejects(h.hook.requestToken(), /turnstile_unavailable/);
    assert.equal(h.callbacks.length, 0);
  } finally { h.cleanup(); }
});

test("late callbacks from the previous SMS challenge cannot resolve or fail a resend", async () => {
  const h = harness();
  try {
    const first = h.hook.requestToken();
    await Promise.resolve();
    h.callbacks[0].callback("first-token");
    assert.equal(await first, "first-token");
    const second = h.hook.requestToken();
    await Promise.resolve();
    assert.equal(h.callbacks.length, 2);
    assert.deepEqual(h.removed, ["widget-1"]);
    h.callbacks[0]["error-callback"]("stale-error");
    h.callbacks[0]["expired-callback"]();
    h.callbacks[0].callback("stale-token");
    h.callbacks[1].callback("fresh-token");
    assert.equal(await second, "fresh-token");
  } finally { h.cleanup(); }
});

test("current provider failure rejects with a safe classified error", async () => {
  const h = harness();
  try {
    const pending = h.hook.requestToken();
    await Promise.resolve();
    h.callbacks[0]["error-callback"]("provider-error-do-not-expose");
    await assert.rejects(pending, /turnstile_unavailable/);
  } finally { h.cleanup(); }
});

test("closing removes the current widget and settles its pending promise", async () => {
  const h = harness();
  const pending = h.hook.requestToken();
  await Promise.resolve();
  h.cleanup();
  await assert.rejects(pending, /turnstile_unavailable/);
  assert.deepEqual(h.removed, ["widget-1"]);
});

test("known provider errors retain safe diagnostic codes and precise UI categories", () => {
  const h = harness();
  try {
    for (const [code, messageKey] of [
      ["110200", "auth.securityDomain"],
      ["110100", "auth.securityConfiguration"],
      ["110110", "auth.securityConfiguration"],
      ["400020", "auth.securityConfiguration"],
      ["400070", "auth.securityConfiguration"],
      ["110600", "auth.securityTimeout"],
      ["110620", "auth.securityTimeout"],
      ["200500", "auth.securityLoadFailed"],
    ]) {
      const error = h.exports.turnstileProviderError(code);
      assert.equal(error.messageKey, messageKey);
      assert.equal(error.providerCode, code);
    }
    const unknown = h.exports.turnstileProviderError("private-key-or-token-must-not-be-echoed");
    assert.equal(unknown.messageKey, "auth.securityUnavailable");
    assert.equal(unknown.providerCode, undefined);
    assert.doesNotMatch(JSON.stringify(unknown), /private-key-or-token/);
  } finally { h.cleanup(); }
});
