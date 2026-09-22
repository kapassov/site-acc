import { cookies } from "next/headers";
import {
  readCheckoutAttemptForActor,
  renewCheckoutPaymentSessionForActor,
  type CheckoutAttemptForActor,
} from "@/lib/checkout-attempts";
import {
  DARIBAR_ACCESS_COOKIE,
  DARIBAR_REFRESH_COOKIE,
  getDaribarUser,
  refreshDaribarAuth,
  type DaribarAuthTokens,
  type DaribarUserProfile,
} from "@/lib/daribar/auth";
import { DaribarHttpError } from "@/lib/daribar/client";
import { daribarCustomerActorKey } from "@/lib/daribar/customer-identity";
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
  readonly rotatedTokens: DaribarAuthTokens | null;

  constructor(
    status: PaymentSessionAccessError["status"],
    code: PaymentSessionAccessError["code"],
    rotatedTokens: DaribarAuthTokens | null = null,
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
  rotatedTokens: DaribarAuthTokens | null;
};

export type AuthenticatedCheckoutActor = {
  actorKey: string;
  rotatedTokens: DaribarAuthTokens | null;
};

const PAYMENT_SESSION_RENEW_MS = 24 * 60 * 60_000;

function bearer(request: Request): string {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function authFailure(
  error: unknown,
  rotatedTokens: DaribarAuthTokens | null = null,
): PaymentSessionAccessError {
  if (error instanceof DaribarHttpError && error.status >= 500) {
    return new PaymentSessionAccessError(502, "payment_session_unavailable", rotatedTokens);
  }
  return new PaymentSessionAccessError(401, "authentication_required", rotatedTokens);
}

async function rotate(refreshToken: string): Promise<DaribarAuthTokens> {
  try {
    return await refreshDaribarAuth(refreshToken);
  } catch (error) {
    throw authFailure(error);
  }
}

export async function authenticateCheckoutActorForRequest(
  request: Request,
): Promise<AuthenticatedCheckoutActor> {
  const cookieStore = await cookies();
  const bearerAccess = bearer(request);
  let accessToken = bearerAccess || cookieStore.get(DARIBAR_ACCESS_COOKIE)?.value || "";
  const refreshToken = bearerAccess ? "" : (cookieStore.get(DARIBAR_REFRESH_COOKIE)?.value || "");
  let rotatedTokens: DaribarAuthTokens | null = null;

  if (!accessToken) {
    if (!refreshToken) throw new PaymentSessionAccessError(401, "authentication_required");
    rotatedTokens = await rotate(refreshToken);
    accessToken = rotatedTokens.accessToken;
  }

  let profile: DaribarUserProfile;
  try {
    profile = await getDaribarUser(accessToken);
  } catch (error) {
    const mayRefresh = !bearerAccess
      && !rotatedTokens
      && Boolean(refreshToken)
      && error instanceof DaribarHttpError
      && error.status === 401;
    if (!mayRefresh) throw authFailure(error, rotatedTokens);
    rotatedTokens = await rotate(refreshToken);
    try {
      profile = await getDaribarUser(rotatedTokens.accessToken);
    } catch (refreshError) {
      throw authFailure(refreshError, rotatedTokens);
    }
  }

  try {
    return { actorKey: daribarCustomerActorKey(profile.phone), rotatedTokens };
  } catch {
    throw new PaymentSessionAccessError(503, "payment_session_unavailable", rotatedTokens);
  }
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
 * Resolves a payment session using the verified Daribar profile rather than a
 * client-supplied phone/customer id. Bearer callers never consume an unrelated
 * browser refresh cookie; web callers can transparently rotate their cookies.
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
