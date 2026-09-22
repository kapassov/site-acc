import type { StandardNQuote } from "./standardn-commerce.ts";
import {
  bestDeliveryInCity, deliveryDestinationHash, deliveryForPharmacy, DaribarDeliveryError,
  type DaribarDeliveryMode, type DaribarDeliveryOffer,
} from "./daribar/delivery.ts";
import {
  mapDaribarPharmacyToLocal, mapLocalPharmacyToDaribar, mapQuoteLinesToDaribar,
  type DeliveryMappedPharmacy,
} from "./daribar/delivery-mapping.ts";
import { DaribarAvailabilityError, getDaribarExactPharmacyStock } from "./daribar/availability.ts";

export type CheckoutDeliveryRequest = { mode: DaribarDeliveryMode; city: string; address: string; pharmacyId?: string };
export type CheckoutDeliveryQuote = {
  mode: DaribarDeliveryMode; provider: "yandex" | "choco" | "wolt";
  deliveryType: "on_demand" | "pedestrian" | "slot";
  price: number; itemsPrice: number;
  orderItems: Array<{ sku: string; countDesired: number; pharmacyCount: number }>;
  eta: number; distance: number; daribarSourceCode: string; pharmacyId: string;
  destinationHash: string; quotedAt: string;
};

async function verifyCurrentDaribarStock(offer: DaribarDeliveryOffer, city: string): Promise<void> {
  try {
    await getDaribarExactPharmacyStock({
      sourceCode: offer.pharmacy.code,
      city,
      items: offer.orderItems.map((item) => ({ sku: item.sku, quantity: item.countDesired })),
    });
  } catch (error) {
    if (error instanceof DaribarAvailabilityError) {
      throw new DaribarDeliveryError(error.status === 409 ? 409 : 503,
        error.status === 409 ? "selected_pharmacy_unavailable" : "delivery_service_unavailable");
    }
    throw error;
  }
}

export async function resolveCheckoutDelivery(
  quote: StandardNQuote,
  request: CheckoutDeliveryRequest,
): Promise<{ delivery: CheckoutDeliveryQuote; pharmacy: DeliveryMappedPharmacy; alternatives: DaribarDeliveryOffer[] }> {
  if (!request || !["city", "pharmacy"].includes(request.mode)) throw new DaribarDeliveryError(400, "invalid_delivery_mode");
  const city = String(request.city || "").normalize("NFKC").trim().slice(0, 100);
  const address = String(request.address || "").normalize("NFKC").trim().slice(0, 500);
  if (!city || !address || !/\d/.test(address)) throw new DaribarDeliveryError(400, "delivery_destination_required");
  const mappedItems = await mapQuoteLinesToDaribar(quote.lines);
  const destination = { address: `${city}, ${address}` };
  let offer: DaribarDeliveryOffer, alternatives: DaribarDeliveryOffer[] = [], pharmacy: DeliveryMappedPharmacy;
  if (request.mode === "pharmacy") {
    pharmacy = await mapLocalPharmacyToDaribar(request.pharmacyId || quote.pharmacy.id);
    offer = await deliveryForPharmacy({ sourceCode: pharmacy.sourceCode, items: mappedItems, destination });
  } else {
    const baseline = await mapLocalPharmacyToDaribar(request.pharmacyId || quote.pharmacy.id);
    const resolved = await bestDeliveryInCity({ city, items: mappedItems, destination, sourceCode: baseline.sourceCode });
    const mappedOffers: Array<{ offer: DaribarDeliveryOffer; pharmacy: DeliveryMappedPharmacy }> = [];
    for (const candidate of [resolved.best, ...resolved.alternatives]) {
      try {
        const local = candidate.pharmacy.code === baseline.sourceCode
          ? baseline : await mapDaribarPharmacyToLocal(candidate.pharmacy.code);
        mappedOffers.push({ offer: candidate, pharmacy: local });
      } catch (error) {
        if (!(error instanceof DaribarDeliveryError) || error.code !== "delivery_pharmacy_mapping_missing") throw error;
      }
    }
    if (!mappedOffers.length) throw new DaribarDeliveryError(409, "no_delivery_available");
    ({ offer, pharmacy } = mappedOffers[0]);
    alternatives = mappedOffers.slice(1).map(value => value.offer);
  }
  await verifyCurrentDaribarStock(offer, city);
  const best = offer.bestDelivery;
  return {
    pharmacy, alternatives,
    delivery: {
      mode: request.mode, provider: best.provider, deliveryType: best.deliveryType,
      price: best.price, itemsPrice: quote.subtotal, orderItems: offer.orderItems,
      eta: best.eta, distance: best.distance, daribarSourceCode: offer.pharmacy.code,
      pharmacyId: pharmacy.id, destinationHash: deliveryDestinationHash(city, address),
      quotedAt: new Date().toISOString(),
    },
  };
}
