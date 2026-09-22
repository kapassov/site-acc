import assert from "node:assert/strict";
import test from "node:test";

import {
  findNearestPharmacy,
  GeolocationFailure,
  geolocationErrorMessage,
  requestDeviceLocation,
} from "../src/lib/checkout/pickup-geolocation.ts";

const device = { lat: 43.238, lon: 76.945 };

function controlledGeolocation() {
  const calls = [];
  const geolocation = {
    getCurrentPosition(success, error, options) {
      assert.equal(this, geolocation, "browser API must retain its native receiver");
      calls.push({ success, error, options });
    },
  };
  return { geolocation, calls };
}

function position(lat = device.lat, lon = device.lon) {
  return { coords: { latitude: lat, longitude: lon, accuracy: 5 }, timestamp: Date.now() };
}

function trackedAbortController() {
  const controller = new AbortController();
  const listeners = new Set();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, listener, options) => {
    if (type === "abort") listeners.add(listener);
    add(type, listener, options);
  };
  signal.removeEventListener = (type, listener, options) => {
    if (type === "abort") listeners.delete(listener);
    remove(type, listener, options);
  };
  return { controller, signal, listeners };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GeolocationFailure);
    assert.equal(error.name, "GeolocationFailure");
    assert.equal(error.code, code);
    assert.equal(error.message, geolocationErrorMessage(error));
    return true;
  });
}

test("nearest pharmacy is selected by distance, with sourceCode and original index preserved", () => {
  const far = { lat: 51.16, lon: 71.47, sourceCode: "ast-01" };
  const closest = { lat: 43.239, lon: 76.946, sourceCode: "alm-02" };
  const other = { lat: 43.3, lon: 76.9, sourceCode: "alm-03" };
  const result = findNearestPharmacy([far, closest, other], device);

  assert.equal(result.pharmacy, closest);
  assert.equal(result.pharmacy.sourceCode, "alm-02");
  assert.equal(result.index, 1);
  assert.ok(result.distanceKm > 0 && result.distanceKm < 0.2);
});

test("a pharmacy at the device location has exactly zero distance", () => {
  const pharmacy = { ...device, sourceCode: "same-position" };
  assert.deepEqual(findNearestPharmacy([pharmacy], device), { pharmacy, index: 0, distanceKm: 0 });
});

test("haversine returns kilometers rather than degrees", () => {
  const result = findNearestPharmacy([{ lat: 0, lon: 1 }], { lat: 0, lon: 0 });
  assert.ok(Math.abs(result.distanceKm - 111.19492664455873) < 0.000001);
});

test("antipodal positions remain finite after haversine clamping", () => {
  const result = findNearestPharmacy([{ lat: -device.lat, lon: device.lon - 180 }], device);
  assert.ok(Number.isFinite(result.distanceKm));
  assert.ok(Math.abs(result.distanceKm - 6371 * Math.PI) < 0.001);
});

test("nearest calculation crosses the antimeridian correctly", () => {
  const result = findNearestPharmacy(
    [{ lat: 10, lon: 179.9 }, { lat: 10, lon: -179.999 }],
    { lat: 10, lon: 180 },
  );
  assert.equal(result.index, 1);
  assert.ok(result.distanceKm < 0.2);
});

test("coordinate range boundaries are inclusive", () => {
  const result = findNearestPharmacy([{ lat: -90, lon: -180 }], { lat: 90, lon: 180 });
  assert.ok(Number.isFinite(result.distanceKm));
  assert.ok(Math.abs(result.distanceKm - 6371 * Math.PI) < 0.001);
});

test("identical distance ties keep the first pharmacy", () => {
  const first = { ...device, sourceCode: "first" };
  const second = { ...device, sourceCode: "second" };
  assert.equal(findNearestPharmacy([first, second], device).pharmacy, first);
});

test("empty or malformed lists cannot select a pharmacy", () => {
  for (const points of [[], null, undefined, {}, "pharmacies"]) {
    assert.equal(findNearestPharmacy(points, device), null);
  }
});

