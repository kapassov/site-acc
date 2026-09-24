import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadNearestPickup, nearestPickupFromPayload, PickupLookupFailure, pickupDistanceLabel } from "../src/lib/checkout/nearest-pickup.ts";

const location = { lat: 51.16, lon: 71.47 };
const astana = { sourceCode: "sloc_ast02", city: "Астана", address: "Кабанбай батыра, 2", hours: "09:00–21:00", lat: 51.1601, lon: 71.4701, total: 1234 };
const almaty = { sourceCode: "sloc_alm01", city: "Алматы", address: "Абая, 1", hours: "09:00–21:00", lat: 43.25, lon: 76.9, total: 1234 };
const directory = (pharmacies = [almaty, astana]) => ({ pharmacies, source: "daribar_v3", degraded: false });
const medusaDirectory = (pharmacies = [almaty, astana]) => ({ pharmacies, source: "medusa", degraded: false });

test("nearest pickup can change city and retains the exact local location identity", () => {
  const otherAstana = { ...astana, sourceCode: "sloc_ast03", lat: 51.3 };
  const result = nearestPickupFromPayload(directory([almaty, otherAstana, astana]), location);
  assert.equal(result.pharmacy, astana);
  assert.equal(result.pharmacy.sourceCode, "sloc_ast02");
  assert.equal(result.city, "Астана");
  assert.deepEqual(result.points, [otherAstana, astana]);
  assert.ok(result.distanceKm > 0 && result.distanceKm < 0.02);
});

test("nearest city list handles harmless case and space differences without losing selection", () => {
  const sameCity = { ...astana, city: " астана ", sourceCode: "sloc_ast03", lat: 51.3 };
  const result = nearestPickupFromPayload(directory([almaty, sameCity, astana]), location);
  assert.equal(result.city, "Астана");
  assert.deepEqual(result.points, [sameCity, astana]);
});

for (const payload of [null, [], {}, { pharmacies: [] }, { ...directory(), source: "static" }, { ...directory(), degraded: true }, { ...directory(), degraded: undefined }, { ...directory(), pharmacies: {} }]) {
  test(`nearest pickup rejects unconfirmed directories: ${JSON.stringify(payload)}`, () => {
    assert.throws(() => nearestPickupFromPayload(payload, location), PickupLookupFailure);
  });
}

test("cart-aware nearest selection rejects the old Medusa directory and unquoted pharmacies", () => {
  assert.throws(() => nearestPickupFromPayload(medusaDirectory(), location), PickupLookupFailure);
  assert.throws(() => nearestPickupFromPayload(directory([{ ...astana, total: 0 }, { ...almaty, total: NaN }]), location), PickupLookupFailure);
  assert.throws(() => nearestPickupFromPayload(directory([{ ...astana, sourceCode: "ast-02" }]), location), PickupLookupFailure);
});

test("nearest pickup never chooses an entry without a real source code or usable coordinates", () => {
  const malformed = [
    null, {},
    { ...astana, sourceCode: undefined },
    { ...astana, sourceCode: "<script>" },
    { ...astana, address: " " },
    { ...astana, city: " " },
    { ...astana, hours: null },
    { ...astana, lat: null },
    { ...astana, lat: "51.16" },
    { ...astana, lon: Infinity },
    { ...astana, lat: 91 },
    { ...astana, lon: -181 },
    { ...astana, lat: 0, lon: 0 },
  ];
  const result = nearestPickupFromPayload(directory([...malformed, almaty]), location);
  assert.equal(result.pharmacy, almaty);
  assert.deepEqual(result.points, [almaty]);
});

test("no usable pharmacies and invalid device coordinates do not fabricate a selection", () => {
  assert.throws(() => nearestPickupFromPayload(directory([]), location), /Не нашли аптеки/);
  assert.throws(() => nearestPickupFromPayload(directory(), { lat: NaN, lon: 71.47 }), PickupLookupFailure);
});

test("lookup loads only the public all-city directory, never sending device coordinates", async () => {
  let calls = 0;
  const result = await loadNearestPickup(location, new AbortController().signal, async (url, init) => {
    calls += 1;
    assert.equal(url, "/api/pharmacies?scope=all");
    assert.deepEqual(Object.keys(init), ["signal"]);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(medusaDirectory());
  });
  assert.equal(calls, 1);
  assert.equal(result.pharmacy.sourceCode, "sloc_ast02");
});

test("cart-aware lookup requests only locations that can fulfil the complete cart", async () => {
  const items = [{ productId: "prod_A1", variantId: "variant_A1", quantity: 2 }];
  const result = await loadNearestPickup(location, new AbortController().signal, async (url, init) => {
    assert.equal(url, "/api/checkout/pickup-options");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { items, city: "Астана" });
    assert.doesNotMatch(init.body, /51\.16|71\.47|lat|lon/);
    return Response.json(directory());
  }, items);
  assert.equal(result.pharmacy.sourceCode, "sloc_ast02");
});

