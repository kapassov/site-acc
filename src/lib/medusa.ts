/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Серверный слой доступа к Medusa Store API (read-path).
 * Только publishable-ключ и публичные store-эндпоинты. Браузер напрямую к бэку
 * ходить не может (CORS), поэтому fetch выполняется на сервере Next.
 */
import type { Product, ProductArt, ProductArtKind, CatNode } from "@/lib/types";
import { guardMedusaProductStock, medusaStockMetadata } from "@/lib/medusa-stock";
import { exactKzt } from "@/lib/money";
import { pharmacyCoordinate } from "@/lib/pharmacy-stock";
import { medusaPrescription } from "@/lib/prescription";
import type { PharmaPrice, PriceInfo } from "@/lib/price-info";
import { getLruEntry, setLruEntry } from "@/lib/boundedLru";
import { medusaMediaUrl } from "@/lib/media-url";
import { canonicalProductSlug, normalizeProductIdentity } from "@/lib/product-normalization";
import { productImageFallback } from "@/lib/product-image-overrides";
import { secureMedusaBaseUrl } from "@/lib/medusaUrl";
import { recentSuccessfulProbeAge } from "@/lib/health-readiness";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

function configuredMedusaBaseUrl() {
  try {
    return secureMedusaBaseUrl(process.env.MEDUSA_URL);
  } catch {
    return null;
  }
}

const BASE = configuredMedusaBaseUrl();
const PK = process.env.MEDUSA_PUBLISHABLE_KEY || "";
const SC = process.env.MEDUSA_SALES_CHANNEL || "sc_01KRXGQFYXMJN3FD1WJ7S83WME";
const REG = process.env.MEDUSA_REGION || "reg_01KSBNEH2D4GVJN8EATK79WNSH";

export const MEDUSA_ON = Boolean(BASE && PK) && process.env.MEDUSA_ENABLED !== "false";

// Листингу не нужны тяжёлые description/images. Полные поля запрашиваем только
// для страницы конкретного товара — это сокращает основной ответ в несколько раз.
const PRODUCT_LIST_FIELDS = "id,title,handle,thumbnail,variants.id,variants.sku,*variants.calculated_price,*categories,images.url,images.metadata.gallery,metadata.brand_name,metadata.brand_raw,metadata.corporation,metadata.manufacturer,metadata.rx_otc,metadata.ware_id,metadata.standard_n_min_price,metadata.standard_n_in_stock,metadata.standard_n_pharmacy_count,metadata.standard_n_source_date,metadata.standard_n_snapshot_id,metadata.standard_n_valid_until,metadata.medusa_price_export_id,metadata.medusa_price_export_min,metadata.medusa_price_exported_at";
const PRODUCT_DETAIL_FIELDS = "id,title,handle,thumbnail,subtitle,description,variants.id,variants.title,variants.sku,variants.barcode,*variants.calculated_price,*categories,*images,+metadata";

type FetchPolicy = {
  freshMs?: number;
  staleMs?: number;
  fallbackMs?: number;
  timeoutMs?: number;
  accept?: (data: any) => boolean;
  persist?: boolean;
  retries?: number;
};

type CacheEntry = {
  data: any;
  freshUntil: number;
  staleUntil: number;
  updatedAt: number;
};

type MedusaRuntime = {
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<any>>;
  productsByHandle: Map<string, Product>;
  hits: number;
  staleHits: number;
  misses: number;
  failures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
};

type QueueWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type MedusaConnection = {
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
  cached?: boolean;
  cacheAgeMs?: number;
  stale?: boolean;
  attempts?: number;
  lastSuccessAgeMs?: number;
};

type MedusaGuard = {
  active: number;
  queue: QueueWaiter[];
  consecutiveFailures: number;
  breakerOpenUntil: number;
  breakerTrips: number;
  shortCircuits: number;
  queueRejected: number;
  probeResult: MedusaConnection | null;
  probeAt: number;
  probeInflight: Promise<MedusaConnection> | null;
  lastReachableAt: number;
};

type CatalogSnapshotEntry = {
  products: Product[];
  sourceCount: number;
  complete: boolean;
  generatedAt: number;
  freshUntil: number;
  staleUntil: number;
};

type CatalogSnapshotRuntime = {
  entry: CatalogSnapshotEntry | null;
  inflight: Promise<CatalogSnapshotEntry> | null;
};

