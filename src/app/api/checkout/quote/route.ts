import { NextResponse } from "next/server";
import { CheckoutQuoteError, createCheckoutQuote, type QuoteItem } from "@/lib/checkoutQuote";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const now = Date.now();
  if (!rateLimit(`checkout-quote:${clientIp(request)}`, 20, 60_000, now)) {
    return NextResponse.json({ error: "quote_rate_limited" }, { status: 429, headers: NO_STORE });
  }
  let body: Record<string, unknown> | null;
  try { body = await readBoundedJson<Record<string, unknown>>(request, 64 * 1024); }
  catch (error) { return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_quote" }, { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE }); }
  if (!body) return NextResponse.json({ error: "invalid_quote" }, { status: 400, headers: NO_STORE });
  if (Array.isArray(body.items) && body.items.length > 50) {
    return NextResponse.json({ error: "too_many_quote_items" }, { status: 413, headers: NO_STORE });
  }
  const fulfillment = body.fulfillment === "pickup" ? "pickup" : "pharmacy";
  try {
    const quote = await createCheckoutQuote({
      items: Array.isArray(body.items) ? body.items as QuoteItem[] : [],
      fulfillment,
      preferredPharmacy: body.preferredPharmacy && typeof body.preferredPharmacy === "object"
        ? body.preferredPharmacy as { id?: string; sourceCode?: string; address?: string; city?: string }
        : null,
      deliveryRequest: body.deliveryRequest && typeof body.deliveryRequest === "object"
        ? body.deliveryRequest as { mode: "city" | "pharmacy"; city: string; address: string; pharmacyId?: string }
        : null,
    });
    return NextResponse.json({ quote }, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof CheckoutQuoteError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "quote_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
