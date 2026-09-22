import { NextResponse } from "next/server";
import { setDaribarAuthCookies } from "@/lib/daribar/auth";
import {
  loadPaymentSessionForRequest,
  PaymentSessionAccessError,
} from "@/lib/payment-session-server";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  vary: "Cookie, Authorization",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
};

function hasBearer(request: Request): boolean {
  return /^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "");
}

function firstForwardedValue(value: string | null): string {
  return (value || "").split(",", 1)[0]?.trim() || "";
}

function publicRequestOrigin(request: Request): string | null {
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    || firstForwardedValue(request.headers.get("host"));
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"))
    || new URL(request.url).protocol.replace(/:$/, "");
  if (!host || !/^(?:https?|http)$/i.test(protocol)) return null;
  try {
    const url = new URL(`${protocol.toLowerCase()}://${host}`);
    return url.origin;
  } catch {
    return null;
  }
}

function isSameOriginBrowserPost(request: Request): boolean {
  if (hasBearer(request)) return true;
  // Behind nginx, request.url points at the internal Next.js listener while
  // Origin/Referer contain the public HTTPS site. Compare browser provenance
  // with the proxy-preserved public origin instead of localhost.
  const expected = publicRequestOrigin(request);
  if (!expected) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== expected) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (origin || fetchSite === "same-origin") return true;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function errorResponse(error: PaymentSessionAccessError): NextResponse {
  const response = NextResponse.json({ error: error.code }, {
    status: error.status,
    headers: PRIVATE_HEADERS,
  });
  if (error.rotatedTokens) setDaribarAuthCookies(response, error.rotatedTokens);
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isSameOriginBrowserPost(request)) {
      return NextResponse.json({ error: "invalid_payment_request" }, {
        status: 403,
        headers: PRIVATE_HEADERS,
      });
    }
    const { id } = await params;
    const result = await loadPaymentSessionForRequest(request, id);
    // resolvePaymentSession already applies the Daribar/Kassa HTTPS host
    // allow-list. A 303 also prevents a browser from replaying this POST at the
    // payment provider.
    const response = NextResponse.redirect(result.session.redirect, 303);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
    if (result.rotatedTokens) setDaribarAuthCookies(response, result.rotatedTokens);
    return response;
  } catch (error) {
    if (error instanceof PaymentSessionAccessError) return errorResponse(error);
    console.error("[payment-session] continuation failed");
    return errorResponse(new PaymentSessionAccessError(503, "payment_session_unavailable"));
  }
}
