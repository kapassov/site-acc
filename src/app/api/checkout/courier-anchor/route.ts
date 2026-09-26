import { NextResponse } from "next/server";
import { CheckoutQuoteError, createCourierAnchorQuote, type QuoteItem } from "@/lib/checkoutQuote";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { canonicalizeCheckoutItems, detectCheckoutItemsSource } from "@/lib/checkoutItems";
import { storefrontCheckoutSource } from "@/lib/catalog-provider";
import { checkoutHasPrescription } from "@/lib/checkout/prescription-policy";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!rateLimit(`courier-anchor:${clientIp(request)}`, 20, 60_000, Date.now())) {
    return NextResponse.json({ error: "quote_rate_limited" }, { status: 429, headers: NO_STORE });
  }
  let body: Record<string, unknown> | null;
  try {
    body = await readBoundedJson<Record<string, unknown>>(request, 64 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyError ? error.code : "invalid_quote" },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE },
    );
  }
  if (!body || !Array.isArray(body.items) || body.items.length > 50) {
    return NextResponse.json({ error: "invalid_quote_items" }, { status: 400, headers: NO_STORE });
  }
  const items = canonicalizeCheckoutItems(body.items);
  if (!items) return NextResponse.json({ error: "invalid_quote_items" }, { status: 400, headers: NO_STORE });
  if (detectCheckoutItemsSource(items) !== storefrontCheckoutSource()) {
    return NextResponse.json({ error: "stale_cart" }, { status: 409, headers: NO_STORE });
  }
  try {
    if (await checkoutHasPrescription(items)) {
      return NextResponse.json({ error: "prescription_pickup_cash_only" }, { status: 409, headers: NO_STORE });
    }
    const quote = await createCourierAnchorQuote({
      items: items as QuoteItem[],
      city: typeof body.city === "string" ? body.city : "",
    });
    return NextResponse.json({ quote }, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof CheckoutQuoteError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    }
    console.error("[checkout/courier-anchor] quote unavailable", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 100) : "unknown",
    });
    return NextResponse.json({ error: "quote_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
