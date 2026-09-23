import { NextResponse } from "next/server";
import { canonicalizeCheckoutItems, detectCheckoutItemsSource } from "@/lib/checkoutItems";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { DaribarStockQuoteError, requestDaribarStockQuotes } from "@/lib/daribar/stock-quote";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

/** One Daribar v3 request validates every cart line against one fulfilment pharmacy. */
export async function POST(request: Request) {
  if (!rateLimit(`cart-availability:${clientIp(request)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  let body: Record<string, unknown> | null;
  try {
    body = await readBoundedJson<Record<string, unknown>>(request, 64 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_request" }, {
      status: error instanceof RequestBodyError ? error.status : 400,
      headers: NO_STORE,
    });
  }
  const items = canonicalizeCheckoutItems(Array.isArray(body?.items) ? body.items : []);
  const city = typeof body?.city === "string" ? body.city.normalize("NFKC").trim().slice(0, 100) : "";
  const pharmacyId = typeof body?.pharmacyId === "string" ? body.pharmacyId.trim() : "";
  if (!items || items.length > 30 || !["medusa", "daribar"].includes(detectCheckoutItemsSource(items) || "")
      || (pharmacyId && !/^sloc_[A-Za-z0-9]+$/.test(pharmacyId))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await requestDaribarStockQuotes({
      items,
      city: city || "Алматы",
      ...(pharmacyId ? { preferredPharmacyId: pharmacyId } : {}),
      limit: pharmacyId ? 1 : 100,
    });
    const selected = result[0];
    return NextResponse.json({
      available: true,
      source: "daribar_v3",
      checkedAt: new Date().toISOString(),
      expiresAt: selected.quote.expiresAt,
      pharmacy: selected.quote.pharmacy,
      lines: selected.quote.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        availableQuantity: line.availableQuantity,
        unitPrice: line.unitPrice,
        total: line.total,
      })),
      subtotal: selected.quote.subtotal,
    }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof DaribarStockQuoteError ? error.status : 503;
    const code = error instanceof DaribarStockQuoteError ? error.code : "availability_unavailable";
    return NextResponse.json({ available: false, source: "daribar_v3", error: code }, { status, headers: NO_STORE });
  }
}

