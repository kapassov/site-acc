import assert from "node:assert/strict";
import test from "node:test";

import { getDaribarPharmacies, mapDaribarPharmacies } from "../src/lib/daribar/pharmacies.ts";

const validSource = (overrides = {}) => ({
  active: true,
  network_code: "inkar",
  pharmacy_code: "alm-01",
  name: "Аптека №1",
  city: "Алматы",
  opening_hours: "08:00–22:00",
  location: { address: "Абая 1", lat: 43.25, lon: 76.9 },
  ...overrides,
});

const directorySource = (overrides = {}) => ({
  code: "alm-01", network_code: "inkar", city: "Алматы", active: true, disabled: false, ...overrides,
});
const cityName = (index) => `Город ${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));
let contextSequence = 0;

function configureDaribar(t, overrides = {}) {
  const settings = {
    DARIBAR_API_URL: "https://backoffice.daribar.com",
    DARIBAR_SERVICE_TOKEN: `test-pharmacy-token-${++contextSequence}`,
    DARIBAR_NETWORK_CODE: "inkar",
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return settings;
}

test("Daribar pharmacy mapper keeps only active pharmacies from the configured network", () => {
  const pharmacies = mapDaribarPharmacies({
    sources: [
      {
        active: true,
        network_code: "inkar",
        pharmacy_code: "alm-01",
        name: " Аптека\u0000 №1 ",
        city: "Алматы",
        opening_hours: "08:00–22:00",
        location: { address: "Абая 1", lat: 43.25, lon: 76.9 },
      },
      {
        active: false,
        network_code: "inkar",
        pharmacy_code: "alm-02",
        city: "Алматы",
        location: { address: "Абая 2", lat: 43.25, lon: 76.9 },
      },
      {
        active: true,
        network_code: "other",
        pharmacy_code: "alm-03",
        city: "Алматы",
        location: { address: "Абая 3", lat: 43.25, lon: 76.9 },
      },
      {
        active: true,
        network_code: "inkar",
        pharmacy_code: "alm-04",
        city: "Алматы",
        location: { address: "Абая 4", lat: 143.25, lon: 76.9 },
      },
    ],
  }, "INKAR", "Алматы");

  assert.deepEqual(pharmacies, [{
    sourceCode: "alm-01",
    name: "Аптека №1",
    address: "Абая 1",
    city: "Алматы",
    lat: 43.25,
    lon: 76.9,
    hours: "08:00–22:00",
  }]);
});

test("Daribar pharmacy mapper rejects duplicate codes and mismatched cities", () => {
  const entry = {
    active: true,
    network_code: "inkar",
    pharmacy_code: "ast-01",
    name: "Аптека",
    city: "Астана",
    location: { address: "Кабанбай 1", lat: 51.1, lon: 71.4 },
  };
  assert.deepEqual(mapDaribarPharmacies({ data: { sources: [entry, entry] } }, "inkar", "Алматы"), []);
  assert.equal(mapDaribarPharmacies({ data: { sources: [entry, entry] } }, "inkar", "Астана").length, 1);
});

test("Daribar pharmacy coordinates reject missing, coerced-empty and out-of-range values", () => {
  for (const invalid of [null, undefined, "", " ", false, true, [], {}, NaN, Infinity, -Infinity]) {
    for (const axis of ["lat", "lon"]) {
      const source = validSource();
      source.location[axis] = invalid;
      assert.deepEqual(mapDaribarPharmacies({ sources: [source] }, "inkar", "Алматы"), []);
    }
  }
  for (const [lat, lon] of [[90.1, 76.9], [-90.1, 76.9], [43.25, 180.1], [43.25, -180.1], [0, 0], ["0", "0"]]) {
    const source = validSource({ location: { address: "Абая 1", lat, lon } });
    assert.deepEqual(mapDaribarPharmacies({ sources: [source] }, "inkar", "Алматы"), []);
  }
});

test("Daribar pharmacy coordinates accept real decimal strings and preserve exact upstream code", () => {
  const source = validSource({
    pharmacy_code: "daribar:alm-01",
    emdel_pharmacy_code: "other-partner-code",
    location: { address: "Абая 1", lat: " 43.25 ", lon: "76.9" },
  });
  const [pharmacy] = mapDaribarPharmacies({ sources: [source] }, "inkar");
  assert.equal(pharmacy.sourceCode, "daribar:alm-01");
  assert.equal(pharmacy.lat, 43.25);
  assert.equal(pharmacy.lon, 76.9);
});

test("Daribar all-city mapping requires a real city instead of guessing one", () => {
  const withoutCity = validSource({ city: " " });
  const otherCity = validSource({ pharmacy_code: "ast-01", city: "Астана" });
  const payload = { sources: [withoutCity, otherCity, validSource()] };
  const pharmacies = mapDaribarPharmacies(payload, "inkar");
  assert.deepEqual(pharmacies.map((pharmacy) => pharmacy.city), ["Астана", "Алматы"]);
  // Existing city-filtered consumers may still fill an omitted city from the request.
  assert.equal(mapDaribarPharmacies({ sources: [withoutCity] }, "inkar", "Алматы")[0].city, "Алматы");
});

test("nearest-pickup mapping requires confirmed activity while city lookup remains compatible", () => {
  for (const active of [undefined, null, "true", "false", 0, 1]) {
    const payload = { sources: [validSource({ active })] };
    assert.deepEqual(mapDaribarPharmacies(payload, "inkar", "", { onlyConfirmedActive: true }), []);
  }
  const unknownActivity = { sources: [validSource({ active: undefined })] };
  assert.equal(mapDaribarPharmacies(unknownActivity, "inkar", "Алматы").length, 1);
  const knownActivity = { sources: [validSource(), validSource({ pharmacy_code: "inactive", active: false })] };
  assert.equal(mapDaribarPharmacies(knownActivity, "inkar", "", { onlyConfirmedActive: true }).length, 1);
});

test("Daribar pharmacy mapping never broadens to all networks when configuration is empty", () => {
  assert.deepEqual(mapDaribarPharmacies({ sources: [validSource()] }, " "), []);
});

test("Daribar all-city fetch discovers cities and confirms identity and activity against both APIs", async (t) => {
  const settings = configureDaribar(t);
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, init) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.origin, "https://backoffice.daribar.com");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${settings.DARIBAR_SERVICE_TOKEN}`);
    if (requestUrl.pathname === "/api/v1/sources") {
      assert.deepEqual([...requestUrl.searchParams], [["network_code", "inkar"]]);
      return Response.json({ result: [
        directorySource(),
        directorySource({ code: "ast-01", city: "Астана" }),
        directorySource({ code: "inactive" }),
        directorySource({ code: "unknown" }),
        directorySource({ code: "disabled", disabled: true }),
        directorySource({ code: "foreign", network_code: "other-network", city: "Other" }),
      ] });
    }
    assert.equal(requestUrl.pathname, "/api/v1/emdel/pharmacies/all");
    assert.equal(requestUrl.searchParams.size, 1);
    assert.ok(["Алматы", "Астана"].includes(requestUrl.searchParams.get("city")));
    return Response.json({ sources: [
      validSource(),
      validSource({ pharmacy_code: "ast-01", city: "Астана" }),
      validSource({ pharmacy_code: "inactive", active: false }),
      validSource({ pharmacy_code: "unknown", active: undefined }),
      validSource({ pharmacy_code: "disabled" }),
      validSource({ pharmacy_code: "foreign", network_code: "other-network" }),
      validSource({ pharmacy_code: "not-in-directory" }),
    ] });
  });
  const pharmacies = await getDaribarPharmacies();
  assert.deepEqual(pharmacies.map((pharmacy) => pharmacy.sourceCode), ["alm-01", "ast-01"]);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("Daribar city fetch preserves the requested city filter and normalizes surrounding spaces", async (t) => {
  configureDaribar(t);
  t.mock.method(globalThis, "fetch", async (url) => {
    const requestUrl = new URL(String(url));
    assert.deepEqual([...requestUrl.searchParams], [["city", "Алматы"]]);
    return Response.json({ sources: [validSource({ active: undefined }), validSource({ pharmacy_code: "ast-01", city: "Астана" })] });
  });
  const pharmacies = await getDaribarPharmacies("  Алматы  ");
  assert.deepEqual(pharmacies.map((pharmacy) => pharmacy.sourceCode), ["alm-01"]);
});

