export const MAX_CART_SYNC_ITEMS = 100;

export class CartSyncInputError extends Error {
  constructor(message = "invalid_cart_items") {
    super(message);
    this.name = "CartSyncInputError";
  }
}

export function normalizeCartSyncItems(
  raw: unknown,
): { variantId: string; quantity: number }[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_CART_SYNC_ITEMS) {
    throw new CartSyncInputError("too_many_cart_items");
  }

  const normalized = new Map<string, number>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const variantId = String(value.variantId || "");
    if (!/^variant_[A-Za-z0-9]+$/.test(variantId)) continue;
    const quantity = Math.max(0, Math.min(99, Math.round(Number(value.quantity) || 0)));
    if (quantity > 0) normalized.set(variantId, quantity);
  }

  if (normalized.size > MAX_CART_SYNC_ITEMS) {
    throw new CartSyncInputError("too_many_cart_items");
  }
  return [...normalized].map(([variantId, quantity]) => ({
    variantId,
    quantity,
  }));
}
