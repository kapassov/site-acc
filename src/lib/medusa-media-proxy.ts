const DEFAULT_MEDUSA_URL = "http://78.140.246.238:9000";

export const MEDIA_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
export const MEDIA_TIMEOUT_MS = 12_000;

const MAX_PATH_LENGTH = 4_096;
const SAFE_MEDIA_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/jxl",
  "image/png",
  "image/tiff",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

type ProxyMethod = "GET" | "HEAD";

type ProxyOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function errorResponse(code: string, status: number, method: ProxyMethod): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function hasUnsafePathEncoding(path: string): boolean {
  let candidate = path;
  for (let pass = 0; pass < 3; pass += 1) {
    if (candidate.includes("\\") || candidate.includes("\0") || /[\u0000-\u001f\u007f]/.test(candidate)) {
      return true;
    }
    const pathname = candidate.split(/[?#]/, 1)[0];
    if (pathname.split("/").some((segment) => segment === "." || segment === "..")) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return candidate.includes("\\") || candidate.split(/[?#]/, 1)[0]
    .split("/")
    .some((segment) => segment === "." || segment === "..");
}

export function resolveMedusaStaticUrl(rawPath: string, baseUrl = DEFAULT_MEDUSA_URL): URL | null {
  if (!rawPath.startsWith("/static/") || rawPath.length > MAX_PATH_LENGTH || hasUnsafePathEncoding(rawPath)) {
    return null;
  }

  try {
    const backend = new URL(baseUrl);
    if ((backend.protocol !== "http:" && backend.protocol !== "https:") || backend.username || backend.password) {
      return null;
    }

    const queryIndex = rawPath.search(/[?#]/);
    const pathOnly = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
    const upstream = new URL(pathOnly, backend);
    upstream.search = "";
    upstream.hash = "";

    if (upstream.origin !== backend.origin || !upstream.pathname.startsWith("/static/")) {
      return null;
    }
    return upstream;
  } catch {
    return null;
  }
}

function safeResponseHeaders(upstreamHeaders: Headers, contentType: string): Headers {
  const headers = new Headers({
    "cache-control": MEDIA_CACHE_CONTROL,
    "content-type": contentType,
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });

  const contentLength = upstreamHeaders.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number.isSafeInteger(Number(contentLength))) {
    headers.set("content-length", contentLength);
  }
  for (const name of ["etag", "last-modified"] as const) {
    const value = upstreamHeaders.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function proxyMedusaMedia(
  request: Request,
  method: ProxyMethod,
  options: ProxyOptions = {},
): Promise<Response> {
  const rawPath = new URL(request.url).searchParams.get("path") || "";
  const upstream = resolveMedusaStaticUrl(rawPath, options.baseUrl ?? process.env.MEDUSA_URL ?? DEFAULT_MEDUSA_URL);
  if (!upstream) return errorResponse("invalid_media_path", 400, method);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? MEDIA_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(upstream, {
      method,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    });

    if (response.status >= 300 && response.status < 400) {
      return errorResponse("media_redirect_rejected", 502, method);
    }
    if (!response.ok || (method === "GET" && !response.body)) {
      return errorResponse("media_unavailable", response.status === 404 ? 404 : 502, method);
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!SAFE_MEDIA_TYPES.has(contentType)) {
      return errorResponse("invalid_media_type", 502, method);
    }

    return new Response(method === "HEAD" ? null : response.body, {
      status: 200,
      headers: safeResponseHeaders(response.headers, contentType),
    });
  } catch {
    return errorResponse(controller.signal.aborted ? "media_timeout" : "media_unavailable", controller.signal.aborted ? 504 : 502, method);
  } finally {
    clearTimeout(timeout);
  }
}