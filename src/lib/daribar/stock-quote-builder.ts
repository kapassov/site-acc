import { createHash, randomBytes } from "node:crypto";
import type { StandardNQuote } from "../standardn-commerce.ts";
import type { DeliveryMappedItem, DeliveryMappedPharmacy } from "./delivery-mapping.ts";
import type { DaribarV3Pharmacy } from "./product-search-v3.ts";
import { daribarSkuFromIds } from "./ids.ts";

/** Pure conversion of one complete Daribar pharmacy response into a signed-quote payload. */
export function buildDaribarStockQuote(
  row: DaribarV3Pharmacy,
  pharmacy: DeliveryMappedPharmacy,
  mappings: DeliveryMappedItem[],
  now = Date.now(),
): StandardNQuote | null {
  const products = new Map(row.products.map((product) => [product.sku, product]));
  const nativeDaribar = mappings.every((mapping) => daribarSkuFromIds(mapping.productId, mapping.variantId) === mapping.sku);
  let subtotal = 0;
  const lines = mappings.flatMap((mapping) => {
    const product = products.get(mapping.sku);
    // Native Daribar carts take both quantity and the current pharmacy price
    // from the same live response. Legacy carts retain their Medusa sell price.
    const unitPrice = nativeDaribar ? product?.price : mapping.unitPrice;
    if (!product || product.quantity < mapping.quantity || !unitPrice || unitPrice <= 0) return [];
    const total = unitPrice * mapping.quantity;
    if (!Number.isSafeInteger(total) || total <= 0) return [];
    subtotal += total;
    return [{
      productId: mapping.productId,
      variantId: mapping.variantId,
      quantity: mapping.quantity,
      wareId: mapping.wareId,
      availableQuantity: product.quantity,
      unitPrice,
      total,
    }];
  });
  if (lines.length !== mappings.length || !Number.isSafeInteger(subtotal) || subtotal <= 0) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify({ sourceCode: row.sourceCode, lines, now })).digest("hex");
  return {
    quoteToken: `daribar_${randomBytes(24).toString("base64url")}`,
    snapshotId: `daribar-v3-${fingerprint}`,
    expiresAt: new Date(now + 3 * 60_000).toISOString(),
    currency: "KZT",
    subtotal,
    total: subtotal,
    pharmacy: { id: pharmacy.id, name: pharmacy.name, city: pharmacy.city, address: pharmacy.address },
    lines,
    adjustments: [],
  };
}
