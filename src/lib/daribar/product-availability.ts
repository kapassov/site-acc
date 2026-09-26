import type { PharmacyStock } from "../pharmacy-stock.ts";
import type { DeliveryMappedPharmacy } from "./delivery-mapping.ts";
import type { DaribarV3Pharmacy } from "./product-search-v3.ts";

/** Display only orderable, exact-SKU ASS offers from the current Daribar response. */
export function daribarProductAvailabilityRows(
  live: DaribarV3Pharmacy[],
  mapped: Map<string, DeliveryMappedPharmacy>,
  sku: string,
  cashOnly = false,
): PharmacyStock[] {
  return live.flatMap((row) => {
    const local = mapped.get(row.sourceCode);
    const exact = row.products.find((product) => product.sku === sku);
    if (!local || !exact || exact.quantity < 1 || exact.price <= 0 || row.withReserve === false
        || (cashOnly ? row.paymentOnSite !== true : row.paymentByCard === false && row.paymentOnSite !== true)) return [];
    return [{
      sourceCode: local.id,
      name: row.name || local.name,
      city: local.city,
      address: row.address || local.address,
      lat: row.lat ?? local.lat,
      lon: row.lon ?? local.lon,
      hours: row.openingHours ?? local.hours,
      quantity: exact.quantity,
      price: exact.price,
      ...(row.paymentOnSite !== undefined ? { paymentOnSite: row.paymentOnSite } : {}),
      ...(row.paymentByCard !== undefined ? { paymentByCard: row.paymentByCard } : {}),
    }];
  }).sort((left, right) => (left.price ?? 0) - (right.price ?? 0)
    || left.name.localeCompare(right.name, "ru"));
}
