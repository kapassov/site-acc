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

function errorResponse(error: PaymentSessionAccessError): NextResponse {
  const response = NextResponse.json({ error: error.code }, {
    status: error.status,
    headers: PRIVATE_HEADERS,
  });
  if (error.rotatedTokens) setDaribarAuthCookies(response, error.rotatedTokens);
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await loadPaymentSessionForRequest(request, id);
    // Deliberately return metadata only. The hosted Kassa/Daribar URL remains
    // server-side until the customer explicitly continues with a POST.
    const response = NextResponse.json(result.session.metadata, {
      status: 200,
      headers: PRIVATE_HEADERS,
    });
    if (result.rotatedTokens) setDaribarAuthCookies(response, result.rotatedTokens);
    return response;
  } catch (error) {
    if (error instanceof PaymentSessionAccessError) return errorResponse(error);
    console.error("[payment-session] metadata lookup failed");
    return errorResponse(new PaymentSessionAccessError(503, "payment_session_unavailable"));
  }
}
