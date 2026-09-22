import assert from "node:assert/strict";
import test from "node:test";

import { getLruEntry, setLruEntry } from "../src/lib/boundedLru.ts";

test("bounded LRU deterministically evicts unique public-search keys", () => {
  const cache = new Map();
  setLruEntry(cache, "search:alpha", { products: ["a"] }, 3);
  setLruEntry(cache, "search:beta", { products: ["b"] }, 3);
  setLruEntry(cache, "search:gamma", { products: ["c"] }, 3);

  assert.deepEqual(getLruEntry(cache, "search:alpha"), { products: ["a"] });
  setLruEntry(cache, "search:delta", { products: ["d"] }, 3);

  assert.equal(cache.size, 3);
  assert.equal(getLruEntry(cache, "search:beta"), undefined);
  assert.deepEqual([...cache.keys()], ["search:gamma", "search:alpha", "search:delta"]);
});

test("replacing an existing entry never grows the cache", () => {
  const cache = new Map();
  setLruEntry(cache, "search:alpha", 1, 2);
  setLruEntry(cache, "search:alpha", 2, 2);

  assert.equal(cache.size, 1);
  assert.equal(getLruEntry(cache, "search:alpha"), 2);
});