const runtimeRoot = globalThis as typeof globalThis & { __inkarMedusaRuntime?: MedusaRuntime };
const runtime = runtimeRoot.__inkarMedusaRuntime ??= {
  cache: new Map(),
  inflight: new Map(),
  productsByHandle: new Map(),
  hits: 0,
  staleHits: 0,
  misses: 0,
  failures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
};
const guardRoot = globalThis as typeof globalThis & { __inkarMedusaGuard?: MedusaGuard };
const guard = guardRoot.__inkarMedusaGuard ??= {
  active: 0,
  queue: [],
  consecutiveFailures: 0,
  breakerOpenUntil: 0,
  breakerTrips: 0,
  shortCircuits: 0,
  queueRejected: 0,
  probeResult: null,
  probeAt: 0,
  probeInflight: null,
  lastReachableAt: 0,
};
if (!Number.isFinite(guard.lastReachableAt)) {
  guard.lastReachableAt = guard.probeResult?.reachable && !guard.probeResult.stale ? guard.probeAt : 0;
}
const diskCacheDir = process.env.MEDUSA_CACHE_DIR || join(process.cwd(), ".runtime-cache", "medusa");
const READ_CONCURRENCY = clampInt(process.env.MEDUSA_READ_CONCURRENCY, 3, 1, 8);
const MAX_MEMORY_CACHE_ENTRIES = clampInt(process.env.MEDUSA_MEMORY_CACHE_ENTRIES, 512, 16, 5_000);
const QUEUE_TIMEOUT_MS = clampInt(process.env.MEDUSA_QUEUE_TIMEOUT_MS, 3_000, 250, 15_000);
const MAX_QUEUE = clampInt(process.env.MEDUSA_MAX_QUEUE, 32, 4, 256);
const BREAKER_THRESHOLD = clampInt(process.env.MEDUSA_BREAKER_THRESHOLD, 3, 2, 10);
const BREAKER_COOLDOWN_MS = clampInt(process.env.MEDUSA_BREAKER_COOLDOWN_MS, 20_000, 5_000, 120_000);
const PROBE_TTL_MS = clampInt(process.env.MEDUSA_PROBE_TTL_MS, 30_000, 5_000, 120_000);
const PROBE_TIMEOUT_MS = clampInt(process.env.MEDUSA_PROBE_TIMEOUT_MS, 7_500, 3_000, 15_000);
const PROBE_STALE_SUCCESS_MS = clampInt(
  process.env.MEDUSA_PROBE_STALE_SUCCESS_MS,
  120_000,
  30_000,
  300_000,
);
// The live Medusa accepts 5,000 products for the listing projection. Six
// batches cover the current catalogue and keep every response comfortably
// below the storefront proxy's 12 MB response limit.
const CATALOG_BATCH_SIZE = 5_000;
const CATALOG_SCAN_CONCURRENCY = READ_CONCURRENCY > 1 ? Math.min(2, READ_CONCURRENCY - 1) : 1;
const CATALOG_SNAPSHOT_FRESH_MS = 5 * 60_000;
const CATALOG_SNAPSHOT_STALE_MS = 24 * 60 * 60_000;
const catalogRoot = globalThis as typeof globalThis & { __inkarCatalogSnapshot?: CatalogSnapshotRuntime };
const catalogSnapshot = catalogRoot.__inkarCatalogSnapshot ??= { entry: null, inflight: null };

function clampInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

class MedusaReadError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MedusaReadError";
    this.status = status;
  }
}

class MedusaCircuitOpenError extends MedusaReadError {
  constructor() {
    super("Medusa circuit is open", 503);
    this.name = "MedusaCircuitOpenError";
  }
}

class MedusaQueueError extends MedusaReadError {
  constructor() {
    super("Medusa read queue is overloaded", 503);
    this.name = "MedusaQueueError";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown) {
  if (error instanceof MedusaCircuitOpenError || error instanceof MedusaQueueError) return false;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof MedusaReadError)) return true;
  return error.status === null || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

function breakerIsOpen() {
  return guard.breakerOpenUntil > Date.now();
}

function noteUpstreamSuccess() {
  guard.consecutiveFailures = 0;
  guard.breakerOpenUntil = 0;
}

function noteUpstreamFailure(error: unknown) {
  if (!isRetryable(error)) return;
  guard.consecutiveFailures += 1;
  if (guard.consecutiveFailures >= BREAKER_THRESHOLD) {
    guard.breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    guard.breakerTrips += 1;
  }
}

function releaseReadSlot() {
  guard.active = Math.max(0, guard.active - 1);
  const next = guard.queue.shift();
  if (!next) return;
  clearTimeout(next.timer);
  guard.active += 1;
  next.resolve(releaseReadSlot);
}

function acquireReadSlot(): Promise<() => void> {
  if (guard.active < READ_CONCURRENCY) {
    guard.active += 1;
    return Promise.resolve(releaseReadSlot);
  }
  if (guard.queue.length >= MAX_QUEUE) {
    guard.queueRejected += 1;
    return Promise.reject(new MedusaQueueError());
  }
  return new Promise((resolve, reject) => {
    const waiter = {} as QueueWaiter;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.timer = setTimeout(() => {
      const index = guard.queue.indexOf(waiter);
      if (index >= 0) guard.queue.splice(index, 1);
      guard.queueRejected += 1;
      reject(new MedusaQueueError());
    }, QUEUE_TIMEOUT_MS);
    guard.queue.push(waiter);
  });
}

function diskCacheFile(url: string) {
  return join(diskCacheDir, `${createHash("sha256").update(url).digest("hex")}.json`);
}

async function readDiskCache(url: string, fallbackMs: number): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(diskCacheFile(url), "utf8")) as CacheEntry;
    if (!entry || typeof entry.updatedAt !== "number" || entry.updatedAt + fallbackMs <= Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeDiskCache(url: string, entry: CacheEntry) {
  try {
    await mkdir(diskCacheDir, { recursive: true });
    const target = diskCacheFile(url);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), "utf8");
    await rename(temporary, target);
  } catch {
    // Дисковый fallback — дополнительная страховка; ошибка записи не должна ломать ответ пользователю.
  }
}

