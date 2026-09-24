import { NextResponse } from "next/server";
import { canonicalizeCheckoutItems, detectCheckoutItemsSource } from "@/lib/checkoutItems";
import { storefrontCheckoutSource } from "@/lib/catalog-provider";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { DaribarStockQuoteError, requestDaribarStockQuotes } from "@/lib/daribar/stock-quote";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!rateLimit(`pickup-options:${clientIp(request)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate_limited", pharmacies: [] }, { status: 429, headers: NO_STORE });
  }
  let body: Record<string, unknown> | null;
  try {
    body = await readBoundedJson<Record<string, unknown>>(request, 64 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_request", pharmacies: [] }, {
      status: error instanceof RequestBodyError ? error.status : 400,
      headers: NO_STORE,
    });
  }
  const items = canonicalizeCheckoutItems(Array.isArray(body?.items) ? body.items : []);
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  if (!items || (city && !/^[\p{L}\p{M} .'-]{1,100}$/u.test(city))) {
    return NextResponse.json({ error: "invalid_request", pharmacies: [] }, { status: 400, headers: NO_STORE });
  }
  if (detectCheckoutItemsSource(items) !== storefrontCheckoutSource()) {
    return NextResponse.json({ error: "stale_cart", pharmacies: [] }, { status: 409, headers: NO_STORE });
  }
  try {
    const quotes = await requestDaribarStockQuotes({ items, city: city || "Алматы", limit: 250 });
    const pharmacies = quotes.map(({ quote, pharmacy }) => ({
      sourceCode: pharmacy.id,
      name: pharmacy.name,
      city: pharmacy.city,
      address: pharmacy.address,
      hours: pharmacy.hours || "",
      total: quote.total,
      ...(pharmacy.lat !== undefined ? { lat: pharmacy.lat } : {}),
      ...(pharmacy.lon !== undefined ? { lon: pharmacy.lon } : {}),
    }));
    return NextResponse.json({ source: "daribar_v3", degraded: false, city: city || null, pharmacies }, {
      status: 200,
      headers: NO_STORE,
    });
  } catch (error) {
    const status = error instanceof DaribarStockQuoteError ? error.status : 503;
    const code = error instanceof DaribarStockQuoteError ? error.code : "pickup_options_unavailable";
    if (!(error instanceof DaribarStockQuoteError)) {
      console.error("[checkout/pickup-options] live stock unavailable", {
        name: error instanceof Error ? error.name : "UnknownError",
        code: error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 100) : "unknown",
      });
    }
    return NextResponse.json({ error: code, source: "daribar_v3", degraded: true, pharmacies: [] }, {
      status,
      headers: NO_STORE,
    });
  }
}
