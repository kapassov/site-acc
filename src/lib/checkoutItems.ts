export type CanonicalCheckoutItem = {
  productId: string;
  variantId: string;
  quantity: number;
};

export type CheckoutItemSource = "medusa" | "daribar";

const PRODUCT_ID = /^prod_[A-Za-z0-9]+$/;
const VARIANT_ID = /^variant_[A-Za-z0-9]+$/;
const DARIBAR_PRODUCT_ID = /^prod_Daribar([A-Za-z0-9_-]{2,160})$/;
const DARIBAR_VARIANT_ID = /^variant_Daribar([A-Za-z0-9_-]{2,160})$/;
const MAX_RAW_ITEMS = 50;
const MAX_QUANTITY_PER_VARIANT = 99;

/**
 * Classifies an already-normalized product/variant pair without trusting a
 * client-provided source flag. Daribar IDs carry the same base64url SKU in
 * both IDs; requiring an exact suffix match prevents cross-product variants.
 */
export function checkoutItemSource(item: Pick<CanonicalCheckoutItem, "productId" | "variantId">): CheckoutItemSource | null {
  const daribarProduct = item.productId.match(DARIBAR_PRODUCT_ID);
  const daribarVariant = item.variantId.match(DARIBAR_VARIANT_ID);
  if (daribarProduct || daribarVariant) {
    return daribarProduct && daribarVariant && daribarProduct[1] === daribarVariant[1]
      ? "daribar"
      : null;
  }
  return PRODUCT_ID.test(item.productId) && VARIANT_ID.test(item.variantId)
    ? "medusa"
    : null;
}

/** Returns one authoritative cart source, `mixed`, or null for invalid input. */
export function detectCheckoutItemsSource(
  items: Array<Pick<CanonicalCheckoutItem, "productId" | "variantId">>,
): CheckoutItemSource | "mixed" | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  let detected: CheckoutItemSource | null = null;
  for (const item of items) {
    const source = checkoutItemSource(item);
    if (!source) return null;
    if (detected && source !== detected) return "mixed";
    detected = source;
  }
  return detected;
}

/**
 * Produces the one item representation that both quote signing and order
 * creation must consume. Invalid or ambiguous quantities are rejected rather
 * than rounded/defaulted, and duplicate variant lines are merged before the
 * per-variant limit is enforced.
 */
export function canonicalizeCheckoutItems(raw: unknown): CanonicalCheckoutItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RAW_ITEMS) return null;

  const merged = new Map<string, CanonicalCheckoutItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const value = entry as Record<string, unknown>;
    const productId = String(value.productId ?? value.product_id ?? "").trim();
    const variantId = String(value.variantId ?? value.variant_id ?? "").trim();
    const quantity = value.quantity;
    if (!checkoutItemSource({ productId, variantId })
        || typeof quantity !== "number"
        || !Number.isSafeInteger(quantity)
        || quantity < 1
        || quantity > MAX_QUANTITY_PER_VARIANT) {
      return null;
    }

    const key = `${productId}:${variantId}`;
    const nextQuantity = (merged.get(key)?.quantity ?? 0) + quantity;
    if (nextQuantity > MAX_QUANTITY_PER_VARIANT) return null;
    merged.set(key, { productId, variantId, quantity: nextQuantity });
  }

  return [...merged.values()].sort((left, right) => (
    left.productId.localeCompare(right.productId)
      || left.variantId.localeCompare(right.variantId)
  ));
}