test("invalid pharmacy coordinates are skipped without changing the valid pharmacy's index", () => {
  const invalid = [
    null, undefined, {},
    { lat: null, lon: 76 }, { lat: "43", lon: 76 }, { lat: 43, lon: "76" },
    { lat: NaN, lon: 76 }, { lat: 43, lon: NaN },
    { lat: Infinity, lon: 76 }, { lat: 43, lon: -Infinity },
    { lat: 90.0001, lon: 76 }, { lat: -90.0001, lon: 76 },
    { lat: 43, lon: 180.0001 }, { lat: 43, lon: -180.0001 },
    { lat: 0, lon: 0 }, { lat: -0, lon: -0 },
  ];
  assert.equal(findNearestPharmacy(invalid, device), null);
  const pharmacy = { ...device, sourceCode: "valid" };
  const result = findNearestPharmacy([...invalid, pharmacy], device);
  assert.equal(result.pharmacy, pharmacy);
  assert.equal(result.index, invalid.length);
});

test("an individual zero coordinate is allowed for real equator or meridian positions", () => {
  assert.notEqual(findNearestPharmacy([{ lat: 0, lon: 1 }], device), null);
  assert.notEqual(findNearestPharmacy([{ lat: 1, lon: 0 }], device), null);
});

test("invalid device coordinates cannot select any pharmacy", () => {
  for (const location of [
    null, undefined, {},
    { lat: null, lon: 76 }, { lat: "43", lon: 76 }, { lat: 43, lon: "76" },
    { lat: NaN, lon: 76 }, { lat: 43, lon: NaN },
    { lat: Infinity, lon: 76 }, { lat: 43, lon: -Infinity },
    { lat: 90.0001, lon: 76 }, { lat: -90.0001, lon: 76 },
    { lat: 43, lon: 180.0001 }, { lat: 43, lon: -180.0001 },
  ]) {
    assert.equal(findNearestPharmacy([device], location), null);
  }
});

test("nearest selection does not sort, annotate or mutate the supplied list", () => {
  const points = Object.freeze([
    Object.freeze({ lat: 51.16, lon: 71.47, sourceCode: "far" }),
    Object.freeze({ ...device, sourceCode: "near" }),
  ]);
  const before = structuredClone(points);
  assert.equal(findNearestPharmacy(points, device).index, 1);
  assert.deepEqual(points, before);
});

test("location request calls the native API once with bounded settings and returns coordinates only", async () => {
  const { geolocation, calls } = controlledGeolocation();
  const { signal, listeners } = trackedAbortController();
  const pending = requestDeviceLocation(geolocation, signal);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  assert.equal(listeners.size, 1);
  calls[0].success(position());
  assert.deepEqual(await pending, device);
  assert.equal(listeners.size, 0);
});

test("a cached synchronous browser response resolves normally", async () => {
  const geolocation = { getCurrentPosition(success) { success(position()); } };
  assert.deepEqual(await requestDeviceLocation(geolocation), device);
});

for (const [code, expected] of [[1, "permission_denied"], [2, "position_unavailable"], [3, "timeout"], [999, "position_unavailable"]]) {
  test(`browser geolocation error ${code} is converted to ${expected} and cleans up its listener`, async () => {
    const { geolocation, calls } = controlledGeolocation();
    const { signal, listeners } = trackedAbortController();
    const pending = requestDeviceLocation(geolocation, signal);
    calls[0].error({ code, message: "browser-internal error" });
    await rejectsWithCode(pending, expected);
    assert.equal(listeners.size, 0);
    assert.equal(calls.length, 1);
  });
}

test("missing or malformed geolocation APIs reject without attaching an abort listener", async () => {
  for (const geolocation of [undefined, null, {}, { getCurrentPosition: false }]) {
    const { signal, listeners } = trackedAbortController();
    await rejectsWithCode(requestDeviceLocation(geolocation, signal), "unsupported");
    assert.equal(listeners.size, 0);
  }
});