// Одна попытка запроса с таймаутом. Persistent fetch-кэш Next здесь намеренно выключен:
// актуальность и stale-fallback контролируются ниже, чтобы пустой ответ не застревал после восстановления Medusa.
async function mfetchOnce(u: string, timeoutMs: number) {
  if (breakerIsOpen()) {
    guard.shortCircuits += 1;
    throw new MedusaCircuitOpenError();
  }
  const release = await acquireReadSlot();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    if (breakerIsOpen()) {
      guard.shortCircuits += 1;
      throw new MedusaCircuitOpenError();
    }
    const res = await fetch(u, {
      headers: { "x-publishable-api-key": PK },
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) throw new MedusaReadError(`Medusa -> ${res.status}`, res.status);
    const data = await res.json();
    noteUpstreamSuccess();
    return data;
  } catch (error) {
    noteUpstreamFailure(error);
    throw error;
  } finally {
    clearTimeout(timer);
    release();
  }
}

async function refresh(u: string, policy: Required<Omit<FetchPolicy, "accept">> & Pick<FetchPolicy, "accept">) {
  const existing = runtime.inflight.get(u);
  if (existing) return existing;

  const task = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= policy.retries; attempt++) {
      try {
        const data = await mfetchOnce(u, policy.timeoutMs);
        if (policy.accept && !policy.accept(data)) throw new MedusaReadError("Medusa returned an invalid or empty payload");
        const now = Date.now();
        const entry = {
          data,
          freshUntil: now + policy.freshMs,
          staleUntil: now + policy.staleMs,
          updatedAt: now,
        };
        setLruEntry(runtime.cache, u, entry, MAX_MEMORY_CACHE_ENTRIES);
        if (policy.persist) await writeDiskCache(u, entry);
        runtime.lastSuccessAt = now;
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < policy.retries && isRetryable(error)) {
          await wait(180);
          continue;
        }
        break;
      }
    }
    runtime.failures += 1;
    runtime.lastFailureAt = Date.now();
    throw lastError;
  })().finally(() => runtime.inflight.delete(u));

  runtime.inflight.set(u, task);
  return task;
}

async function mfetch(
  path: string,
  params: Record<string, string | number | Array<string | number>> = {},
  options: FetchPolicy = {},
) {
  if (!BASE) throw new MedusaReadError("Medusa is not securely configured", 503);
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const u = url.toString();

  const policy = {
    freshMs: options.freshMs ?? 30_000,
    staleMs: options.staleMs ?? 10 * 60_000,
    fallbackMs: options.fallbackMs ?? options.staleMs ?? 10 * 60_000,
    // Реальный store/products отвечает за 3.5-4.5 секунды. Старый порог 4.5с
    // обрывал корректные ответы при малейшем сетевом отклонении.
    timeoutMs: options.timeoutMs ?? 8_000,
    accept: options.accept,
    persist: options.persist ?? false,
    retries: options.retries ?? 0,
  };
  const now = Date.now();
  const cached = getLruEntry(runtime.cache, u);

  if (cached && cached.freshUntil > now) {
    runtime.hits += 1;
    return cached.data;
  }

  if (cached && cached.staleUntil > now) {
    runtime.staleHits += 1;
    void refresh(u, policy).catch(() => undefined);
    return cached.data;
  }

  if (cached && cached.updatedAt + Math.max(policy.staleMs, policy.fallbackMs) > now) {
    runtime.staleHits += 1;
    void refresh(u, policy).catch(() => undefined);
    return cached.data;
  }

  if (policy.persist) {
    const diskEntry = await readDiskCache(u, Math.max(policy.staleMs, policy.fallbackMs));
    if (diskEntry) {
      setLruEntry(runtime.cache, u, diskEntry, MAX_MEMORY_CACHE_ENTRIES);
      if (diskEntry.freshUntil > now) {
        runtime.hits += 1;
        return diskEntry.data;
      }
      runtime.staleHits += 1;
      void refresh(u, policy).catch(() => undefined);
      return diskEntry.data;
    }
  }

  runtime.misses += 1;
  return refresh(u, policy);
}

export function getMedusaRuntimeStats() {
  return {
    cacheEntries: runtime.cache.size,
    inflight: runtime.inflight.size,
    maxCacheEntries: MAX_MEMORY_CACHE_ENTRIES,
    hits: runtime.hits,
    staleHits: runtime.staleHits,
    misses: runtime.misses,
    failures: runtime.failures,
    lastSuccessAt: runtime.lastSuccessAt ? new Date(runtime.lastSuccessAt).toISOString() : null,
    lastFailureAt: runtime.lastFailureAt ? new Date(runtime.lastFailureAt).toISOString() : null,
    readConcurrency: READ_CONCURRENCY,
    activeReads: guard.active,
    queuedReads: guard.queue.length,
    queueRejected: guard.queueRejected,
    consecutiveFailures: guard.consecutiveFailures,
    breakerOpen: breakerIsOpen(),
    breakerOpenUntil: breakerIsOpen() ? new Date(guard.breakerOpenUntil).toISOString() : null,
    breakerTrips: guard.breakerTrips,
    shortCircuits: guard.shortCircuits,
  };
}

