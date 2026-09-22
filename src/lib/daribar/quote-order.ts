import type { CanonicalCheckoutItem } from "../checkoutItems.ts";
import type { SignedQuote } from "../checkoutQuote.ts";
import type { DeliveryDetails } from "../checkout/delivery-details.ts";
import {
  buildDaribarOrderPayload, createDaribarOrder,
  DaribarCheckoutError, type DaribarOrderResult,
} from "./checkout.ts";
import { mapLocalPharmacyToDaribar, mapQuoteLinesToDaribar } from "./delivery-mapping.ts";

type Input = {
  quote: SignedQuote; items: CanonicalCheckoutItem[]; accessToken: string; phone: string;
  delivery: "courier" | "pickup"; payment: "card" | "cash";
  city: string; address: string; comment?: string; channel?: "web" | "mobile_app";
  deliveryDetails?: DeliveryDetails | null;
};

export async function createDaribarOrderForQuote(input: Input): Promise<DaribarOrderResult> {
  const { quote } = input;
  let sourceCode = "";
  let mapped: Array<{ sku: string; countDesired: number; pharmacyCount: number }>;
  if (input.delivery === "courier") {
    if (!quote.delivery || quote.delivery.pharmacyId !== quote.pharmacy.id) throw new DaribarCheckoutError(409, "invalid_delivery_quote");
    sourceCode = quote.delivery.daribarSourceCode;
    mapped = quote.delivery.orderItems;
  } else {
    const pharmacy = await mapLocalPharmacyToDaribar(quote.pharmacy.id);
    sourceCode = pharmacy.sourceCode;
    const skuLines = await mapQuoteLinesToDaribar(quote.lines);
    mapped = skuLines.map((item, index) => ({
      sku: item.sku,
      countDesired: item.countDesired,
      pharmacyCount: quote.lines[index]?.availableQuantity || 0,
    }));
  }
  if (mapped.length !== input.items.length || quote.lines.length !== input.items.length) {
    throw new DaribarCheckoutError(409, "invalid_delivery_quote");
  }
  const offer = {
    sourceCode,
    pharmacy: { city: quote.pharmacy.city },
    lines: mapped.map(item => ({ sku: item.sku, quantity: item.countDesired, availableQuantity: item.pharmacyCount })),
  };
  const payload = buildDaribarOrderPayload({
    offer, phone: input.phone, delivery: input.delivery, payment: input.payment,
    city: input.city, address: input.address, comment: input.comment, channel: input.channel,
    deliveryDetails: input.deliveryDetails,
    ...(quote.delivery ? { deliveryQuote: quote.delivery } : {}),
  });
  // Always return the provider order first. The route persists it before it
  // validates the hosted payment link, so a missing link cannot orphan a real
  // Daribar order or invite the customer to create a duplicate.
  return createDaribarOrder(input.accessToken, payload);
}
