import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { kassaPaymentStatus } from "@/lib/payments/kassa";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!rateLimit(`kassa-status:${clientIp(request)}`, 60, 60_000, Date.now())) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order") || "";
  const token = url.searchParams.get("token") || "";
  if (!/^[a-f\d-]{20,64}$/i.test(orderId) || token.length < 32 || token.length > 128) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    return NextResponse.json(await kassaPaymentStatus(orderId, token), { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "payment_status_failed";
    const status = code === "kassa_return_token_invalid" ? 403 : code === "kassa_payment_not_found" ? 404 : 503;
    return NextResponse.json({ error: status === 503 ? "payment_status_failed" : code }, { status, headers: NO_STORE });
  }
}
