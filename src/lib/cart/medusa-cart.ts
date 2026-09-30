import { checkoutItemSource } from "../checkoutItems.ts";

export type CartCatalogProvider = "medusa" | "daribar";

/** Persist only native Medusa identities. Never guess a replacement for a Daribar SKU. */
export function validMedusaCartItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as { product?: { id?: unknown; variantId?: unknown; source?: unknown }; qty?: unknown };
  return item.product?.source === "medusa"
    && typeof item.product.id === "string"
    && typeof item.product.variantId === "string"
    && checkoutItemSource({ productId: item.product.id, variantId: item.product.variantId }) === "medusa"
    && Number.isSafeInteger(item.qty) && Number(item.qty) >= 1 && Number(item.qty) <= 99;
}

export function validDaribarCartItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as { product?: { id?: unknown; variantId?: unknown; source?: unknown; sku?: unknown }; qty?: unknown };
  return item.product?.source === "daribar"
    && typeof item.product.id === "string"
    && typeof item.product.variantId === "string"
    && typeof item.product.sku === "string"
    && checkoutItemSource({ productId: item.product.id, variantId: item.product.variantId }) === "daribar"
    && Number.isSafeInteger(item.qty) && Number(item.qty) >= 1 && Number(item.qty) <= 99;
}

export function validCartItemForProvider(value: unknown, provider: CartCatalogProvider): boolean {
  return provider === "daribar" ? validDaribarCartItem(value) : validMedusaCartItem(value);
}

export function boundedCartQuantity(value: number): number {
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(99, value)) : 0;
}