test("all-city selection excludes disabled or unconfirmed directory entries even when Emdel says active", async (t) => {
  configureDaribar(t);
  const rows = [
    directorySource(),
    directorySource({ code: "disabled", disabled: true }),
    directorySource({ code: "unknown-disabled", disabled: undefined }),
    directorySource({ code: "null-disabled", disabled: null }),
    directorySource({ code: "string-disabled", disabled: "false" }),
    directorySource({ code: "inactive", active: false }),
    directorySource({ code: "unknown-active", active: undefined }),
    directorySource({ code: "string-active", active: "true" }),
  ];
  t.mock.method(globalThis, "fetch", async (url) => new URL(String(url)).pathname === "/api/v1/sources"
    ? Response.json({ result: rows })
    : Response.json({ sources: rows.map((row) => validSource({ pharmacy_code: row.code })) }));
  assert.deepEqual((await getDaribarPharmacies()).map((point) => point.sourceCode), ["alm-01"]);
});

test("all-city discovery deduplicates city names and never adds other networks", async (t) => {
  configureDaribar(t);
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/v1/sources") return Response.json({ result: [
      directorySource(), directorySource({ city: "  АЛМАТЫ  " }),
      directorySource({ code: "alm-02", city: "Алматы" }),
      directorySource({ code: "outside", network_code: "other", city: "<invalid-but-irrelevant>" }),
    ] });
    requested.push(parsed.searchParams.get("city"));
    return Response.json({ sources: [validSource(), validSource(), validSource({ pharmacy_code: "alm-02" })] });
  });
  assert.deepEqual((await getDaribarPharmacies()).map((point) => point.sourceCode), ["alm-01", "alm-02"]);
  assert.deepEqual(requested, ["Алматы"]);
});

