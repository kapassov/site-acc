import { daribarImageOrigin } from "./config.ts";
import { isDaribarSku } from "./ids.ts";

export type DaribarImageMime = "image/webp" | "image/jpeg" | "image/png";

export function daribarImageUrl(sku: string): URL {
  if (!isDaribarSku(sku)) throw new TypeError("invalid_daribar_sku");
  return new URL(
    `optimized_v4_img_small_${encodeURIComponent(sku)}.webp`,
    daribarImageOrigin(),
  );
}

export function detectDaribarImageMime(bytes: Uint8Array): DaribarImageMime | null {
  if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

export function declaredImageMime(value: string | null): DaribarImageMime | null {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (mime === "image/webp" || mime === "image/jpeg" || mime === "image/png") return mime;
  if (mime === "image/jpg") return "image/jpeg";
  return null;
}

export function isGenericBinaryMime(value: string | null): boolean {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/octet-stream" || mime === "binary/octet-stream";
}
