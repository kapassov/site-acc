import { cookies } from "next/headers";
import {
  DARIBAR_ACCESS_COOKIE,
  DARIBAR_REFRESH_COOKIE,
  getDaribarUser,
  refreshDaribarAuth,
  type DaribarAuthTokens,
  type DaribarUserProfile,
} from "./auth.ts";
import { DaribarHttpError } from "./client.ts";
import { daribarCustomerId } from "./customer-identity.ts";

export type DaribarCustomerSession = {
  accessToken: string;
  customerId: string;
  profile: DaribarUserProfile;
  rotatedTokens: DaribarAuthTokens | null;
};

export class DaribarCustomerSessionError extends Error {
  readonly status: 401 | 502 | 503;
  readonly rotatedTokens: DaribarAuthTokens | null;

  constructor(status: DaribarCustomerSessionError["status"], message: string, rotatedTokens: DaribarAuthTokens | null = null) {
    super(message);
    this.name = "DaribarCustomerSessionError";
    this.status = status;
    this.rotatedTokens = rotatedTokens;
  }
}

function bearer(request: Request): string {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function authError(error: unknown, rotatedTokens: DaribarAuthTokens | null = null): DaribarCustomerSessionError {
  if (error instanceof DaribarHttpError && error.status >= 500) {
    return new DaribarCustomerSessionError(502, "orders_unavailable", rotatedTokens);
  }
  return new DaribarCustomerSessionError(401, "daribar_auth_required", rotatedTokens);
}

export async function daribarCustomerSession(request: Request): Promise<DaribarCustomerSession | null> {
  const jar = await cookies();
  const bearerAccess = bearer(request);
  let accessToken = bearerAccess || jar.get(DARIBAR_ACCESS_COOKIE)?.value || "";
  const refreshToken = bearerAccess ? "" : jar.get(DARIBAR_REFRESH_COOKIE)?.value || "";
  let rotatedTokens: DaribarAuthTokens | null = null;
  if (!accessToken && !refreshToken) return null;
  if (!accessToken) {
    try {
      rotatedTokens = await refreshDaribarAuth(refreshToken);
      accessToken = rotatedTokens.accessToken;
    } catch (error) {
      throw authError(error);
    }
  }
  let profile: DaribarUserProfile;
  try {
    profile = await getDaribarUser(accessToken);
  } catch (error) {
    const canRefresh = !bearerAccess && !rotatedTokens && Boolean(refreshToken)
      && error instanceof DaribarHttpError && error.status === 401;
    if (!canRefresh) throw authError(error, rotatedTokens);
    try {
      rotatedTokens = await refreshDaribarAuth(refreshToken);
      accessToken = rotatedTokens.accessToken;
      profile = await getDaribarUser(accessToken);
    } catch (refreshError) {
      throw authError(refreshError, rotatedTokens);
    }
  }
  const secret = process.env.CUSTOMER_AUTH_SECRET || "";
  try {
    return { accessToken, customerId: daribarCustomerId(profile.phone, secret), profile, rotatedTokens };
  } catch {
    throw new DaribarCustomerSessionError(503, "orders_unavailable", rotatedTokens);
  }
}