test("all-city selection matches directory code and city, not display name or partner code", async (t) => {
  configureDaribar(t);
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/v1/sources") return Response.json({ result: [
      directorySource(), directorySource({ code: "ast-01", city: "Астана" }),
    ] });
    return Response.json({ sources: [
      validSource(),
      validSource({ pharmacy_code: "ast-01", city: "Алматы" }),
      validSource({ pharmacy_code: "other", emdel_pharmacy_code: "alm-01" }),
    ] });
  });
  assert.deepEqual((await getDaribarPharmacies()).map((point) => point.sourceCode), ["alm-01"]);
});

for (const [label, payload] of [
  ["missing result", {}], ["null result", { result: null }], ["object result", { result: {} }],
  ["null row", { result: [null] }], ["missing network", { result: [{ city: "Алматы", code: "alm-01" }] }],
  ["missing city", { result: [directorySource({ city: "" })] }],
  ["invalid city", { result: [directorySource({ city: "<script>" })] }],
  ["too long city", { result: [directorySource({ city: "А".repeat(101) })] }],
  ["invalid code", { result: [directorySource({ code: "../invalid" })] }],
  ["ambiguous city for one code", { result: [directorySource(), directorySource({ city: "Астана" })] }],
]) {
  test(`all-city lookup rejects malformed directory: ${label}`, async (t) => {
    configureDaribar(t);
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_invalid" });
    assert.equal(mock.mock.callCount(), 1);
  });
}

test("all-city lookup rejects more than 64 cities instead of silently truncating", async (t) => {
  configureDaribar(t);
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ result: Array.from({ length: 65 }, (_, index) => (
    directorySource({ code: `p${index}`, city: cityName(index) })
  )) }));
  await assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_invalid" });
  assert.equal(mock.mock.callCount(), 1);
});

test("all-city lookup rejects an oversized directory instead of truncating its rows", async (t) => {
  configureDaribar(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: Array.from({ length: 10_001 }, () => directorySource()) }));
  await assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_invalid" });
});

test("all-city city requests are limited to four and results retain deterministic city order", async (t) => {
  configureDaribar(t);
  const cities = Array.from({ length: 9 }, (_, index) => cityName(index));
  let active = 0;
  let maximum = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/v1/sources") return Response.json({ result: cities.map((city, index) => directorySource({ city, code: `p${index}` })) });
    active += 1;
    maximum = Math.max(maximum, active);
    const city = parsed.searchParams.get("city");
    await flush();
    active -= 1;
    return Response.json({ sources: [validSource({ city, pharmacy_code: `p${cities.indexOf(city)}` })] });
  });
  const points = await getDaribarPharmacies();
  assert.equal(maximum, 4);
  assert.deepEqual(points.map((point) => point.city), cities);
});

test("all-city lookup coalesces concurrent requests, caches for 90 seconds and protects cached objects", async (t) => {
  configureDaribar(t);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const mock = t.mock.method(globalThis, "fetch", async (url) => {
    await flush();
    return new URL(String(url)).pathname === "/api/v1/sources"
      ? Response.json({ result: [directorySource()] })
      : Response.json({ sources: [validSource()] });
  });
  const [first, second, third] = await Promise.all([getDaribarPharmacies(), getDaribarPharmacies(), getDaribarPharmacies()]);
  assert.equal(mock.mock.callCount(), 2);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  first[0].address = "mutated";
  second.length = 0;
  now += 89_999;
  assert.equal((await getDaribarPharmacies())[0].address, "Абая 1");
  assert.equal(mock.mock.callCount(), 2);
  now += 2;
  assert.equal((await getDaribarPharmacies()).length, 1);
  assert.equal(mock.mock.callCount(), 4);
});