/** Product summaries seen on any catalogue/category request in this process. */
export function getKnownMedusaProduct(handle: string): Product | null {
  const product = runtime.productsByHandle.get(handle);
  return product ? guardMedusaProductStock(product) : null;
}

export async function checkMedusaConnection() {
  if (!MEDUSA_ON) return { configured: false, reachable: false, latencyMs: null as number | null };
  const now = Date.now();
  const probeTtl = guard.probeResult?.reachable && !guard.probeResult.stale
    ? PROBE_TTL_MS
    : Math.min(PROBE_TTL_MS, 5_000);
  if (guard.probeResult && now - guard.probeAt < probeTtl) {
    return { ...guard.probeResult, cached: true, cacheAgeMs: now - guard.probeAt };
  }
  if (guard.probeInflight) return guard.probeInflight;

  const task = (async (): Promise<MedusaConnection> => {
    const startedAt = Date.now();
    const url = new URL(BASE + "/store/products");
    url.searchParams.set("sales_channel_id", SC);
    url.searchParams.set("region_id", REG);
    url.searchParams.set("fields", "id");
    url.searchParams.set("limit", "1");

    const timeouts = [PROBE_TIMEOUT_MS, Math.min(PROBE_TIMEOUT_MS, 4_000)];
    let lastError = "connection_failed";
    for (let index = 0; index < timeouts.length; index += 1) {
      try {
        const data = await mfetchOnce(url.toString(), timeouts[index]);
        if (!Array.isArray(data?.products)) throw new Error("invalid_probe_response");
        guard.lastReachableAt = Date.now();
        return {
          configured: true,
          reachable: true,
          stale: false,
          attempts: index + 1,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "connection_failed";
        if (index + 1 < timeouts.length) await wait(150);
      }
    }

    const lastSuccessAgeMs = recentSuccessfulProbeAge(
      Date.now(),
      guard.lastReachableAt || null,
      PROBE_STALE_SUCCESS_MS,
    );
    if (lastSuccessAgeMs !== null) {
      return {
        configured: true,
        reachable: true,
        stale: true,
        attempts: timeouts.length,
        lastSuccessAgeMs,
        latencyMs: Date.now() - startedAt,
        error: lastError,
      };
    }
    return {
      configured: true,
      reachable: false,
      stale: false,
      attempts: timeouts.length,
      latencyMs: Date.now() - startedAt,
      error: lastError,
    };
  })();
  guard.probeInflight = task;
  try {
    const result = await task;
    guard.probeResult = result;
    guard.probeAt = Date.now();
    return result;
  } finally {
    guard.probeInflight = null;
  }
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Medusa пока отдаёт статику по HTTP. На HTTPS-витрине браузер блокирует такие
 * URL как mixed content, поэтому свои /static-файлы ведём через same-origin proxy.
 */
function brandOf(m: any): string {
  const raw = m?.brand_name || m?.brand_raw || m?.corporation || m?.manufacturer || m?.manufacturer_official || "";
  const first = String(raw).split("/")[0].trim();
  return first || "Аптека со склада";
}
function artOf(title: string, m: any): ProductArt {
  const t = (title + " " + (m?.category || "")).toLowerCase();
  let kind: ProductArtKind = "box";
  if (/спрей|spray|аэроз|назал/.test(t)) kind = "spray";
  else if (/капл|drops|сыворот/.test(t)) kind = "dropper";
  else if (/крем|cream|мазь|гель|бальзам|паста/.test(t)) kind = "tube";
  else if (/сироп|раствор|вода|масло|шампунь|лосьон|тоник|эмульс/.test(t)) kind = "bottle";
  else if (/порош|саше|банк/.test(t)) kind = "jar";
  else if (/таблет|капс|драже|табл|пастил/.test(t)) kind = "box";
  return { kind, hue: hash(title) % 360 };
}
function volOf(title: string): string | undefined {
  const m = String(title).match(/№\s?\d+|\d+\s?(мл|мг|г|мкг|таб|капс|шт|доз)/i);
  return m ? m[0] : undefined;
}
/** Вопрос-ответ из metadata.faq (массив объектов или JSON-строка) → нормализованный список. */
function faqOf(m: any): { q: string; a: string }[] | undefined {
  let raw: any = m?.faq;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return undefined; }
  }
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((x: any) => ({ q: String(x?.q ?? "").trim(), a: String(x?.a ?? "").trim() }))
    .filter((x) => x.q && x.a);
  return items.length ? items : undefined;
}
/** Чистим мета-значение от плейсхолдеров пустоты ("_", "null", "none", "-"). */
function cleanMeta(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s || ["_", "-", "—", "null", "none", "n/a", "нет"].includes(s.toLowerCase())) return undefined;
  return s;
}
/** key_facts → массив строк (массив или JSON-строка), без ведущих маркеров. */
function keyFactsOf(m: any): string[] | undefined {
  let raw: any = m?.key_facts;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return undefined; }
  }
  if (!Array.isArray(raw)) return undefined;
  const items = raw.map((x: any) => String(x ?? "").replace(/^[•\-–—\s]+/, "").trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/** Medusa product → наш Product. Только реальные поля из бэка:
 *  цена (calculated_price), бренд/Rx (metadata), категория, изображение (thumbnail/images).
 *  Рейтинга/отзывов/наличия по аптекам в Medusa нет — НЕ выдумываем (0), UI их скрывает. */
export function mapProduct(p: any, includeGallery = false): Product {
  const v = p?.variants?.[0];
  const cp = v?.calculated_price;
  const orig = cp?.original_amount ?? null;
  const m = p?.metadata || {};
  const prescription = medusaPrescription(m.rx_otc);
  const rx = prescription === true;
  const rawImgs: string[] = Array.isArray(p?.images) ? p.images.map((im: any) => medusaMediaUrl(im?.url)).filter(Boolean) : [];
  const siteImgs: string[] = Array.isArray(p?.images)
    ? p.images.filter((im: any) => im?.metadata?.gallery !== "marketplace").map((im: any) => medusaMediaUrl(im?.url)).filter(Boolean)
    : [];
  const imgs = [...new Set<string>(siteImgs.length ? siteImgs : rawImgs)];
  const thumbnail = medusaMediaUrl(p?.thumbnail);
  const gallery = includeGallery
    ? (thumbnail && !imgs.includes(thumbnail) ? [thumbnail, ...imgs] : imgs)
    : (thumbnail ? [thumbnail] : imgs.slice(0, 1));
  const fallbackImage = gallery.length ? undefined : productImageFallback(String(p?.id || ""));
  const resolvedGallery = fallbackImage ? [fallbackImage] : gallery;
  const variants = (Array.isArray(p?.variants) ? p.variants : []).map((item: any) => ({
    id: String(item?.id || ""),
    title: String(item?.title || p?.title || ""),
    sku: cleanMeta(item?.sku),
    barcode: cleanMeta(item?.barcode),
    price: exactKzt(item?.calculated_price?.calculated_amount) || undefined,
  })).filter((item: { id: string }) => item.id);
  const identity = normalizeProductIdentity({
    name: String(p?.title || ""),
    brand: brandOf(m),
    barcode: cleanMeta(v?.barcode || m.barcode),
    slug: String(p?.handle || ""),
  });
  // Medusa returns the technical catalogue root (`site`) alongside the real
  // category. It must never leak into breadcrumbs, links or storefront filters.
  const categories: any[] = Array.isArray(p?.categories) ? p.categories : [];
  const storefrontCategories = categories.filter((category: any) => {
    const handle = String(category?.handle || "").trim().toLowerCase();
    return handle && !["site", "root", "website"].includes(handle);
  });
  const primaryCategory = storefrontCategories[0];
  const stock = medusaStockMetadata(m);
  const product: Product = {
    id: p.id,
    source: "medusa",
    sku: cleanMeta(v?.sku),
    wareId: cleanMeta(m.ware_id),
    stockSourceDate: stock.sourceDate,
    stockValidUntil: cleanMeta(m.standard_n_valid_until),
    stockStale: stock.stale,
    slug: canonicalProductSlug(identity.name, String(p?.handle || "")),
    name: identity.name,
    brand: identity.brand,
    categorySlug: primaryCategory?.handle || "",
    categoryHandles: storefrontCategories.map((category: any) => category?.handle).filter(Boolean),
    price: stock.price ?? 0,
    oldPrice: orig != null && stock.price != null && exactKzt(orig) > stock.price ? exactKzt(orig) : undefined,
    priceTBD: stock.price == null,
    rating: 0,
    reviews: 0,
    volume: volOf(identity.name),
    badges: rx ? ["rx"] : [],
    art: artOf(identity.name, m),
    image: resolvedGallery[0] || undefined,
    images: resolvedGallery.length ? resolvedGallery : undefined,
    description: p?.description || undefined,
    // Для товаров без calculated_price наличие подтверждается рабочим pharmacy endpoint.
    // До этой проверки не заявляем вымышленное наличие.
    inStock: stock.inStock,
    stockPharmacies: stock.stockPharmacies,
    prescription,
    faq: faqOf(m),
    keyFacts: keyFactsOf(m),
    manufacturer: cleanMeta(m.manufacturer_official || m.manufacturer),
    country: cleanMeta(m.country_official || m.country),
    mnn: cleanMeta(m.mnn),
    atc: cleanMeta(m.atc || m.atc_1),
    barcode: cleanMeta(v?.barcode || m.barcode),
    variantId: cleanMeta(v?.id),
    variants: variants.length ? variants : undefined,
  };
  const remembered = runtime.productsByHandle.get(product.slug);
  // Never replace a rich PDP record with a smaller listing projection.
  if (!remembered || includeGallery || !remembered.description) {
    runtime.productsByHandle.set(product.slug, product);
  }
  return product;
}

type RawCatalogBatch = {
  products: any[];
  count: number;
  limit: number;
  offset: number;
};

async function getRawCatalogBatch(offset: number, requestedLimit: number): Promise<RawCatalogBatch> {
  const data = await mfetch(
    "/store/products",
    {
      sales_channel_id: SC,
      region_id: REG,
      fields: PRODUCT_LIST_FIELDS,
      limit: requestedLimit,
      offset,
      order: "created_at",
    },
    {
      freshMs: CATALOG_SNAPSHOT_FRESH_MS,
      staleMs: CATALOG_SNAPSHOT_STALE_MS,
      fallbackMs: 72 * 60 * 60_000,
      // Large offsets are slow on the current Medusa database. A complete
      // authoritative page is preferable to silently truncating the catalogue.
      timeoutMs: 60_000,
      persist: true,
      retries: 1,
      accept: (payload) => Array.isArray(payload?.products) && Number.isFinite(Number(payload?.count)),
    },
  );
  return {
    products: data.products || [],
    count: Math.max(0, Number(data.count ?? 0)),
    limit: Math.max(1, Number(data.limit ?? requestedLimit)),
    offset: Math.max(0, Number(data.offset ?? offset)),
  };
}

async function loadCatalogBatches(offsets: number[], pageSize: number): Promise<RawCatalogBatch[]> {
  const results = new Array<RawCatalogBatch>(offsets.length);
  let cursor = 0;

  async function worker() {
    while (cursor < offsets.length) {
      const index = cursor++;
      results[index] = await getRawCatalogBatch(offsets[index], pageSize);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CATALOG_SCAN_CONCURRENCY, offsets.length) }, () => worker()),
  );
  return results;
}

