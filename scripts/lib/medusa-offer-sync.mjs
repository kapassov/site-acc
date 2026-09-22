const PRODUCT_ID_PATTERN = /^prod_[A-Za-z0-9]+$/;

function integer(raw, name, fallback, minimum, maximum) {
  const value = raw === undefined || raw === null || String(raw).trim() === ""
    ? fallback
    : Number(String(raw).trim());
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function validProductId(value) {
  return typeof value === "string" && value.length <= 128 && PRODUCT_ID_PATTERN.test(value);
}

export function parseOfferSyncArgs(argv, env = process.env) {
  const options = {
    apply: false,
    full: false,
    failedOnly: false,
    help: false,
    limit: integer(env.CATALOG_OFFER_SYNC_LIMIT, "CATALOG_OFFER_SYNC_LIMIT", 300, 1, 100_000),
    concurrency: integer(env.CATALOG_OFFER_SYNC_CONCURRENCY, "CATALOG_OFFER_SYNC_CONCURRENCY", 3, 1, 8),
    timeoutMs: integer(env.CATALOG_OFFER_SYNC_TIMEOUT_MS, "CATALOG_OFFER_SYNC_TIMEOUT_MS", 10_000, 1_000, 60_000),
    attempts: integer(env.CATALOG_OFFER_SYNC_ATTEMPTS, "CATALOG_OFFER_SYNC_ATTEMPTS", 2, 1, 5),
    maxPharmacies: integer(env.CATALOG_OFFER_SYNC_MAX_PHARMACIES, "CATALOG_OFFER_SYNC_MAX_PHARMACIES", 2_500, 1, 10_000),
    maxResponseBytes: integer(env.CATALOG_OFFER_SYNC_MAX_RESPONSE_BYTES, "CATALOG_OFFER_SYNC_MAX_RESPONSE_BYTES", 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024),
    batchDelayMs: integer(env.CATALOG_OFFER_SYNC_BATCH_DELAY_MS, "CATALOG_OFFER_SYNC_BATCH_DELAY_MS", 150, 0, 10_000),
  };
  const flags = new Map([
    ["--limit", ["limit", 1, 100_000]],
    ["--concurrency", ["concurrency", 1, 8]],
    ["--timeout-ms", ["timeoutMs", 1_000, 60_000]],
    ["--attempts", ["attempts", 1, 5]],
    ["--max-pharmacies", ["maxPharmacies", 1, 10_000]],
    ["--max-response-bytes", ["maxResponseBytes", 64 * 1024, 64 * 1024 * 1024]],
    ["--batch-delay-ms", ["batchDelayMs", 0, 10_000]],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--full") options.full = true;
    else if (argument === "--failed-only") options.failedOnly = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (flags.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      const [key, min, max] = flags.get(argument);
      options[key] = integer(value, argument, null, min, max);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.full) options.limit = 100_000;
  return options;
}

function boundedText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cityFromName(name) {
  return name.match(/(?:^|[\s,;])г\.?\s*([\p{L}][\p{L}-]+)/iu)?.[1] || "";
}

function explicitlyUnavailable(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const rawQuantity = raw.available_quantity ?? raw.quantity;
  if (rawQuantity === undefined || rawQuantity === null || String(rawQuantity).trim() === "") return false;
  const quantity = Number(rawQuantity);
  const priceMissing = raw.price === undefined || raw.price === null || String(raw.price).trim() === "";
  const explicitlyOutOfStock = raw.in_stock === false;
  return Number.isFinite(quantity)
    && quantity <= 0
    && (explicitlyOutOfStock || priceMissing || Number(raw.price) <= 0);
}

/**
 * An empty or partially malformed list is ambiguous. The endpoint has no
 * explicit snapshot/version flag, so only a fully usable non-empty response
 * may replace a last-known-good snapshot.
 */
export function normalizePharmacyPayload(payload, { maxPharmacies = 2_500 } = {}) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.pharmacies)) {
    return { status: "invalid", reason: "response_missing_pharmacies_array", offers: [] };
  }
  if (payload.pharmacies.length === 0) {
    return { status: "empty", reason: "empty_pharmacies_ambiguous", offers: [] };
  }
  if (payload.pharmacies.length > maxPharmacies) {
    return { status: "invalid", reason: "pharmacy_snapshot_exceeds_limit", offers: [] };
  }

  const offers = new Map();
  let invalidRows = 0;
  for (const raw of payload.pharmacies) {
    // Medusa legitimately includes unavailable pharmacies as
    // { quantity: 0, price: null }. They are not offers and must not make the
    // usable prices from the same response fail validation.
    if (explicitlyUnavailable(raw)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalidRows += 1;
      continue;
    }
    const id = boundedText(raw.id, 256);
    const price = Math.round(Number(raw.price));
    if (!id || !Number.isSafeInteger(price) || price <= 0) {
      invalidRows += 1;
      continue;
    }
    const name = boundedText(raw.name, 512) || id;
    const city = boundedText(raw.city, 256) || cityFromName(name).slice(0, 256);
    const address = boundedText(raw.address, 1_024);
    const offer = { id, name, city, address, price };
    const previous = offers.get(id);
    if (!previous || offer.price < previous.price) offers.set(id, offer);
  }
  if (invalidRows > 0) {
    return { status: "invalid", reason: `invalid_pharmacy_rows:${invalidRows}`, offers: [] };
  }
  if (offers.size === 0) {
    return { status: "empty", reason: "no_usable_pharmacy_offers", offers: [] };
  }
  return {
    status: "valid",
    reason: null,
    offers: [...offers.values()].sort((left, right) => left.price - right.price || left.id.localeCompare(right.id)),
  };
}

export function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const RETRYABLE_TRANSACTION_CODES = new Set(["40P01", "40001"]);

export function retryableTransactionError(error) {
  return Boolean(error && typeof error === "object" && RETRYABLE_TRANSACTION_CODES.has(error.code));
}

export function transactionRetryDelayMs(attempt, jitter = Math.floor(Math.random() * 100)) {
  const safeAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  const safeJitter = Number.isSafeInteger(jitter) ? Math.max(0, Math.min(99, jitter)) : 0;
  return Math.min(2_000, 100 * (2 ** (safeAttempt - 1))) + safeJitter;
}

/**
 * A run is complete only when every selected product produced a valid
 * snapshot. Empty responses are deliberately retryable because Medusa does
 * not expose a versioned marker that would distinguish a real zero-stock
 * snapshot from a partial upstream response.
 */
export function offerSyncExitCode(summary) {
  const failed = Number(summary?.failed) || 0;
  const empty = Number(summary?.empty) || 0;
  return failed > 0 || empty > 0 ? 2 : 0;
}
