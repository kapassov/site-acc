import {
  daribarApiOrigin, daribarAuthApiOrigin, daribarCommerceApiOrigin,
  daribarOrderApiOrigin, daribarServiceToken,
} from "./config.ts";

type QueryValue = string | number | boolean | null | undefined;

export type DaribarRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Keep customer authentication on Daribar production while catalogue can use stage. */
  origin?: "default" | "auth" | "commerce" | "order";
  /** true/default uses the server-only service token; false is for public/user-auth calls. */
  auth?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue | QueryValue[]>;
  timeoutMs?: number;
  maxBytes?: number;
};

export class DaribarHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;
  readonly retryAfter?: number;
  readonly definitive: boolean;

  constructor(status: number, code: string, traceId?: string, retryAfter?: number, definitive = false) {
    super(code);
    this.name = "DaribarHttpError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.retryAfter = retryAfter;
    this.definitive = definitive;
  }
}

function safePath(path: string): string {
  const value = String(path || "").trim();
  if (!(value.startsWith("/api/") || value.startsWith("/public/api/"))
      || value.includes("\\")
      || value.includes("//")
      || value.includes("?")
      || value.includes("#")) {
    throw new DaribarHttpError(500, "invalid_daribar_path");
  }
  return value;
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value!))) : fallback;
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new DaribarHttpError(502, "daribar_response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new DaribarHttpError(502, "daribar_response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function errorCode(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  for (const key of ["code", "error"] as const) {
    const candidate = typeof value[key] === "string" ? value[key].trim() : "";
    if (candidate && /^[A-Za-z0-9_.:-]{1,100}$/.test(candidate)) return candidate;
  }
  return fallback;
}

function errorTraceId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = (payload as Record<string, unknown>).errorTraceID;
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9._:-]{6,160}$/.test(value) ? value : undefined;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value || value.length > 100) return undefined;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(3600, Math.max(1, Math.ceil(seconds)))
    : undefined;
}

export async function daribarJson<T = unknown>(
  path: string,
  options: DaribarRequestOptions = {},
): Promise<T> {
  const origin = options.origin === "auth" ? daribarAuthApiOrigin()
    : options.origin === "commerce" ? daribarCommerceApiOrigin()
      : options.origin === "order" ? daribarOrderApiOrigin()
        : daribarApiOrigin();
  const url = new URL(safePath(path), origin);
  for (const [key, raw] of Object.entries(options.query || {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    }
  }

  const headers = new Headers({ accept: "application/json" });
  const useServiceToken = options.auth !== false;
  if (useServiceToken) {
    const token = daribarServiceToken();
    if (!token) throw new DaribarHttpError(503, "daribar_service_token_missing");
    headers.set("authorization", `Bearer ${token}`);
  }
  for (const [key, value] of Object.entries(options.headers || {})) {
    if (/^(host|cookie|content-length)$/i.test(key)) continue;
    headers.set(key, value);
  }
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const timeoutMs = boundedInt(options.timeoutMs, 15_000, 1_000, 30_000);
  const maxBytes = boundedInt(options.maxBytes, 5 * 1024 * 1024, 1_024, 12 * 1024 * 1024);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const text = await boundedText(response, maxBytes);
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        // Reverse proxies can return HTML on 429/503. Preserve that status,
        // but never return their body or mistake the error for valid JSON.
        if (response.ok) throw new DaribarHttpError(502, "daribar_invalid_json");
      }
    }
    if (!response.ok) {
      throw new DaribarHttpError(
        response.status,
        errorCode(payload, `daribar_http_${response.status}`),
        errorTraceId(payload),
        retryAfterSeconds(response.headers.get("retry-after")),
        response.status >= 400 && response.status < 500,
      );
    }
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).status === "error") {
      throw new DaribarHttpError(
        502,
        errorCode(payload, "daribar_upstream_error"),
        errorTraceId(payload),
        undefined,
        true,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DaribarHttpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DaribarHttpError(504, "daribar_timeout");
    }
    throw new DaribarHttpError(502, "daribar_unavailable");
  } finally {
    clearTimeout(timer);
  }
}
