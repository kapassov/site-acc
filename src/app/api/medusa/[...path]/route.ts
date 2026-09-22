import { NextResponse } from "next/server.js";
import { secureMedusaBaseUrl } from "../../../../lib/medusaUrl.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function configuredBaseUrl() {
  try {
    return secureMedusaBaseUrl(process.env.MEDUSA_URL);
  } catch {
    return null;
  }
}

const BASE = configuredBaseUrl();
const PK = process.env.MEDUSA_PUBLISHABLE_KEY || "";
const MAX_RESPONSE_BYTES = clampInt(
  process.env.MEDUSA_PROXY_MAX_RESPONSE_BYTES,
  12_000_000,
  1_024,
  64_000_000,
);
const GET_TIMEOUT_MS = clampInt(process.env.MEDUSA_PROXY_GET_TIMEOUT_MS, 9_000, 1_000, 30_000);
const MAX_CACHE_ENTRIES = clampInt(process.env.MEDUSA_PROXY_CACHE_ENTRIES, 160, 16, 1_000);
const GET_CONCURRENCY = clampInt(process.env.MEDUSA_PROXY_GET_CONCURRENCY, 6, 1, 32);
const MAX_GET_QUEUE = clampInt(process.env.MEDUSA_PROXY_GET_QUEUE, 32, 0, 256);
const GET_QUEUE_TIMEOUT_MS = clampInt(
  process.env.MEDUSA_PROXY_GET_QUEUE_TIMEOUT_MS,
  1_000,
  50,
  10_000,
);

type CachedResponse = {
  body: ArrayBuffer;
  contentType: string;
  status: number;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
};

type GetQueueWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ProxyRuntime = {
  getCache: Map<string, CachedResponse>;
  inFlight: Map<string, Promise<CachedResponse>>;
  activeGets: number;
  getQueue: GetQueueWaiter[];
};

const proxyRoot = globalThis as typeof globalThis & { __inkarMedusaProxyRuntime?: ProxyRuntime };
const proxyRuntime = proxyRoot.__inkarMedusaProxyRuntime ??= {
  getCache: new Map(),
  inFlight: new Map(),
  activeGets: 0,
  getQueue: [] as GetQueueWaiter[],
};

type RouteContext = { params: Promise<{ path: string[] }> };

class MedusaProxyOverloadedError extends Error {
  constructor() {
    super("Medusa proxy queue is full");
    this.name = "MedusaProxyOverloadedError";
  }
}

class UpstreamResponseTooLargeError extends Error {
  constructor() {
    super("Medusa response exceeds the proxy limit");
    this.name = "UpstreamResponseTooLargeError";
  }
}

function cachePolicy(path: string[]) {
  const joined = path.join("/");
  if (joined.includes("/pharmacies")) return { freshMs: 30_000, staleMs: 30 * 60_000 };
  if (joined.includes("product-categories")) return { freshMs: 10 * 60_000, staleMs: 72 * 60 * 60_000 };
  if (path.length > 2) return { freshMs: 2 * 60_000, staleMs: 24 * 60 * 60_000 };
  return { freshMs: 60_000, staleMs: 6 * 60 * 60_000 };
}

function cachedJson(entry: CachedResponse, state: "hit" | "stale" | "miss") {
  return new NextResponse(entry.body.slice(0), {
    status: entry.status,
    headers: {
      "content-type": entry.contentType,
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
      "x-medusa-cache": state,
    },
  });
}

function remember(key: string, entry: CachedResponse) {
  proxyRuntime.getCache.delete(key);
  proxyRuntime.getCache.set(key, entry);
  while (proxyRuntime.getCache.size > MAX_CACHE_ENTRIES) {
    const oldest = proxyRuntime.getCache.keys().next().value as string | undefined;
    if (!oldest) break;
    proxyRuntime.getCache.delete(oldest);
  }
}

function releaseGetSlot() {
  const next = proxyRuntime.getQueue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(createGetRelease());
    return;
  }
  proxyRuntime.activeGets = Math.max(0, proxyRuntime.activeGets - 1);
}

function createGetRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGetSlot();
  };
}

