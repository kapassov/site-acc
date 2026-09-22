import type { NextResponse } from "next/server";
import { isValidOtpCode, normalizeOtpPhone } from "../otpContract.ts";
import { DaribarHttpError, daribarJson } from "./client.ts";
import { daribarPartnerToken, isDaribarEnabled } from "./config.ts";

export const DARIBAR_ACCESS_COOKIE = "daribar_access";
export const DARIBAR_REFRESH_COOKIE = "daribar_refresh";

export type DaribarAuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type DaribarGender = "unknown" | "male" | "female";

export type DaribarUserProfile = {
  phone: string;
  name: string;
  lastName: string;
  birthDate: string | null;
  gender: DaribarGender;
  addresses: string[];
  defaultAddress: string | null;
  values: Record<string, unknown>;
};

export type DaribarUserUpdate = {
  fullName?: string;
  birthDate?: string | null;
  gender?: DaribarGender;
};

export type SendDaribarOtpResult = {
  userInfoFilled: boolean;
};

type SendSmsResponse = {
  status?: unknown;
};

type AuthResponse = {
  status?: unknown;
  result?: {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
};

type UserResponse = {
  status?: unknown;
  result?: unknown;
};

export class DaribarAuthContractError extends Error {
  readonly code:
    | "otp_send_rejected"
    | "otp_transport_not_configured"
    | "invalid_auth_response"
    | "invalid_profile_response"
    | "invalid_profile_update";

  constructor(code: DaribarAuthContractError["code"]) {
    super("Daribar authentication provider returned an invalid response");
    this.name = "DaribarAuthContractError";
    this.code = code;
  }
}

/** Public errors are a fixed vocabulary, never upstream messages or user data. */
export function daribarOtpFailure(error: unknown, phase: "send" | "verify") {
  if (error instanceof DaribarHttpError) {
    if (error.status === 429) {
      return { error: "too_many_requests", status: 429, retryAfter: error.retryAfter || 60 };
    }
    if (error.status === 504 || error.code === "daribar_timeout") {
      return { error: "provider_timeout", status: 504, retryAfter: undefined };
    }
    if (phase === "verify" && [400, 401].includes(error.status)) {
      return { error: "bad_code", status: 401, retryAfter: undefined };
    }
  }
  return {
    error: phase === "send" ? "provider_unavailable" : "auth_unavailable",
    status: phase === "send" ? 503 : 502,
    retryAfter: undefined,
  };
}

function validToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 20 || token.length > 8_192 || /\s/.test(token)) {
    throw new DaribarAuthContractError("invalid_auth_response");
  }
  return token;
}

function partnerHeaders(accessToken?: string): Record<string, string> {
  const partnerToken = daribarPartnerToken();
  return {
    ...(accessToken ? { authorization: `Bearer ${validToken(accessToken)}` } : {}),
    ...(partnerToken ? { "x-partner-token": partnerToken } : {}),
  };
}

