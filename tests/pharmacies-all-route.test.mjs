import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/pharmacies/route.ts";

const pharmacy = (overrides = {}) => ({ id: "sloc_ALMATY", name: "Аптека №1", city: "Алматы", address: "Абая 1", latitude: 43.25, longitude: 76.9, ...overrides });
function configure(t, overrides = {}) {
  const settings = { MEDUSA_ENABLED: "true", MEDUSA_URL: "https://medusa.example.test", MEDUSA_PUBLISHABLE_KEY: "test-publishable-only", ...overrides };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
test("all-city pharmacy directory uses real Medusa IDs, preserves coordinates and exposes no private fields", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "medusa.example.test");
    assert.equal(parsed.pathname, "/store/pharmacies");
    assert.deepEqual([...parsed.searchParams], [["limit", "2000"]]);
    assert.equal(options.headers["x-publishable-api-key"], "test-publishable-only");
    return Response.json({ pharmacies: [pharmacy({ private_token: "secret" }), pharmacy({ id: "sloc_ASTANA", city: "Астана", latitude: 51.1, longitude: 71.4 })] });
  });
  const response = await GET(new Request("https://shop.test/api/pharmacies?scope=all"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.source, "medusa");
  assert.equal(payload.degraded, false);
  assert.deepEqual(payload.pharmacies.map((row) => row.sourceCode), ["sloc_ALMATY", "sloc_ASTANA"]);
  assert.equal(payload.pharmacies[0].lat, 43.25);
  assert.ok(!JSON.stringify(payload).includes("secret"));
});
test("city directory filters exact human city names and never manufactures coordinates", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ pharmacies: [pharmacy({ latitude: null, longitude: null }), pharmacy({ id: "sloc_ASTANA", city: "Астана" })] }));
  const response = await GET(new Request("https://shop.test/api/pharmacies"));
  const payload = await response.json();
  assert.equal(payload.city, "Алматы");
  assert.equal(payload.pharmacies.length, 1);
  assert.equal(payload.pharmacies[0].lat, undefined);
  assert.equal(payload.pharmacies[0].lon, undefined);
});
for (const [name, payload, status] of [
  ["outage", { error: "upstream" }, 503],
  ["invalid payload", { result: [] }, 200],
  ["incomplete directory", { pharmacies: [pharmacy()], count: 10 }, 200],
]) {
  test(`Medusa ${name} fails closed without static or Daribar fallback`, async (t) => {
    configure(t);
    t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
    const response = await GET(new Request("https://shop.test/api/pharmacies?scope=all"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "pharmacies_unavailable", pharmacies: [], source: "medusa", degraded: true });
  });
}
test("confirmed empty Medusa directory is distinct from outage", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ pharmacies: [], count: 0 }));
  const response = await GET(new Request("https://shop.test/api/pharmacies?scope=all"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pharmacies: [], source: "medusa", degraded: false });
});
test("disabled Medusa and invalid cities make no upstream requests", async (t) => {
  configure(t, { MEDUSA_ENABLED: "false" });
  const mocked = t.mock.method(globalThis, "fetch", async () => { throw new Error("must_not_call"); });
  assert.equal((await GET(new Request("https://shop.test/api/pharmacies?scope=all"))).status, 503);
  assert.equal((await GET(new Request("https://shop.test/api/pharmacies?city=%3Cscript%3E"))).status, 400);
  assert.equal(mocked.mock.callCount(), 0);
});
