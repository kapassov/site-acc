// Daribar's product UUID is the only catalogue/commerce identity accepted by
// the storefront. Standard-N numeric IDs and legacy free-form SKUs must be
// mapped to this UUID before they can enter the active catalogue.
const DARIBAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRODUCT_PREFIX = "prod_Daribar";
const VARIANT_PREFIX = "variant_Daribar";
const SLUG_MARKER = "--d-";

export function isDaribarUuid(value: unknown): value is string {
  return typeof value === "string" && DARIBAR_UUID.test(value);
}

/** Compatibility name for Daribar API contracts whose field is named sku. */
export function isDaribarSku(value: unknown): value is string {
  return isDaribarUuid(value);
}

export function normalizeDaribarUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return DARIBAR_UUID.test(normalized) ? normalized : null;
}

function encodeSku(sku: string): string {
  const normalized = normalizeDaribarUuid(sku);
  if (!normalized) throw new TypeError("invalid_daribar_sku");
  return Buffer.from(normalized, "utf8").toString("base64url");
}

function decodeSku(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{2,160}$/.test(value)) return null;
  try {
    const sku = Buffer.from(value, "base64url").toString("utf8");
    return isDaribarSku(sku) && encodeSku(sku) === value ? sku : null;
  } catch {
    return null;
  }
}

export function daribarProductId(sku: string): string {
  return PRODUCT_PREFIX + encodeSku(sku);
}

export function daribarVariantId(sku: string): string {
  return VARIANT_PREFIX + encodeSku(sku);
}

export function daribarSkuFromProductId(value: unknown): string | null {
  const id = typeof value === "string" ? value : "";
  return id.startsWith(PRODUCT_PREFIX) ? decodeSku(id.slice(PRODUCT_PREFIX.length)) : null;
}

export function daribarSkuFromVariantId(value: unknown): string | null {
  const id = typeof value === "string" ? value : "";
  return id.startsWith(VARIANT_PREFIX) ? decodeSku(id.slice(VARIANT_PREFIX.length)) : null;
}

export function daribarSkuFromIds(productId: unknown, variantId: unknown): string | null {
  const productSku = daribarSkuFromProductId(productId);
  const variantSku = daribarSkuFromVariantId(variantId);
  return productSku && productSku === variantSku ? productSku : null;
}

function slugBase(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tovar";
}

export function daribarProductSlug(urlKey: string, sku: string): string {
  return `${slugBase(urlKey)}${SLUG_MARKER}${encodeSku(sku)}`;
}

export function daribarSkuFromSlug(value: unknown): string | null {
  const slug = typeof value === "string" ? value : "";
  const marker = slug.lastIndexOf(SLUG_MARKER);
  if (marker < 1) return null;
  return decodeSku(slug.slice(marker + SLUG_MARKER.length));
}
