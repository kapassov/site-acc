/**
 * Read a Map entry and promote it to the most-recently-used position.
 * Map iteration order gives deterministic LRU eviction without timers.
 */
export function getLruEntry<K, V>(cache: Map<K, V>, key: K): V | undefined {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key) as V;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Store an entry and synchronously evict the least-recently-used keys.
 * The caller supplies a trusted process-level maximum.
 */
export function setLruEntry<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
) {
  cache.delete(key);
  cache.set(key, value);
  const limit = Math.max(1, Math.floor(maxEntries));
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