async function buildCatalogSnapshot(): Promise<CatalogSnapshotEntry> {
  const first = await getRawCatalogBatch(0, CATALOG_BATCH_SIZE);
  if (first.count > 0 && first.products.length === 0) {
    throw new MedusaReadError("Medusa returned an empty first catalogue page");
  }

  const pageSize = first.limit;
  const offsets: number[] = [];
  for (let offset = pageSize; offset < first.count; offset += pageSize) offsets.push(offset);
  const remaining = offsets.length ? await loadCatalogBatches(offsets, pageSize) : [];
  const rawProducts = [first, ...remaining]
    .sort((left, right) => left.offset - right.offset)
    .flatMap((batch) => batch.products);

  // A product inserted while the offset scan is running can otherwise appear
  // twice. De-duplication keeps pagination stable and exposes completeness in
  // response metadata instead of silently returning duplicate rows.
  const unique = new Map<string, any>();
  for (const product of rawProducts) {
    const id = String(product?.id || "");
    if (id && !unique.has(id)) unique.set(id, product);
  }
  const products = [...unique.values()].map((product) => mapProduct(product));
  const now = Date.now();
  return {
    products,
    sourceCount: first.count,
    complete: products.length >= first.count,
    generatedAt: now,
    freshUntil: now + CATALOG_SNAPSHOT_FRESH_MS,
    staleUntil: now + CATALOG_SNAPSHOT_STALE_MS,
  };
}

