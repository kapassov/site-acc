export type DeliveryChoiceQuote = {
  total: number;
  subtotal: number;
  pharmacy: { id: string } | null;
  delivery?: { price: number; eta: number; provider: string };
};

export type DeliveryChoiceComparison = {
  savings: number;
  isCheaper: boolean;
  changesPharmacy: boolean;
};

export function compareDeliveryChoices(
  current: DeliveryChoiceQuote,
  candidate: DeliveryChoiceQuote,
): DeliveryChoiceComparison {
  const rawSavings = Number(current.total) - Number(candidate.total);
  const savings = Number.isFinite(rawSavings) ? Math.max(0, Math.round(rawSavings * 100) / 100) : 0;
  return {
    savings,
    isCheaper: savings > 0,
    changesPharmacy: Boolean(
      current.pharmacy?.id
      && candidate.pharmacy?.id
      && current.pharmacy.id !== candidate.pharmacy.id,
    ),
  };
}
