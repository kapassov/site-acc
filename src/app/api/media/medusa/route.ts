import { proxyMedusaMedia } from "../../../../lib/medusa-media-proxy.ts";
import { proxyRemoteCatalogMedia } from "../../../../lib/remote-media.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const remote = await proxyRemoteCatalogMedia(request, "GET");
  if (remote) return remote;
  return proxyMedusaMedia(request, "GET");
}

export async function HEAD(request: Request): Promise<Response> {
  const remote = await proxyRemoteCatalogMedia(request, "HEAD");
  if (remote) return remote;
  return proxyMedusaMedia(request, "HEAD");
}