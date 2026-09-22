import {
  daribarImageUrl,
  declaredImageMime,
  detectDaribarImageMime,
  isGenericBinaryMime,
} from "@/lib/daribar/images";
import { isDaribarEnabled } from "@/lib/daribar/config";
import { isDaribarSku } from "@/lib/daribar/ids";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8_000;
const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function errorResponse(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE });
}

async function readBoundedImage(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  if (!response.body) throw new Error("image_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("image_too_large");
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error("image_empty");
  const image = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return image;
}

export async function GET(request: Request): Promise<Response> {
  if (!isDaribarEnabled("images")) return errorResponse("daribar_images_disabled", 404);
  const sku = new URL(request.url).searchParams.get("sku") || "";
  if (!isDaribarSku(sku)) return errorResponse("invalid_sku", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const upstream = await fetch(daribarImageUrl(sku), {
      cache: "force-cache",
      redirect: "error",
      signal: controller.signal,
    });
    if (upstream.status === 404) return errorResponse("image_not_found", 404);
    if (!upstream.ok) return errorResponse("image_upstream_error", 502);

    const upstreamContentType = upstream.headers.get("content-type");
    const declaredMime = declaredImageMime(upstreamContentType);
    // Daribar's object storage currently serves valid WebP files as a generic
    // binary stream. Accept only that exact generic type, then require magic
    // bytes below before returning an image MIME to the browser.
    if (!declaredMime && !isGenericBinaryMime(upstreamContentType)) {
      return errorResponse("invalid_image_mime", 502);
    }
    const image = await readBoundedImage(upstream);
    const detectedMime = detectDaribarImageMime(image);
    if (!detectedMime || (declaredMime && detectedMime !== declaredMime)) {
      return errorResponse("invalid_image_content", 502);
    }

    const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "content-length": String(image.byteLength),
        "content-type": detectedMime,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return errorResponse("image_timeout", 504);
    }
    return errorResponse("image_unavailable", 502);
  } finally {
    clearTimeout(timer);
  }
}
