import { MEDIA_CACHE_CONTROL, resolveMedusaStaticUrl } from "./medusa-media-proxy.ts";

type RemoteMediaMethod = "GET" | "HEAD";

function configuredRemoteOrigin(): string | null {
  const raw = String(process.env.CATALOG_PUBLIC_API_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function errorResponse(code: string, status: number, method: RemoteMediaMethod): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify({ error: code }), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
}

export async function proxyRemoteCatalogMedia(request: Request, method: RemoteMediaMethod): Promise<Response | null> {
  const origin = configuredRemoteOrigin();
  if (!origin) return null;

  const rawPath = new URL(request.url).searchParams.get("path") || "";
  if (!resolveMedusaStaticUrl(rawPath)) return errorResponse("invalid_media_path", 400, method);

  const url = new URL("/api/media/medusa", origin);
  url.searchParams.set("path", rawPath);

  try {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || (method === "GET" && !response.body)) {
      return errorResponse("media_upstream_" + response.status, response.status === 404 ? 404 : 502, method);
    }

    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return errorResponse("invalid_media_type", 502, method);

    const headers = new Headers({
      "cache-control": MEDIA_CACHE_CONTROL,
      "content-type": contentType,
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-length", "etag", "last-modified"] as const) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    const body = method === "HEAD" ? null : await response.arrayBuffer();
    return new Response(body, { status: 200, headers });
  } catch {
    return errorResponse("media_unavailable", 502, method);
  }
}
