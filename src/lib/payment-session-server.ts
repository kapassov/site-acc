import { createHmac } from "node:crypto";
import {
  readCheckoutAttemptForActor,
  renewCheckoutPaymentSessionForActor,
  type CheckoutAttemptForActor,
} from "@/lib/checkout-attempts";
import { customerSession } from "@/lib/customerSession";
import {
  isPaymentSessionId,
  PAYMENT_SESSION_RECOVERY_MAX_AGE_MS,
  recoverExpiredPaymentSession,
  resolvePaymentSession,
  type ResolvedPaymentSession,
} from "@/lib/payment-session";

export class PaymentSessionAccessError extends Error {
  readonly status: 401 | 404 | 502 | 503;
  readonly code: "authentication_required" | "payment_session_not_found" | "payment_session_unavailable";
  readonly rotatedTokens: null;

  constructor(
    status: PaymentSessionAccessError["status"],
    code: PaymentSessionAccessError["code"],
    rotatedTokens: null = null,
  ) {
    super(code);
    this.name = "PaymentSessionAccessError";
    this.status = status;
    this.code = code;
    this.rotatedTokens = rotatedTokens;
  }
}

export type AuthenticatedPaymentSession = {
  session: ResolvedPaymentSession;
  rotatedTokens: null;
};

export type AuthenticatedCheckoutActor = {
  actorKey: string;
  rotatedTokens: null;
};

const PAYMENT_SESSION_RENEW_MS = 24 * 60 * 60_000;

export async function authenticateCheckoutActorForRequest(
  request: Request,
): Promise<AuthenticatedCheckoutActor> {
  const session = await customerSession(request);
  if (session.status === "anonymous") throw new PaymentSessionAccessError(401, "authentication_required");
  if (session.status === "unavailable") throw new PaymentSessionAccessError(503, "payment_session_unavailable");
  const secret = process.env.CUSTOMER_AUTH_SECRET || "";
  if (secret.length < 32) throw new PaymentSessionAccessError(503, "payment_session_unavailable");
  return {
    actorKey: createHmac("sha256", secret).update(`customer:${session.customerId}`).digest("hex"),
    rotatedTokens: null,
  };
}

export async function resolveOrRenewPaymentSessionForActor(
  sessionId: string,
  actorKey: string,
  attempt: CheckoutAttemptForActor | null,
): Promise<ResolvedPaymentSession | null> {
  const current = resolvePaymentSession(sessionId, attempt);
  if (current) return current;
  if (!recoverExpiredPaymentSession(sessionId, attempt)) return null;
  const renewed = await renewCheckoutPaymentSessionForActor(sessionId, actorKey, {
    maxAgeMs: PAYMENT_SESSION_RECOVERY_MAX_AGE_MS,
    retainMs: PAYMENT_SESSION_RENEW_MS,
  });
  return resolvePaymentSession(sessionId, renewed);
}

/**
 * Resolves a payment session using the verified first-party customer profile
 * rather than a client-supplied phone or customer id.
 */
export async function loadPaymentSessionForRequest(
  request: Request,
  sessionId: string,
): Promise<AuthenticatedPaymentSession> {
  if (!isPaymentSessionId(sessionId)) {
    throw new PaymentSessionAccessError(404, "payment_session_not_found");
  }

  const { actorKey, rotatedTokens } = await authenticateCheckoutActorForRequest(request);

  let attempt;
  try {
    attempt = await readCheckoutAttemptForActor(sessionId, actorKey);
  } catch {
    throw new PaymentSessionAccessError(503, "payment_session_unavailable", rotatedTokens);
  }
  let session;
  try {
    session = await resolveOrRenewPaymentSessionForActor(sessionId, actorKey, attempt);
  } catch {
    throw new PaymentSessionAccessError(503, "payment_session_unavailable", rotatedTokens);
  }
  if (!session) throw new PaymentSessionAccessError(404, "payment_session_not_found", rotatedTokens);
  return { session, rotatedTokens };
}
