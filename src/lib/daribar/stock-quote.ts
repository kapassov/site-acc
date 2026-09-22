import type { CanonicalCheckoutItem } from "../checkoutItems.ts";
import type { StandardNQuote } from "../standardn-commerce.ts";
import {
  mapCheckoutItemsToDaribar, mapLocalPharmacyToDaribar, mappedDaribarPharmacies,
  type DeliveryMappedItem, type DeliveryMappedPharmacy,
} from "./delivery-mapping.ts";
import { DaribarDeliveryError } from "./delivery.ts";
import { DaribarV3SearchError, searchDaribarProductsV3, type DaribarV3Pharmacy } from "./product-search-v3.ts";
import { buildDaribarStockQuote } from "./stock-quote-builder.ts";

export class DaribarStockQuoteError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "DaribarStockQuoteError";
    this.status = status;
    this.code = code;
  }
}

export type DaribarStockQuote = { quote: StandardNQuote; pharmacy: DeliveryMappedPharmacy };

function safeCity(value: unknown): string {
  const city = typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 100) : "";
  if (!city || !/^[\p{L}\p{M} .'-]{1,100}$/u.test(city)) throw new DaribarStockQuoteError(400, "delivery_city_required");
  return city;
}

/** One basket call returns only mapped ASS pharmacies that can fulfil every line. */
export async function requestDaribarStockQuotes(input: {
  items: CanonicalCheckoutItem[];
  city: string;
  preferredPharmacyId?: string;
  limit?: number;
}): Promise<DaribarStockQuote[]> {
  const city = safeCity(input.city);
  let mappings: DeliveryMappedItem[];
  try {
    mappings = await mapCheckoutItemsToDaribar(input.items);
  } catch (error) {
    if (error instanceof DaribarDeliveryError) {
      throw new DaribarStockQuoteError(error.status, error.code === "delivery_product_mapping_missing"
        ? "cart_item_unavailable" : error.code);
    }
    throw error;
  }
  const items = mappings.map((mapping, index) => ({
    sku: mapping.sku,
    countDesired: mapping.quantity,
    priority: mappings.length - index,
  }));
  let preferred: DeliveryMappedPharmacy | undefined;
  try {
    preferred = input.preferredPharmacyId
      ? await mapLocalPharmacyToDaribar(input.preferredPharmacyId) : undefined;
  } catch (error) {
    if (error instanceof DaribarDeliveryError) throw new DaribarStockQuoteError(error.status, "selected_pharmacy_unavailable");
    throw error;
  }
  let rows: DaribarV3Pharmacy[];
  try {
    rows = await searchDaribarProductsV3({
      city,
      ...(preferred ? { sourceCode: preferred.sourceCode } : {}),
      items,
      availability: "full",
      replacements: false,
      enableOnSite: false,
      limit: Math.max(1, Math.min(1_000, input.limit || (preferred ? 1 : 100))),
    });
  } catch (error) {
    if (error instanceof DaribarV3SearchError) throw new DaribarStockQuoteError(error.status, error.code);
    throw error;
  }
  const pharmacies = await mappedDaribarPharmacies(city);
  const quotes = rows.flatMap((row) => {
    const pharmacy = pharmacies.get(row.sourceCode);
    if (!pharmacy || (preferred && pharmacy.id !== preferred.id)) return [];
    const quote = buildDaribarStockQuote(row, pharmacy, mappings);
    return quote ? [{ quote, pharmacy }] : [];
  });
  if (!quotes.length) throw new DaribarStockQuoteError(409,
    preferred ? "selected_pharmacy_unavailable" : "no_pharmacy_can_fulfill_cart");
  return quotes;
}

export async function requestDaribarStockQuote(input: {
  items: CanonicalCheckoutItem[];
  city: string;
  preferredPharmacyId?: string;
}): Promise<StandardNQuote> {
  return (await requestDaribarStockQuotes({ ...input, limit: input.preferredPharmacyId ? 1 : 100 }))[0].quote;
}