test("invalid coordinates from the device reject safely and remove the listener", async () => {
  for (const payload of [
    null, undefined, {}, { coords: null },
    position(NaN, 76), position(43, Infinity), position(91, 76), position(43, -181),
    position("43", 76), position(null, 76),
  ]) {
    const { geolocation, calls } = controlledGeolocation();
    const { signal, listeners } = trackedAbortController();
    const pending = requestDeviceLocation(geolocation, signal);
    calls[0].success(payload);
    await rejectsWithCode(pending, "invalid_position");
    assert.equal(listeners.size, 0);
  }
});

test("synchronous browser exceptions become safe errors and remove the listener", async () => {
  for (const [error, code] of [
    [new Error("internal error"), "position_unavailable"],
    [new DOMException("blocked", "NotAllowedError"), "permission_denied"],
    [new DOMException("blocked", "SecurityError"), "permission_denied"],
  ]) {
    const { signal, listeners } = trackedAbortController();
    await rejectsWithCode(requestDeviceLocation({ getCurrentPosition() { throw error; } }, signal), code);
    assert.equal(listeners.size, 0);
  }
});

test("aborting before a request never opens a location prompt", async () => {
  const { geolocation, calls } = controlledGeolocation();
  const { controller, signal, listeners } = trackedAbortController();
  controller.abort();
  await rejectsWithCode(requestDeviceLocation(geolocation, signal), "aborted");
  assert.equal(calls.length, 0);
  assert.equal(listeners.size, 0);
});

test("abort during a request rejects once and ignores late callbacks before reading their payloads", async () => {
  const { geolocation, calls } = controlledGeolocation();
  const { controller, signal, listeners } = trackedAbortController();
  const pending = requestDeviceLocation(geolocation, signal);
  controller.abort();
  await rejectsWithCode(pending, "aborted");
  assert.equal(listeners.size, 0);
  assert.doesNotThrow(() => calls[0].success({ get coords() { throw new Error("late success must be ignored"); } }));
  assert.doesNotThrow(() => calls[0].error({ get code() { throw new Error("late error must be ignored"); } }));
  assert.equal(calls.length, 1);
});

test("the first success wins over duplicate success, errors and a later abort", async () => {
  const { geolocation, calls } = controlledGeolocation();
  const { controller, signal, listeners } = trackedAbortController();
  const pending = requestDeviceLocation(geolocation, signal);
  calls[0].success(position());
  calls[0].success(position(51.16, 71.47));
  calls[0].error({ code: 1 });
  controller.abort();
  assert.deepEqual(await pending, device);
  assert.equal(listeners.size, 0);
});

test("the first failure wins over a late success or another failure", async () => {
  const { geolocation, calls } = controlledGeolocation();
  const pending = requestDeviceLocation(geolocation);
  calls[0].error({ code: 3 });
  calls[0].success(position());
  calls[0].error({ code: 1 });
  await rejectsWithCode(pending, "timeout");
});

test("Russian error instructions provide a map fallback and do not expose raw browser messages", () => {
  assert.match(geolocationErrorMessage(new GeolocationFailure("permission_denied")), /настройках браузера.*на карте/);
  assert.match(geolocationErrorMessage({ code: 1 }), /Разрешите/);
  assert.match(geolocationErrorMessage({ code: "timeout" }), /Попробуйте ещё раз.*на карте/);
  assert.match(geolocationErrorMessage(new GeolocationFailure("unsupported")), /на карте/);
  assert.match(geolocationErrorMessage(new GeolocationFailure("invalid_position")), /некорректное.*на карте/);
  assert.equal(geolocationErrorMessage(new DOMException("cancelled", "AbortError")), "Определение местоположения отменено.");
  for (const error of [undefined, null, "internal GPS data", new Error("internal GPS data")]) {
    const message = geolocationErrorMessage(error);
    assert.match(message, /на карте/);
    assert.doesNotMatch(message, /internal GPS data/);
  }
});
