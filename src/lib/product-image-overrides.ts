import overrides from "./product-image-overrides.json" with { type: "json" };

const productImageOverrides = overrides as Record<string, string>;

export function productImageFallback(productId: string): string | undefined {
  return productImageOverrides[String(productId || "").trim()] || undefined;
}