test("coordinate-free eligible pharmacies produce a distinct actionable failure", () => {
  const point = { sourceCode: "sloc_A1", city: "Алматы", address: "Абая, 1", hours: "09:00–21:00", total: 1234 };
  assert.throws(() => nearestPickupFromPayload(directory([point]), location), (error) => {
    assert.ok(error instanceof PickupLookupFailure);
    assert.equal(error.code, "coordinates_unavailable");
    return true;
  });
});

test("lookup fails clearly on unavailable API and does not retry with a static directory", async () => {
  let calls = 0;
  await assert.rejects(loadNearestPickup(location, new AbortController().signal, async () => {
    calls += 1;
    return Response.json({ error: "unavailable" }, { status: 503 });
  }), /актуальный список аптек/);
  assert.equal(calls, 1);
});

test("lookup handles invalid JSON and network errors without exposing technical details", async () => {
  for (const request of [async () => new Response("not-json"), async () => { throw new Error("internal-service-error"); }]) {
    await assert.rejects(loadNearestPickup(location, new AbortController().signal, request), (error) => {
      assert.ok(error instanceof PickupLookupFailure);
      assert.doesNotMatch(error.message, /internal-service-error|SyntaxError/);
      return true;
    });
  }
});

test("lookup aborted before the click flow completes never starts a network request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(loadNearestPickup(location, controller.signal, async () => { calls += 1; }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("manual choice or city change aborts the in-flight directory lookup", async () => {
  const controller = new AbortController();
  let networkSignal;
  const request = loadNearestPickup(location, controller.signal, async (_, { signal }) => {
    networkSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(networkSignal.aborted, true);
});

test("a directory response arriving after cancellation cannot select a pharmacy", async () => {
  const controller = new AbortController();
  let resolveResponse;
  const pending = loadNearestPickup(location, controller.signal, () => new Promise((resolve) => { resolveResponse = resolve; }));
  controller.abort();
  resolveResponse(Response.json(directory()));
  await assert.rejects(pending, { name: "AbortError" });
});

test("a hung pharmacy request times out and releases its network connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let networkSignal;
  const pending = loadNearestPickup(location, new AbortController().signal, async (_, { signal }) => {
    networkSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  t.mock.timers.tick(12_000);
  await assert.rejects(pending, /не успели загрузиться/);
  assert.equal(networkSignal.aborted, true);
});

test("distance copy uses metres nearby and readable kilometres farther away", () => {
  assert.equal(pickupDistanceLabel(0), "10 м");
  assert.equal(pickupDistanceLabel(0.235), "240 м");
  assert.equal(pickupDistanceLabel(1.25), "1,3 км");
  assert.equal(pickupDistanceLabel(150.25), "150 км");
});

test("checkout requests location only on pickup button click and cancels manual overrides", async () => {
  const page = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(page, /delivery === "pickup" \? \([\s\S]*onClick=\{chooseNearestPickup\}/);
  assert.match(page, /copy\.nearest\.choose/);
  assert.match(page, /type="button"\s+onClick=\{chooseNearestPickup\}/);
  assert.match(page, /aria-busy=\{locatingPharmacy\}/);
  assert.match(page, /onClick=\{\(\) => \{ cancelNearestPickup\(\); setMapOpen\(true\); \}\}/);
  assert.match(page, /onPick=\{\(point\) => \{ cancelNearestPickup\(\); setPharmacy\(point\)/);
  assert.match(page, /if \(submitting \|\| locatingPharmacy \|\| nearestRequest.current\) return/);
  assert.equal((page.match(/disabled=\{checkoutBlocked \|\| submitting \|\| quoteLoading \|\| locatingPharmacy\}/g) || []).length, 2);
});

test("nearest choice atomically updates city, source identity and invalidates the previous quote", async () => {
  const page = await readFile(new URL("../src/app/checkout/page.tsx", import.meta.url), "utf8");
  const handler = page.slice(page.indexOf("const chooseNearestPickup"), page.indexOf("const submit ="));
  assert.match(handler, /pharmacyListRequest.current\?\.abort\(\)/);
  assert.match(handler, /setLivePharmacies\(\{ key: nearestKey, city: nearest.city, points: eligiblePoints \}\)/);
  assert.match(handler, /setCity\(nearest.city\)/);
  assert.match(handler, /setPharmacy\(nearest.pharmacy\)/);
  assert.match(handler, /setQuote\(null\)/);
  assert.match(handler, /setQuoteRefresh\(/);
  assert.doesNotMatch(handler, /localStorage|sessionStorage|trackEvent|sendBeacon/);
  assert.match(page, /point.sourceCode === pharmacy.sourceCode/);
  assert.match(handler, /const nearest = await loadNearestPickup\(location, controller.signal, fetch, pickupItems\);\s+if \(controller.signal.aborted \|\| nearestRequest.current !== controller\) return/);
});

test("closing the pharmacy map cannot submit the enclosing checkout form", async () => {
  const map = await readFile(new URL("../src/components/checkout/PharmacyMapPicker.tsx", import.meta.url), "utf8");
  assert.match(map, /button type="button" onClick=\{onClose\} aria-label=\{copy\.close\}/);
});