test("all-city cache separates API origin, network and service-token contexts", async (t) => {
  configureDaribar(t);
  const mock = t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    const network = process.env.DARIBAR_NETWORK_CODE;
    return parsed.pathname === "/api/v1/sources"
      ? Response.json({ result: [directorySource({ network_code: network })] })
      : Response.json({ sources: [validSource({ network_code: network })] });
  });
  await getDaribarPharmacies();
  process.env.DARIBAR_SERVICE_TOKEN += "-rotated";
  await getDaribarPharmacies();
  process.env.DARIBAR_NETWORK_CODE = "other-network";
  await getDaribarPharmacies();
  process.env.DARIBAR_API_URL = "https://prod-backoffice.daribar.com";
  await getDaribarPharmacies();
  assert.equal(mock.mock.callCount(), 8);
  await getDaribarPharmacies();
  assert.equal(mock.mock.callCount(), 8);
});

test("empty all-city results are not cached and the next attempt can recover", async (t) => {
  configureDaribar(t);
  let first = true;
  const mock = t.mock.method(globalThis, "fetch", async (url) => {
    if (first) { first = false; return Response.json({ result: [] }); }
    return new URL(String(url)).pathname === "/api/v1/sources"
      ? Response.json({ result: [directorySource()] })
      : Response.json({ sources: [validSource()] });
  });
  assert.deepEqual(await getDaribarPharmacies(), []);
  assert.equal((await getDaribarPharmacies()).length, 1);
  assert.equal(mock.mock.callCount(), 3);
});

test("a failed city rejects the entire collection, stops queued cities and is not cached", async (t) => {
  configureDaribar(t);
  const cities = Array.from({ length: 8 }, (_, index) => cityName(index));
  const release = [];
  let calls = 0;
  let recover = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(String(url));
    calls += 1;
    if (parsed.pathname === "/api/v1/sources") return Response.json({ result: cities.map((city, index) => directorySource({ city, code: `p${index}` })) });
    const city = parsed.searchParams.get("city");
    if (!recover && city === cities[0]) return Response.json({ error: "city_down" }, { status: 500 });
    if (!recover) await new Promise((resolve) => release.push(resolve));
    return Response.json({ sources: [validSource({ city, pharmacy_code: `p${cities.indexOf(city)}` })] });
  });
  await assert.rejects(getDaribarPharmacies(), { code: "city_down" });
  const failedCalls = calls;
  assert.equal(failedCalls, 5);
  release.forEach((resolve) => resolve());
  await flush();
  assert.equal(calls, failedCalls);
  recover = true;
  assert.equal((await getDaribarPharmacies()).length, cities.length);
  assert.equal(calls, failedCalls + 9);
});

test("malformed city results cannot be published as an empty successful collection", async (t) => {
  configureDaribar(t);
  t.mock.method(globalThis, "fetch", async (url) => new URL(String(url)).pathname === "/api/v1/sources"
    ? Response.json({ result: [directorySource()] }) : Response.json({ result: [] }));
  await assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_invalid" });
});

test("all-city lookup does not start another HTTP call with less than the minimum timeout budget", async (t) => {
  configureDaribar(t);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const mock = t.mock.method(globalThis, "fetch", async () => {
    now += 9_501;
    return Response.json({ result: [directorySource()] });
  });
  await assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_timeout" });
  assert.equal(mock.mock.callCount(), 1);
});

test("the all-city hard deadline is ten seconds even if a transport ignores abort", async (t) => {
  configureDaribar(t);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let release;
  let signal;
  const mock = t.mock.method(globalThis, "fetch", async (_, init) => {
    signal = init.signal;
    return new Promise((resolve) => { release = resolve; });
  });
  const rejected = assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_timeout" });
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(signal.aborted, true);
  release(Response.json({ result: [directorySource()] }));
  await flush();
  assert.equal(mock.mock.callCount(), 1);
});

test("later city calls receive only the remaining total deadline", async (t) => {
  configureDaribar(t);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let citySignal;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (new URL(String(url)).pathname === "/api/v1/sources") {
      await new Promise((resolve) => setTimeout(resolve, 7_500));
      return Response.json({ result: [directorySource()] });
    }
    citySignal = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  const rejected = assert.rejects(getDaribarPharmacies(), { code: "daribar_pharmacy_directory_timeout" });
  t.mock.timers.tick(7_500);
  await flush();
  assert.ok(citySignal);
  t.mock.timers.tick(2_499);
  assert.equal(citySignal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(citySignal.aborted, true);
});