async function refreshCatalogSnapshot(): Promise<CatalogSnapshotEntry> {
  if (catalogSnapshot.inflight) return catalogSnapshot.inflight;
  const task = buildCatalogSnapshot()
    .then((entry) => {
      catalogSnapshot.entry = entry;
      return entry;
    })
    .finally(() => {
      catalogSnapshot.inflight = null;
    });
  catalogSnapshot.inflight = task;
  return task;
}

export type MedusaCatalogSnapshot = {
  products: Product[];
  sourceCount: number;
  loadedCount: number;
  complete: boolean;
  stale: boolean;
  generatedAt: string;
};

function publicCatalogSnapshot(entry: CatalogSnapshotEntry, stale: boolean): MedusaCatalogSnapshot {
  return {
    products: entry.products.map((product) => guardMedusaProductStock(product)),
    sourceCount: entry.sourceCount,
    loadedCount: entry.products.length,
    complete: entry.complete,
    stale,
    generatedAt: new Date(entry.generatedAt).toISOString(),
  };
}

/**
 * Complete Store API catalogue assembled from large, persisted Medusa pages.
 * Interactive reads retain at least one limiter slot while the snapshot warms.
 */
export async function getMedusaCatalogSnapshot(): Promise<MedusaCatalogSnapshot> {
  if (!MEDUSA_ON) {
    return {
      products: [],
      sourceCount: 0,
      loadedCount: 0,
      complete: true,
      stale: false,
      generatedAt: new Date().toISOString(),
    };
  }

  const now = Date.now();
  const entry = catalogSnapshot.entry;
  if (entry?.freshUntil && entry.freshUntil > now) return publicCatalogSnapshot(entry, false);
  if (entry?.staleUntil && entry.staleUntil > now) {
    void refreshCatalogSnapshot().catch(() => undefined);
    return publicCatalogSnapshot(entry, true);
  }

  try {
    return publicCatalogSnapshot(await refreshCatalogSnapshot(), false);
  } catch (error) {
    // An in-memory last-known-good snapshot is still preferable to truncating
    // the catalogue back to its first page. The caller marks it degraded.
    if (entry) return publicCatalogSnapshot(entry, true);
    throw error;
  }
}

