import type { CanonicalCheckoutItem } from "../checkoutItems.ts";
import { detectCheckoutItemsSource } from "../checkoutItems.ts";
import { daribarSkuFromIds } from "../daribar/ids.ts";
import { readDaribarCatalogPrescriptionFlags } from "../daribar/catalog-db.ts";
import { medusaPrescription } from "../prescription.ts";
import { ordersDatabasePool } from "../orders/store.ts";

/** Fail closed when a product is absent from the current catalogue. */
export async function checkoutHasPrescription(items: CanonicalCheckoutItem[]): Promise<boolean> {
  const source = detectCheckoutItemsSource(items);
  if (source === "daribar") {
    const skus = items.map(({ productId, variantId }) => daribarSkuFromIds(productId, variantId));
    if (skus.some((sku) => !sku)) throw new Error("catalog_item_unavailable");
    const flags = await readDaribarCatalogPrescriptionFlags(skus as string[]);
    if (skus.some((sku) => !flags.has(sku!))) throw new Error("catalog_item_unavailable");
    return skus.some((sku) => flags.get(sku!) === true);
  }
  if (source === "medusa") {
    const db = await ordersDatabasePool();
    const result = await db.query<{ id: string; rx_otc: string | null }>(`
      SELECT id, rx_otc FROM catalog_products WHERE active AND id = ANY($1::text[])
    `, [items.map(({ productId }) => productId)]);
    const flags = new Map(result.rows.map((row) => [row.id, medusaPrescription(row.rx_otc)]));
    if (items.some(({ productId }) => !flags.has(productId))) throw new Error("catalog_item_unavailable");
    return items.some(({ productId }) => flags.get(productId) === true);
  }
  throw new Error("catalog_item_unavailable");
}

export function prescriptionCheckoutAllowed(
  hasPrescription: boolean,
  fulfillment: "pickup" | "pharmacy",
  paymentMethod: "cash" | "card",
): boolean {
  return !hasPrescription || (fulfillment === "pickup" && paymentMethod === "cash");
}
