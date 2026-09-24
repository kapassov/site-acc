import assert from "node:assert/strict";
import test from "node:test";
import { withRegistryCoordinates } from "../src/lib/pharmacy-coordinate-registry.ts";

const base = { sourceCode: "sloc_TEST", name: "Аптека", city: "Алматы", hours: "" };

test("verified registry fills an exact Medusa address without changing its identity", () => {
  const point = withRegistryCoordinates({ ...base, address: "5мкр д 18" });
  assert.equal(point.sourceCode, "sloc_TEST");
  assert.equal(point.lat, 43.22868);
  assert.equal(point.lon, 76.86406);
  assert.equal(point.hours, "ежедневно 08:00–22:00");
});

test("verified registry tolerates harmless address formatting", () => {
  const point = withRegistryCoordinates({ ...base, address: "г. Алматы, микрорайон 5, дом 18" });
  assert.equal(point.lat, 43.22868);
  assert.equal(point.lon, 76.86406);
});

test("verified registry fills mapped Daribar pickup pharmacies with missing database coordinates", () => {
  for (const [address, lat, lon] of [
    ["Кабанбай батыра 199", 43.24698, 76.90352],
    ["Серкебаева, 45", 43.22037, 76.89674],
    ["Орбита 4 д 11", 43.19516, 76.87927],
  ]) {
    const point = withRegistryCoordinates({ ...base, address, lat: 0, lon: 0 });
    assert.equal(point.sourceCode, "sloc_TEST");
    assert.equal(point.lat, lat);
    assert.equal(point.lon, lon);
  }
});

test("registry never guesses a different house and never overrides upstream coordinates", () => {
  const unmatched = withRegistryCoordinates({ ...base, address: "5 мкр, дом 19" });
  assert.equal(unmatched.lat, undefined);
  assert.equal(unmatched.lon, undefined);
  const upstream = withRegistryCoordinates({ ...base, address: "5мкр д 18", lat: 43.9, lon: 76.1 });
  assert.equal(upstream.lat, 43.9);
  assert.equal(upstream.lon, 76.1);
});