function acquireGetSlot(): Promise<() => void> {
  if (proxyRuntime.activeGets < GET_CONCURRENCY) {
    proxyRuntime.activeGets += 1;
    return Promise.resolve(createGetRelease());
  }
  if (proxyRuntime.getQueue.length >= MAX_GET_QUEUE) {
    return Promise.reject(new MedusaProxyOverloadedError());
  }
  return new Promise((resolve, reject) => {
    const waiter = {} as GetQueueWaiter;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.timer = setTimeout(() => {
      const index = proxyRuntime.getQueue.indexOf(waiter);
      if (index >= 0) proxyRuntime.getQueue.splice(index, 1);
      reject(new MedusaProxyOverloadedError());
    }, GET_QUEUE_TIMEOUT_MS);
    proxyRuntime.getQueue.push(waiter);
  });
}

function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function cancelQuietly(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  try {
    await stream.cancel();
  } catch {
    // The response is already being rejected; cancellation is best effort.
  }
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLarge: Error,
): Promise<ArrayBuffer> {
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the deterministic size error even if upstream cancellation fails.
        }
        throw tooLarge;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function readUpstreamBody(response: Response) {
  const declared = declaredContentLength(response.headers);
  if (declared !== null && declared > MAX_RESPONSE_BYTES) {
    await cancelQuietly(response.body);
    throw new UpstreamResponseTooLargeError();
  }
  return readBoundedStream(
    response.body,
    MAX_RESPONSE_BYTES,
    new UpstreamResponseTooLargeError(),
  );
}

async function loadGet(upstream: URL, headers: Headers, policy: ReturnType<typeof cachePolicy>) {
  const release = await acquireGetSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    const body = await readUpstreamBody(response);
    const now = Date.now();
    return {
      body,
      status: response.status,
      contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
      storedAt: now,
      freshUntil: now + policy.freshMs,
      staleUntil: now + policy.staleMs,
    } satisfies CachedResponse;
  } finally {
    clearTimeout(timeout);
    release();
  }
}

function overloadedResponse() {
  return NextResponse.json(
    { error: "medusa_overloaded" },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "1" } },
  );
}

async function forwardGet(upstream: URL, headers: Headers, path: string[]) {
  const key = upstream.toString();
  const now = Date.now();
  const cached = proxyRuntime.getCache.get(key);
  if (cached && cached.freshUntil > now) {
    remember(key, cached);
    return cachedJson(cached, "hit");
  }

  let pending = proxyRuntime.inFlight.get(key);
  if (!pending) {
    pending = loadGet(upstream, headers, cachePolicy(path));
    proxyRuntime.inFlight.set(key, pending);
  }

  try {
    const loaded = await pending;
    if (loaded.status >= 200 && loaded.status < 300) {
      remember(key, loaded);
      return cachedJson(loaded, "miss");
    }
    if (loaded.status >= 500 && cached && cached.staleUntil > now) return cachedJson(cached, "stale");
    return cachedJson(loaded, "miss");
  } catch (error) {
    if (cached && cached.staleUntil > now) return cachedJson(cached, "stale");
    if (error instanceof MedusaProxyOverloadedError) return overloadedResponse();
    if (error instanceof UpstreamResponseTooLargeError) {
      return NextResponse.json(
        { error: "medusa_response_too_large" },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "medusa_unavailable" },
      { status: 504, headers: { "cache-control": "no-store", "x-medusa-cache": "unavailable" } },
    );
  } finally {
    if (proxyRuntime.inFlight.get(key) === pending) proxyRuntime.inFlight.delete(key);
  }
}

function medusaNotConfigured() {
  return NextResponse.json(
    { error: "medusa_not_configured" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

async function forward(request: Request, context: RouteContext) {
  if (request.method !== "GET") return writeNotAllowed();
  if (!BASE || !PK) return medusaNotConfigured();

  const { path } = await context.params;
  if (!Array.isArray(path) || path.length === 0 || path[0] !== "store") {
    return NextResponse.json({ error: "invalid_medusa_path" }, { status: 400 });
  }

  const upstream = new URL(`/${path.map(encodeURIComponent).join("/")}`, `${BASE}/`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));

  const headers = new Headers({
    accept: request.headers.get("accept") || "application/json",
    "x-publishable-api-key": PK,
  });

  return forwardGet(upstream, headers, path);
}

// Native writes must pass the verified OTP identity, signed quote and durable
// idempotency guards of the dedicated checkout bridge, never this legacy proxy.
function writeNotAllowed() {
  return NextResponse.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { allow: "GET", "cache-control": "no-store" } },
  );
}

export const GET = forward;
export const POST = writeNotAllowed;
export const DELETE = writeNotAllowed;