function optionalString(value: unknown, maximum: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new DaribarAuthContractError("invalid_profile_response");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DaribarAuthContractError("invalid_profile_response");
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function daribarOtpEnabled(): boolean {
  return isDaribarEnabled("otp");
}

export function parseDaribarAuthTokens(payload: AuthResponse): DaribarAuthTokens {
  if (payload?.status !== "success" || !payload.result) {
    throw new DaribarAuthContractError("invalid_auth_response");
  }
  return {
    accessToken: validToken(payload.result.access_token),
    refreshToken: validToken(payload.result.refresh_token),
  };
}

export function parseDaribarUserProfile(payload: UserResponse): DaribarUserProfile {
  if (payload?.status !== "success") {
    throw new DaribarAuthContractError("invalid_profile_response");
  }
  const result = asRecord(payload.result);
  if (!result) throw new DaribarAuthContractError("invalid_profile_response");

  const phone = typeof result.phone === "string" ? result.phone.trim() : "";
  if (!/^7\d{10}$/.test(phone)) {
    throw new DaribarAuthContractError("invalid_profile_response");
  }

  const name = optionalString(result.name, 100) || "";
  const lastName = optionalString(result.last_name, 100) || "";
  const birthDate = optionalString(result.birth_date, 64);
  const defaultAddress = optionalString(result.default_address, 500);
  const gender = result.gender == null || result.gender === ""
    ? "unknown"
    : result.gender;
  if (gender !== "unknown" && gender !== "male" && gender !== "female") {
    throw new DaribarAuthContractError("invalid_profile_response");
  }

  const rawAddresses = result.addresses == null ? [] : result.addresses;
  if (!Array.isArray(rawAddresses)
      || rawAddresses.some((address) => typeof address !== "string" || address.trim().length > 500)) {
    throw new DaribarAuthContractError("invalid_profile_response");
  }
  const addresses = rawAddresses
    .map((address) => address.trim())
    .filter(Boolean)
    .slice(0, 100);

  const values = result.values == null ? {} : asRecord(result.values);
  if (!values) throw new DaribarAuthContractError("invalid_profile_response");

  return {
    phone,
    name,
    lastName,
    birthDate,
    gender,
    addresses,
    defaultAddress,
    values: { ...values },
  };
}

export async function sendDaribarOtp(phone: string): Promise<SendDaribarOtpResult> {
  if (!daribarOtpEnabled()) {
    throw new DaribarAuthContractError("otp_transport_not_configured");
  }

  const response = await daribarJson<SendSmsResponse>(
    "/api/v2/sms",
    {
      method: "POST",
      origin: "auth",
      auth: false,
      headers: partnerHeaders(),
      body: { phone, sms_type: "auth" },
      maxBytes: 16 * 1024,
    },
  );
  if (response?.status !== "success") {
    throw new DaribarAuthContractError("otp_send_rejected");
  }
  // The v2 Swagger response intentionally does not reveal whether a phone
  // already has a profile. That value is determined only after verification.
  return { userInfoFilled: false };
}

export async function verifyDaribarOtp(phone: string, code: string): Promise<DaribarAuthTokens> {
  const normalizedPhone = normalizeOtpPhone(phone);
  const normalizedCode = String(code || "").trim();
  if (!/^7\d{10}$/.test(normalizedPhone) || !isValidOtpCode(normalizedCode)) {
    throw new DaribarAuthContractError("invalid_auth_response");
  }
  const response = await daribarJson<AuthResponse>("/api/v2/auth", {
    method: "POST",
    origin: "auth",
    auth: false,
    headers: partnerHeaders(),
    body: { phone: normalizedPhone, validation_code: normalizedCode },
    maxBytes: 32 * 1024,
  });
  return parseDaribarAuthTokens(response);
}

export async function refreshDaribarAuth(refreshToken: string): Promise<DaribarAuthTokens> {
  const token = validToken(refreshToken);
  const response = await daribarJson<AuthResponse>("/api/v1/auth/refresh", {
    method: "POST",
    origin: "auth",
    auth: false,
    headers: partnerHeaders(),
    body: { refresh_token: token },
    maxBytes: 32 * 1024,
  });
  return parseDaribarAuthTokens(response);
}

export async function getDaribarUser(accessToken: string): Promise<DaribarUserProfile> {
  const response = await daribarJson<UserResponse>("/api/v1/users", {
    origin: "auth",
    auth: false,
    headers: partnerHeaders(accessToken),
    maxBytes: 128 * 1024,
  });
  return parseDaribarUserProfile(response);
}

export async function updateDaribarUser(
  accessToken: string,
  update: DaribarUserUpdate | string,
): Promise<DaribarUserProfile> {
  const value: DaribarUserUpdate = typeof update === "string" ? { fullName: update } : update;
  const body: Record<string, string> = {};
  if (value.fullName != null) {
    const fullName = String(value.fullName).trim().replace(/\s+/g, " ");
    if (!fullName || fullName.length > 200 || fullName.split(" ").length > 2) {
      throw new DaribarAuthContractError("invalid_profile_update");
    }
    body.full_name = fullName;
  }
  if (value.birthDate != null) {
    const birthDate = String(value.birthDate).trim();
    if (!birthDate || birthDate.length > 64 || !Number.isFinite(Date.parse(birthDate))) {
      throw new DaribarAuthContractError("invalid_profile_update");
    }
    body.birth_date = birthDate;
  }
  if (value.gender != null) {
    if (!(["unknown", "male", "female"] as const).includes(value.gender)) {
      throw new DaribarAuthContractError("invalid_profile_update");
    }
    body.gender = value.gender;
  }
  if (Object.keys(body).length === 0) {
    throw new DaribarAuthContractError("invalid_profile_update");
  }

  await daribarJson("/api/v1/users/edit", {
    method: "PUT",
    origin: "auth",
    auth: false,
    headers: partnerHeaders(accessToken),
    body,
    maxBytes: 32 * 1024,
  });
  return getDaribarUser(accessToken);
}

export async function deleteDaribarUser(accessToken: string): Promise<void> {
  await daribarJson("/api/v1/users", {
    method: "DELETE",
    origin: "auth",
    auth: false,
    headers: partnerHeaders(accessToken),
    maxBytes: 32 * 1024,
  });
}

export async function logoutDaribar(accessToken: string): Promise<void> {
  if (!String(accessToken || "").trim()) return;
  await daribarJson("/api/v1/logout", {
    method: "POST",
    origin: "auth",
    auth: false,
    headers: partnerHeaders(accessToken),
    maxBytes: 32 * 1024,
  });
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

export function setDaribarAuthCookies(response: NextResponse, tokens: DaribarAuthTokens): void {
  const accessToken = validToken(tokens.accessToken);
  const refreshToken = validToken(tokens.refreshToken);
  response.cookies.set(DARIBAR_ACCESS_COOKIE, accessToken, cookieOptions(60 * 60 * 24));
  response.cookies.set(DARIBAR_REFRESH_COOKIE, refreshToken, cookieOptions(60 * 60 * 24 * 90));
}

export function clearDaribarAuthCookies(response: NextResponse): void {
  response.cookies.set(DARIBAR_ACCESS_COOKIE, "", cookieOptions(0));
  response.cookies.set(DARIBAR_REFRESH_COOKIE, "", cookieOptions(0));
}
