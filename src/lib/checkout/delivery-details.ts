export const DELIVERY_PLACE_TYPES = ["apartment", "house", "office"] as const;

export type DeliveryPlaceType = typeof DELIVERY_PLACE_TYPES[number];

export type DeliveryDetails = {
  placeType: DeliveryPlaceType;
  unit: string;
  entrance: string;
  floor: string;
  intercom: string;
  instructions: string;
  leaveAtDoor: boolean;
};

export const EMPTY_DELIVERY_DETAILS: DeliveryDetails = {
  placeType: "apartment",
  unit: "",
  entrance: "",
  floor: "",
  intercom: "",
  instructions: "",
  leaveAtDoor: false,
};

const cleanText = (value: unknown, maxLength: number): string => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
  : "";

export function normalizeDeliveryDetails(value: unknown): DeliveryDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const placeType = DELIVERY_PLACE_TYPES.includes(input.placeType as DeliveryPlaceType)
    ? input.placeType as DeliveryPlaceType
    : null;
  if (!placeType || typeof input.leaveAtDoor !== "boolean") return null;
  return {
    placeType,
    unit: cleanText(input.unit, 30),
    entrance: cleanText(input.entrance, 30),
    floor: cleanText(input.floor, 20),
    intercom: cleanText(input.intercom, 40),
    instructions: cleanText(input.instructions, 240),
    leaveAtDoor: input.leaveAtDoor,
  };
}

export function deliveryDetailsComment(details: DeliveryDetails | null, fallbackComment = ""): string {
  const fallback = cleanText(fallbackComment, 500);
  if (!details) return fallback;
  const place = details.placeType === "house" ? "частный дом" : details.placeType === "office" ? "офис" : "квартира";
  const parts = [
    `Тип адреса: ${place}`,
    details.unit ? `${details.placeType === "office" ? "Офис" : "Квартира"}: ${details.unit}` : "",
    details.entrance ? `Подъезд/вход: ${details.entrance}` : "",
    details.floor ? `Этаж: ${details.floor}` : "",
    details.intercom ? `Домофон/код: ${details.intercom}` : "",
    details.instructions ? `Как найти вход: ${details.instructions}` : "",
    details.leaveAtDoor ? "Бесконтактная доставка: оставить у двери" : "",
    fallback ? `Комментарий к заказу: ${fallback}` : "",
  ].filter(Boolean);
  return parts.join("; ").slice(0, 500);
}