export async function getMedusaProducts(limit = 100): Promise<Product[]> {
  const data = await mfetch(
    "/store/products",
    { sales_channel_id: SC, region_id: REG, fields: PRODUCT_LIST_FIELDS, limit },
    {
      freshMs: 5 * 60_000,
      staleMs: 24 * 60 * 60_000,
      fallbackMs: 72 * 60 * 60_000,
      timeoutMs: 6_000,
      persist: limit >= 100,
      retries: 0,
      accept: (payload) => Array.isArray(payload?.products) && (limit < 100 || payload.products.length > 0),
    },
  );
  return (data.products || []).map((product: any) => mapProduct(product));
}
export async function getMedusaProductByHandle(handle: string): Promise<Product | null> {
  const data = await mfetch(
    "/store/products",
    { sales_channel_id: SC, region_id: REG, handle, fields: PRODUCT_DETAIL_FIELDS, limit: 1 },
    {
      freshMs: 2 * 60_000,
      staleMs: 30 * 60_000,
      fallbackMs: 24 * 60 * 60_000,
      timeoutMs: 6_000,
      persist: true,
      retries: 0,
      accept: (payload) => Array.isArray(payload?.products),
    },
  );
  const p = (data.products || [])[0];
  return p ? mapProduct(p, true) : null;
}

/** Нативный точный поиск Medusa; typo-кандидаты строятся отдельным title-index. */
export async function searchMedusaProducts(q: string, limit = 40): Promise<Product[]> {
  if (!q.trim()) return [];
  const data = await mfetch(
    "/store/products",
    { sales_channel_id: SC, region_id: REG, q, fields: PRODUCT_LIST_FIELDS, limit },
    { freshMs: 60_000, staleMs: 10 * 60_000, timeoutMs: 8_000, retries: 0 },
  );
  return (data.products || []).map((product: any) => mapProduct(product));
}

/** Hydrate an index page from the authoritative Medusa Store API. */
export async function getMedusaProductsByIds(ids: string[]): Promise<Product[]> {
  const uniqueIds = [...new Set(ids.filter((id) => /^prod_[A-Za-z0-9]+$/.test(id)))].slice(0, 100);
  if (!MEDUSA_ON || uniqueIds.length === 0) return [];
  // Repeating id[] together with the long fields projection can exceed proxy
  // request-line limits for search result sets. Keep every Medusa request small
  // and merge the authoritative cards back into the index order afterwards.
  const chunks: string[][] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 20) {
    chunks.push(uniqueIds.slice(offset, offset + 20));
  }
  const settledResponses = await Promise.allSettled(chunks.map((chunk) => mfetch("/store/products", {
    "id[]": chunk,
    sales_channel_id: SC,
    region_id: REG,
    fields: PRODUCT_LIST_FIELDS,
    limit: chunk.length,
  }, {
    freshMs: 60_000,
    staleMs: 10 * 60_000,
    fallbackMs: 30 * 60_000,
    timeoutMs: 15_000,
    retries: 1,
    accept: (payload) => Array.isArray(payload?.products),
  })));
  const responses = settledResponses.flatMap((response) => (
    response.status === "fulfilled" ? [response.value] : []
  ));
  const products = responses.flatMap((data) => (
    (data.products || []).map((product: any) => mapProduct(product))
  ));
  const byId = new Map(products.map((product: Product) => [product.id, product]));
  return uniqueIds.map((id) => byId.get(id)).filter(Boolean) as Product[];
}

export type { PharmaPrice, PriceInfo } from "@/lib/price-info";

export { getMedusaPharmacies, type MedusaPharmacyPoint } from "@/lib/medusa-pharmacies";

/** У аптек city часто null — город зашит в name («…г. Шымкент, ул…»). Достаём. */
function cityFromName(name: string): string {
  const m = name.match(/г\.?\s*([А-ЯЁA-Z][А-Яа-яёЁA-Za-z-]+)/);
  return m ? m[1] : "";
}

/** Реальные розничные цены товара по аптекам сети (calculated_price пуст). Mirror Flutter. */
export async function getPharmacyPrices(productId: string): Promise<PriceInfo | null> {
  const normalizedProductId = productId.trim();
  if (!/^prod_[A-Za-z0-9]+$/.test(normalizedProductId) || normalizedProductId.length > 128) return null;

  if (!MEDUSA_ON) return null;

  try {
    const data = await mfetch(`/store/products/${encodeURIComponent(normalizedProductId)}/pharmacies`, {}, {
      freshMs: 60_000,
      staleMs: 0,
      fallbackMs: 0,
      timeoutMs: 6_000,
      persist: false,
      retries: 0,
      accept: (payload) => Array.isArray(payload?.pharmacies),
    });
    if (data.complete !== true || data.stale === true || data.data_state === "unavailable"
      || (data.valid_until && !(Date.parse(data.valid_until) > Date.now()))) return null;
    const pharmacies: PharmaPrice[] = ((data.pharmacies as unknown[]) || [])
      .slice(0, 2_000)
      .map((e) => {
        const o = (e || {}) as Record<string, unknown>;
        const price = exactKzt(o.price);
        const id = String(o.id ?? "").trim().slice(0, 256);
        const name = String(o.name ?? "").trim().slice(0, 512) || id;
        const rawCity = typeof o.city === "string" ? o.city.trim() : "";
        const city = rawCity || cityFromName(name);
        const address = typeof o.address === "string" ? o.address.trim().slice(0, 1_024) : "";
        const availableQuantity = Number(o.available_quantity);
        const quantity = Number(o.quantity);
        const inStock = o.in_stock === true && Number.isFinite(availableQuantity) && availableQuantity > 0;
        return { id, name, city: city.slice(0, 256), price, ...(address ? { address } : {}),
          quantity, availableQuantity, inStock,
          sourceDate: typeof o.source_date === "string" ? o.source_date : undefined,
          snapshotId: typeof o.snapshot_id === "string" ? o.snapshot_id : undefined,
          variantId: typeof o.variant_id === "string" ? o.variant_id : undefined,
          wareId: typeof o.ware_id === "string" ? o.ware_id : undefined,
          lat: pharmacyCoordinate(o.lat, 90),
          lon: pharmacyCoordinate(o.lon, 180),
          hours: typeof o.hours === "string" ? o.hours : undefined,
        };
      })
      .filter((p) => p.id && p.inStock && p.price > 0)
      .sort((left, right) => left.price - right.price || left.name.localeCompare(right.name));
    const derivedMin = pharmacies[0]?.price ?? null;
    const derivedMax = pharmacies[pharmacies.length - 1]?.price ?? null;
    const info: PriceInfo = {
      min: derivedMin,
      max: derivedMax,
      count: pharmacies.length,
      pharmacies,
      source: "medusa", complete: true, stale: false,
      sourceDate: typeof data.source_date === "string" ? data.source_date : undefined,
      snapshotId: typeof data.snapshot_id === "string" ? data.snapshot_id : undefined,
      validUntil: typeof data.valid_until === "string" ? data.valid_until : undefined,
    };
    return info;
  } catch {
    return null;
  }
}

