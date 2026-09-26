import type { SignedQuote } from "./checkoutQuote.ts";
import type { StandardNQuote } from "./standardn-commerce.ts";

/** A live lookup may find more stock, but never silently change SKU, pharmacy or price. */
export function checkoutStockStillMatches(signed: SignedQuote, live: StandardNQuote): boolean {
  if (signed.pharmacy.id !== live.pharmacy.id || signed.currency !== live.currency
      || signed.total !== live.total || signed.lines.length !== live.lines.length) return false;
  const current = new Map(live.lines.map((line) => [line.variantId, line]));
  return signed.lines.every((line) => {
    const fresh = current.get(line.variantId);
    return Boolean(fresh && fresh.productId === line.productId && fresh.wareId === line.wareId
      && fresh.quantity === line.quantity && fresh.availableQuantity >= line.quantity
      && fresh.unitPrice === line.unitPrice && fresh.total === line.total);
  });
}
