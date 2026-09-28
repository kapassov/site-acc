import type { Product } from "../types.ts";
import {
  mappedDaribarPharmacies,
  type DeliveryMappedPharmacy,
} from "./delivery-mapping.ts";
import {
  searchAllDaribarProductsV3,
  type DaribarV3Pharmacy,
} from "./product-search-v3.ts";

const MAX_ITEMS_PER_REQUEST = 30;
const STOCK_TTL_MS = 60_000;

export type DaribarLiveCatalogResult = {
  products: Product[];
  complete: boolean;
  authoritative: boolean;
  checkedAt: string;
};

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

/** Replace aggregate stock with current exact-SKU stock from mapped ASS pharmacies. */
export function applyDaribarLiveCatalogStock(
  products: Product[],
  live: DaribarV3Pharmacy[],
  mapped: Map<string, DeliveryMappedPharmacy>,
  checkedAt = new Date().toISOString(),
): Product[] {
  const offers = new Map<string, { price: number; pharmacies: Set<string> }>();
  for (const pharmacy of live) {
    if (!mapped.has(pharmacy.sourceCode) || pharmacy.withReserve === false
        || (pharmacy.paymentByCard === false && pharmacy.paymentOnSite !== true)) continue;
    for (const product of pharmacy.products) {
      if (product.quantity < 1 || product.price <= 0) continue;
      const previous = offers.get(product.sku);
      if (!previous) {
        offers.set(product.sku, { price: product.price, pharmacies: new Set([pharmacy.sourceCode]) });
      } else {
        previous.price = Math.min(previous.price, product.price);
        previous.pharmacies.add(pharmacy.sourceCode);
      }
    }
  }
  const validUntil = new Date(new Date(checkedAt).getTime() + STOCK_TTL_MS).toISOString();
  return products.map((product) => {
    const offer = product.sku ? offers.get(product.sku) : undefined;
    if (!offer) {
      return {
        ...product,
        inStock: false,
        stockPharmacies: 0,
        stockSourceDate: checkedAt,
        stockValidUntil: validUntil,
        stockStale: false,
      };
    }
    return {
      ...product,
      price: offer.price,
      priceTBD: false,
      inStock: true,
      stockPharmacies: offer.pharmacies.size,
      stockSourceDate: checkedAt,
      stockValidUntil: validUntil,
      stockStale: false,
      variants: product.variants?.map((variant) => ({ ...variant, price: offer.price })),
    };
  });
}

/** Live stock is page-bounded; checkout independently performs a fresh basket quote. */
export async function hydrateDaribarCatalogPageStock(
  products: Product[],
  city: string,
): Promise<DaribarLiveCatalogResult> {
  const checkedAt = new Date().toISOString();
  // Unit/offline catalogue projection has no pharmacy mapping authority. The
  // production Daribar cutover requires PostgreSQL and is guarded by readiness.
  if (!String(process.env.DATABASE_URL || "").trim()) {
    return { products, complete: true, authoritative: false, checkedAt };
  }
  const unique = [...new Map(products
    .filter((product) => product.sku)
    .map((product) => [product.sku!, product])).values()];
  if (!unique.length) return { products, complete: true, authoritative: true, checkedAt };
  try {
    const [mapped, batches] = await Promise.all([
      mappedDaribarPharmacies(city),
      Promise.all(chunks(unique, MAX_ITEMS_PER_REQUEST).map((batch) => searchAllDaribarProductsV3({
        city,
        items: batch.map((product) => ({ sku: product.sku!, countDesired: 1 })),
        availability: "partial",
        replacements: false,
        enableOnSite: true,
      }))),
    ]);
    return {
      products: applyDaribarLiveCatalogStock(products, batches.flat(), mapped, checkedAt),
      complete: true,
      authoritative: true,
      checkedAt,
    };
  } catch {
    return {
      products: products.map((product) => ({ ...product, stockStale: true })),
      complete: false,
      authoritative: false,
      checkedAt,
    };
  }
}
