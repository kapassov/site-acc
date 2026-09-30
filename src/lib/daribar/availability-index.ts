import type { DaribarV3Pharmacy } from "./product-search-v3.ts";

export type DaribarIndexedAvailability = {
  sku: string;
  inStock: boolean;
  minPrice: number | null;
  pharmacyCount: number;
  totalQuantity: number;
  checkedAt: string;
};

export type DaribarIndexedOffer = {
  sku: string;
  sourceCode: string;
  price: number;
  quantity: number;
  paymentOnSite?: boolean;
  paymentByCard?: boolean;
  withReserve?: boolean;
  openingHours?: string;
  checkedAt: string;
};

function money(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000_000
    ? Math.round(amount * 100) / 100
    : null;
}

function quantity(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount < 100_000_000
    ? Math.round(amount * 1_000) / 1_000
    : null;
}

/** Build an exact-SKU slice from reservable pharmacies mapped to our network. */
export function aggregateDaribarAvailability(
  requestedSkus: readonly string[],
  pharmacies: readonly DaribarV3Pharmacy[],
  mappedSourceCodes: ReadonlySet<string>,
  checkedAt = new Date().toISOString(),
): { products: DaribarIndexedAvailability[]; offers: DaribarIndexedOffer[] } {
  const requested = new Set(requestedSkus.map((sku) => sku.trim()).filter(Boolean));
  const offersByPair = new Map<string, DaribarIndexedOffer>();
  for (const pharmacy of pharmacies) {
    if (!mappedSourceCodes.has(pharmacy.sourceCode) || pharmacy.withReserve === false
        || (pharmacy.paymentByCard === false && pharmacy.paymentOnSite !== true)) continue;
    for (const product of pharmacy.products) {
      if (!requested.has(product.sku)) continue;
      const price = money(product.price);
      const available = quantity(product.quantity);
      if (price === null || available === null) continue;
      const key = `${product.sku}\u0000${pharmacy.sourceCode}`;
      const previous = offersByPair.get(key);
      const next = {
        sku: product.sku,
        sourceCode: pharmacy.sourceCode,
        price,
        quantity: available,
        ...(pharmacy.paymentOnSite !== undefined ? { paymentOnSite: pharmacy.paymentOnSite } : {}),
        ...(pharmacy.paymentByCard !== undefined ? { paymentByCard: pharmacy.paymentByCard } : {}),
        ...(pharmacy.withReserve !== undefined ? { withReserve: pharmacy.withReserve } : {}),
        ...(pharmacy.openingHours ? { openingHours: pharmacy.openingHours } : {}),
        checkedAt,
      };
      if (!previous) offersByPair.set(key, next);
      else {
        previous.price = Math.min(previous.price, next.price);
        previous.quantity = Math.max(previous.quantity, next.quantity);
      }
    }
  }

  const aggregates = new Map<string, { minPrice: number; pharmacyCount: number; totalQuantity: number }>();
  for (const offer of offersByPair.values()) {
    const previous = aggregates.get(offer.sku);
    if (!previous) {
      aggregates.set(offer.sku, {
        minPrice: offer.price,
        pharmacyCount: 1,
        totalQuantity: offer.quantity,
      });
    } else {
      previous.minPrice = Math.min(previous.minPrice, offer.price);
      previous.pharmacyCount += 1;
      previous.totalQuantity = Math.round((previous.totalQuantity + offer.quantity) * 1_000) / 1_000;
    }
  }

  return {
    products: [...requested].map((sku) => {
      const value = aggregates.get(sku);
      return value
        ? { sku, inStock: true, ...value, checkedAt }
        : { sku, inStock: false, minPrice: null, pharmacyCount: 0, totalQuantity: 0, checkedAt };
    }),
    offers: [...offersByPair.values()],
  };
}
