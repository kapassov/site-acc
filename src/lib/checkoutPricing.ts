export type CheckoutFulfillment = "warehouse" | "pharmacy" | "pickup";

export type CheckoutPricingAdjustment = {
  type: "pharmacy_markup";
  rateBps: 1_200;
  amount: number;
} | {
  type: "delivery_fee";
  provider: "yandex" | "choco" | "wolt";
  amount: number;
};

export type CheckoutPricing = {
  subtotal: number;
  total: number;
  lineTotals: number[];
  adjustments: CheckoutPricingAdjustment[];
};

type CheckoutPricingLine = {
  unitPrice: number;
  quantity: number;
};

function assertSafePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field}_must_be_a_safe_positive_integer`);
  }
}

/**
 * Matches the former storefront rule exactly:
 * Math.round(subtotal * 1.12), calculated once for the whole basket.
 *
 * 12% is 3/25. Splitting the integer subtotal into quotient/remainder keeps
 * the rounding deterministic without multiplying a large subtotal first.
 */
function pharmacyMarkup(subtotal: number): number {
  const quotient = Math.floor(subtotal / 25);
  const remainder = subtotal % 25;
  return quotient * 3 + Math.round((remainder * 3) / 25);
}

export function basePricesForFulfillment(
  minimumPrices: number[],
  selectedPharmacyPrices: number[] | null,
  fulfillment: CheckoutFulfillment,
): number[] {
  return [...(fulfillment === "pickup" ? selectedPharmacyPrices ?? [] : minimumPrices)];
}

export function priceCheckoutLines(
  lines: CheckoutPricingLine[],
  fulfillment: CheckoutFulfillment,
): CheckoutPricing {
  if (lines.length === 0) throw new RangeError("checkout_lines_required");

  const lineTotals = lines.map((line) => {
    assertSafePositiveInteger(line.unitPrice, "unit_price");
    assertSafePositiveInteger(line.quantity, "quantity");
    const total = line.unitPrice * line.quantity;
    assertSafePositiveInteger(total, "line_total");
    return total;
  });
  const subtotal = lineTotals.reduce((sum, lineTotal) => sum + lineTotal, 0);
  assertSafePositiveInteger(subtotal, "subtotal");

  if (fulfillment !== "pharmacy") {
    return { subtotal, total: subtotal, lineTotals, adjustments: [] };
  }

  const amount = pharmacyMarkup(subtotal);
  const total = subtotal + amount;
  assertSafePositiveInteger(total, "total");
  return {
    subtotal,
    total,
    lineTotals,
    adjustments: [{ type: "pharmacy_markup", rateBps: 1_200, amount }],
  };
}
