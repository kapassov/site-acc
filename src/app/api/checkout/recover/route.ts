import { NextResponse } from "next/server";
import { readCheckoutAttemptByKeyForActor } from "@/lib/checkout-attempts";
import {
  authenticateCheckoutActorForRequest,
  PaymentSessionAccessError,
  resolveOrRenewPaymentSessionForActor,
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

function response(
  payload: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(payload, { status, headers: PRIVATE_HEADERS });
}

/**
 * Read-only recovery for a browser that lost the original checkout response.
 * It never calls Daribar or creates an order; it only returns the actor-bound,
 * already persisted result for the original idempotency key.
 */
export async function POST(request: Request) {
  try {
    const idempotencyKey = (request.headers.get("x-idempotency-key") || "").trim();
    const auth = await authenticateCheckoutActorForRequest(request);
    const attempt = await readCheckoutAttemptByKeyForActor(idempotencyKey, auth.actorKey);
    if (!attempt) return response({ error: "checkout_attempt_not_found" }, 404);

    const session = await resolveOrRenewPaymentSessionForActor(attempt.id, auth.actorKey, attempt);
    if (session) {
      return response({
        requiresAction: true,
        paymentSessionId: attempt.id,
      }, 200);
    }
    if (attempt.state === "pending") {
      return response({ error: "checkout_in_progress" }, 409);
    }
    if (attempt.state === "uncertain") {
      return response({ error: "order_status_uncertain" }, 409);
    }
    return response({ error: "payment_link_unavailable", orderCreated: true }, 409);
  } catch (error) {
    if (error instanceof PaymentSessionAccessError) {
      return response({ error: error.code }, error.status);
    }
    console.error("[checkout-recovery] failed");
    return response({ error: "checkout_recovery_unavailable" }, 503);
  }
}
