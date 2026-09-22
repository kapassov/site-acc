import { isIP } from "node:net";

type RateLimitBucket = {
  hits: number[];
  max: number;
  windowMs: number;
  expiresAt: number;
};

type RateLimiterOptions = {
  maxBuckets?: number;
  maxKeyLength?: number;
  cleanupIntervalMs?: number;
};

const DEFAULT_MAX_BUCKETS = 4096;
const DEFAULT_MAX_KEY_LENGTH = 256;
const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;

/**
 * Process-wide sliding-window limiter for the current single-instance
 * deployment. Every bucket owns its window and expiry, and active buckets are
 * never evicted to admit attacker-controlled keys. Multi-instance deployments
 * must replace this store with a shared backend such as Redis.
 */
export class BoundedRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();
  readonly #maxBuckets: number;
  readonly #maxKeyLength: number;
  readonly #cleanupIntervalMs: number;
  #nextCleanupAt = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.#maxBuckets = positiveInteger(options.maxBuckets, DEFAULT_MAX_BUCKETS);
    this.#maxKeyLength = positiveInteger(options.maxKeyLength, DEFAULT_MAX_KEY_LENGTH);
    this.#cleanupIntervalMs = positiveInteger(
      options.cleanupIntervalMs,
      DEFAULT_CLEANUP_INTERVAL_MS,
    );
  }

  get bucketCount(): number {
    return this.#buckets.size;
  }

  take(key: string, max: number, windowMs: number, now: number): boolean {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > this.#maxKeyLength ||
      !Number.isSafeInteger(max) ||
      max <= 0 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0 ||
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      return false;
    }

    if (now >= this.#nextCleanupAt) {
      this.#deleteExpired(now);
      this.#nextCleanupAt = now + this.#cleanupIntervalMs;
    }

    let bucket = this.#buckets.get(key);
    if (bucket && (bucket.max !== max || bucket.windowMs !== windowMs)) {
      // A key is a stable policy identity. Reusing it with a different policy
      // must not reset its existing admission history.
      return false;
    }

    if (bucket) {
      const bucketWindowMs = bucket.windowMs;
      bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < bucketWindowMs);
      if (bucket.hits.length === 0) {
        this.#buckets.delete(key);
        bucket = undefined;
      } else {
        bucket.expiresAt = bucket.hits[bucket.hits.length - 1] + bucket.windowMs;
      }
    }

    if (!bucket) {
      if (this.#buckets.size >= this.#maxBuckets) return false;

      bucket = { hits: [], max, windowMs, expiresAt: now + windowMs };
      this.#buckets.set(key, bucket);
    }

    if (bucket.hits.length >= bucket.max) return false;

    bucket.hits.push(now);
    bucket.expiresAt = now + bucket.windowMs;
    return true;
  }

  #deleteExpired(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.expiresAt <= now) this.#buckets.delete(key);
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

const limiterGlobal = globalThis as typeof globalThis & {
  __inkarRateLimiter?: BoundedRateLimiter;
};
const sharedLimiter = (limiterGlobal.__inkarRateLimiter ??= new BoundedRateLimiter());

export function rateLimit(key: string, max: number, windowMs: number, now: number): boolean {
  return sharedLimiter.take(key, max, windowMs, now);
}

/**
 * Production traffic reaches Next.js only through the shipped nginx configs.
 * nginx overwrites X-Real-IP with its own $remote_addr and the application
 * intentionally ignores caller-supplied forwarding chains.
 */
export function clientIp(req: Request): string {
  const address = req.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(address) ? address.toLowerCase() : "unknown";
}