/** Fail-closed ownership check used before signing checkout prices. */
export async function validateMedusaProductVariants(
  pairs: Array<{ productId: string; variantId: string }>,
): Promise<boolean> {
  if (!MEDUSA_ON || pairs.length === 0 || pairs.length > 30) return false;
  if (pairs.some(({ productId, variantId }) => (
    !/^prod_[A-Za-z0-9]+$/.test(productId) || !/^variant_[A-Za-z0-9]+$/.test(variantId)
  ))) return false;
  const productIds = [...new Set(pairs.map((pair) => pair.productId))];
  try {
    const data = await mfetch("/store/products", {
      "id[]": productIds,
      sales_channel_id: SC,
      region_id: REG,
      fields: "id,variants.id",
      limit: productIds.length,
    }, {
      freshMs: 60_000,
      staleMs: 2 * 60_000,
      fallbackMs: 2 * 60_000,
      timeoutMs: 8_000,
      retries: 0,
      accept: (payload) => Array.isArray(payload?.products),
    });
    const variantsByProduct = new Map<string, Set<string>>(
      (data.products as Array<Record<string, unknown>>).map((product) => [
        String(product.id || ""),
        new Set((Array.isArray(product.variants) ? product.variants : []).map((variant) => (
          String((variant as Record<string, unknown>)?.id || "")
        ))),
      ]),
    );
    return pairs.every((pair) => variantsByProduct.get(pair.productId)?.has(pair.variantId) === true);
  } catch {
    return false;
  }
}

/** Реальные товары категории (по category_id, включая подкатегории) + реальный total `count`. */
export async function getMedusaCategoryProducts(categoryId: string, limit = 60, offset = 0): Promise<{ products: Product[]; count: number }> {
  const data = await mfetch("/store/products", {
    sales_channel_id: SC,
    region_id: REG,
    "category_id[]": categoryId,
    fields: PRODUCT_LIST_FIELDS,
    limit,
    offset,
  }, {
    freshMs: 2 * 60_000,
    staleMs: 30 * 60_000,
    fallbackMs: 24 * 60 * 60_000,
    timeoutMs: 6_000,
    persist: true,
    retries: 0,
  });
  return { products: (data.products || []).map((product: any) => mapProduct(product)), count: Number(data.count ?? 0) };
}

/** Узел дерева, схлопывая «проходные» уровни из единственного ребёнка. */
function mapNode(c: any, depth: number): CatNode {
  let kids: any[] = Array.isArray(c?.category_children) ? c.category_children : [];
  while (kids.length === 1 && Array.isArray(kids[0]?.category_children) && kids[0].category_children.length) {
    kids = kids[0].category_children;
  }
  return {
    id: c.id,
    name: c.name,
    handle: c.handle,
    children: depth > 0 ? kids.map((k) => mapNode(k, depth - 1)) : [],
  };
}

/** Реальное дерево категорий Medusa: корень «Сайт» → верхние категории → подкатегории. */
export async function getCategoryTree(): Promise<CatNode[]> {
  if (!MEDUSA_ON) return [];
  try {
    const data = await mfetch("/store/product-categories", {
      handle: "site",
      include_descendants_tree: "true",
      fields: "id,name,handle,*category_children",
    }, {
      freshMs: 10 * 60_000,
      staleMs: 24 * 60 * 60_000,
      fallbackMs: 72 * 60 * 60_000,
      timeoutMs: 6_000,
      persist: true,
      retries: 0,
      accept: (payload) => Array.isArray(payload?.product_categories) && payload.product_categories.length > 0,
    });
    const site = (data.product_categories || [])[0];
    const top: any[] = Array.isArray(site?.category_children) ? site.category_children : [];
    return top.map((c) => mapNode(c, 2)); // 3 уровня: верх → подкатегории → 3-й уровень
  } catch {
    return [];
  }
}
