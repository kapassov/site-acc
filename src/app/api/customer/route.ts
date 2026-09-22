import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DARIBAR_ACCESS_COOKIE,
  DARIBAR_REFRESH_COOKIE,
  clearDaribarAuthCookies,
  daribarOtpEnabled,
  daribarOtpFailure,
  deleteDaribarUser,
  getDaribarUser,
  logoutDaribar,
  refreshDaribarAuth,
  setDaribarAuthCookies,
  updateDaribarUser,
  verifyDaribarOtp,
  type DaribarAuthTokens,
  type DaribarUserProfile,
} from "@/lib/daribar/auth";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { phoneDigits } from "@/lib/phone";
import { isValidOtpCode, normalizeOtpPhone } from "@/lib/otpContract";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const AUTH_MODE = "sms" as const;
const MAX_BODY_BYTES = 8 * 1024;
const MEDUSA_COOKIE = "ms_cust";
const LEGACY_DEMO_COOKIE = "inkar_demo_session";

const legacyCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

function bearer(req: Request): string | null {
  const value = req.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function providerStatus(error: unknown): number {
  return typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : 0;
}

function providerCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
}

function invalidSessionError(error: unknown): boolean {
  return [400, 401].includes(providerStatus(error))
    || providerCode(error) === "invalid_auth_response";
}

function cleanName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 2)
    .join(" ")
    .slice(0, 100);
}

function mapDaribarCustomer(profile: DaribarUserProfile | null, fallbackPhone = "", fallbackName = "") {
  const first = cleanName(profile?.name);
  const last = cleanName(profile?.lastName);
  const name = cleanName([first, last].filter(Boolean).join(" ")) || cleanName(fallbackName);
  return {
    name,
    phone: phoneDigits(profile?.phone || fallbackPhone),
    email: null,
    birthDate: profile?.birthDate || null,
    gender: profile?.gender || null,
    addresses: Array.isArray(profile?.addresses) ? profile.addresses : [],
    defaultAddress: profile?.defaultAddress || null,
  };
}

function profileComplete(profile: DaribarUserProfile | null, fallbackName = ""): boolean {
  const name = cleanName(
    [profile?.name, profile?.lastName].filter(Boolean).join(" ") || fallbackName,
  );
  return name.length >= 2;
}

function clearSession(response: NextResponse): void {
  // Clear cookies created by the retired Medusa/demo authentication flows.
  response.cookies.set(MEDUSA_COOKIE, "", { ...legacyCookieOptions, maxAge: 0 });
  response.cookies.set(LEGACY_DEMO_COOKIE, "", { ...legacyCookieOptions, maxAge: 0 });
  clearDaribarAuthCookies(response);
}

type ProfileResult =
  | { status: "authenticated"; profile: DaribarUserProfile; rotated: DaribarAuthTokens | null }
  | { status: "anonymous"; clear: boolean }
  | { status: "unavailable" };

/** Validate the Daribar access cookie and rotate it once when it has expired. */
async function currentDaribarProfile(req: Request): Promise<ProfileResult> {
  const cookieStore = await cookies();
  const headerToken = bearer(req);
  let access = headerToken || cookieStore.get(DARIBAR_ACCESS_COOKIE)?.value || "";
  // Never combine a mobile bearer token with an unrelated browser refresh cookie.
  const refresh = headerToken ? "" : (cookieStore.get(DARIBAR_REFRESH_COOKIE)?.value || "");
  let rotated: DaribarAuthTokens | null = null;

  if (!access && !refresh) return { status: "anonymous", clear: false };
  if (!access && refresh) {
    try {
      rotated = await refreshDaribarAuth(refresh);
      access = rotated.accessToken;
    } catch (error) {
      return invalidSessionError(error)
        ? { status: "anonymous", clear: true }
        : { status: "unavailable" };
    }
  }

  try {
    const profile = await getDaribarUser(access);
    return { status: "authenticated", profile, rotated };
  } catch (error) {
    if (providerCode(error) === "invalid_auth_response") {
      return { status: "anonymous", clear: true };
    }
    if (providerStatus(error) !== 401 || !refresh || rotated) {
      return providerStatus(error) === 401
        ? { status: "anonymous", clear: true }
        : { status: "unavailable" };
    }
  }

  try {
    rotated = await refreshDaribarAuth(refresh);
    const profile = await getDaribarUser(rotated.accessToken);
    return { status: "authenticated", profile, rotated };
  } catch (error) {
    return invalidSessionError(error)
      ? { status: "anonymous", clear: true }
      : { status: "unavailable" };
  }
}

export async function GET(req: Request) {
  const result = await currentDaribarProfile(req);
  if (result.status === "authenticated") {
    const response = NextResponse.json({
      user: mapDaribarCustomer(result.profile),
      authMode: AUTH_MODE,
      profileComplete: profileComplete(result.profile),
    }, { headers: NO_STORE });
    if (result.rotated) setDaribarAuthCookies(response, result.rotated);
    return response;
  }
  if (result.status === "unavailable") {
    return NextResponse.json({ user: null, authMode: AUTH_MODE, transient: true }, {
      status: 503,
      headers: NO_STORE,
    });
  }
  const response = NextResponse.json({ user: null, authMode: AUTH_MODE }, { headers: NO_STORE });
  if (result.clear) clearSession(response);
  return response;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestBodyError(400, "invalid_json");
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const action = String(body?.action || "");

  if (action === "logout") {
    const cookieStore = await cookies();
    const access = bearer(req) || cookieStore.get(DARIBAR_ACCESS_COOKIE)?.value || "";
    if (access) await logoutDaribar(access).catch(() => undefined);
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    clearSession(response);
    return response;
  }

  if (action === "continue") {
    if (!daribarOtpEnabled()) {
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
    }
    const phone = normalizeOtpPhone(body?.phone);
    const code = String(body?.code || "").trim();
    const requestedName = cleanName(body?.name);
    if (phone.length !== 11) {
      return NextResponse.json({ error: "bad_phone" }, { status: 400, headers: NO_STORE });
    }
    if (!isValidOtpCode(code)) {
      return NextResponse.json({ error: "bad_code", reason: "invalid" }, { status: 401, headers: NO_STORE });
    }
    if (!rateLimit(`customer-otp:${clientIp(req)}:${phone}`, 8, 10 * 60_000, Date.now())) {
      return NextResponse.json({ error: "too_many_requests", retryAfter: 600 }, {
        status: 429, headers: { ...NO_STORE, "retry-after": "600" },
      });
    }

    let tokens: DaribarAuthTokens;
    try {
      tokens = await verifyDaribarOtp(phone, code);
    } catch (error) {
      const failure = daribarOtpFailure(error, "verify");
      return NextResponse.json({
        error: failure.error,
        ...(failure.error === "bad_code" ? { reason: "invalid" } : {}),
        ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
      }, {
        status: failure.status,
        headers: { ...NO_STORE, ...(failure.retryAfter ? { "retry-after": String(failure.retryAfter) } : {}) },
      });
    }

    let profile: DaribarUserProfile | null = null;
    let profileUpdatePending = false;
    if (requestedName) {
      try {
        profile = await updateDaribarUser(tokens.accessToken, { fullName: requestedName });
      } catch (error) {
        if (providerStatus(error) === 401) {
          await logoutDaribar(tokens.accessToken).catch(() => undefined);
          return NextResponse.json({ error: "auth_unavailable" }, { status: 502, headers: NO_STORE });
        }
        profileUpdatePending = true;
      }
    }
    if (!profile) {
      try {
        profile = await getDaribarUser(tokens.accessToken);
      } catch (error) {
        if (providerStatus(error) === 401) {
          await logoutDaribar(tokens.accessToken).catch(() => undefined);
          return NextResponse.json({ error: "auth_unavailable" }, { status: 502, headers: NO_STORE });
        }
        // Token verification succeeded. A transient profile read must not
        // turn a valid Daribar login into a failed login.
      }
    }

    const optimisticName = profileUpdatePending ? "" : requestedName;
    const user = mapDaribarCustomer(profile, phone, optimisticName);
    const complete = profileComplete(profile, optimisticName);
    const response = NextResponse.json({
      user,
      authMode: AUTH_MODE,
      profileComplete: complete,
      userInfoFilled: complete,
      ...(profileUpdatePending ? { profileUpdatePending: true } : {}),
    }, { headers: NO_STORE });
    setDaribarAuthCookies(response, tokens);
    response.cookies.set(MEDUSA_COOKIE, "", { ...legacyCookieOptions, maxAge: 0 });
    response.cookies.set(LEGACY_DEMO_COOKIE, "", { ...legacyCookieOptions, maxAge: 0 });
    return response;
  }

  if (action === "update") {
    const current = await currentDaribarProfile(req);
    if (current.status === "anonymous") {
      const response = NextResponse.json({ user: null, error: "no_session" }, {
        status: 401,
        headers: NO_STORE,
      });
      if (current.clear) clearSession(response);
      return response;
    }
    if (current.status === "unavailable") {
      return NextResponse.json({ user: null, error: "auth_unavailable" }, {
        status: 503,
        headers: NO_STORE,
      });
    }

    const cookieStore = await cookies();
    const access = current.rotated?.accessToken
      || bearer(req)
      || cookieStore.get(DARIBAR_ACCESS_COOKIE)?.value
      || "";
    const requestedFullName = cleanName(body?.name);
    const birthDate = typeof body?.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)
      ? body.birthDate
      : undefined;
    const gender = body?.gender === "unknown" || body?.gender === "male" || body?.gender === "female"
      ? body.gender
      : undefined;
    if (!requestedFullName && !birthDate && !gender) {
      const response = NextResponse.json({
        user: mapDaribarCustomer(current.profile),
        profileComplete: profileComplete(current.profile),
      }, { headers: NO_STORE });
      if (current.rotated) setDaribarAuthCookies(response, current.rotated);
      return response;
    }
    const fullName = requestedFullName || cleanName(
      [current.profile.name, current.profile.lastName].filter(Boolean).join(" "),
    );
    if (!fullName) {
      return NextResponse.json({ user: null, error: "name_required" }, {
        status: 400,
        headers: NO_STORE,
      });
    }

    try {
      const profile = await updateDaribarUser(access, {
        fullName,
        ...(birthDate ? { birthDate } : {}),
        ...(gender ? { gender } : {}),
      });
      const response = NextResponse.json({
        user: mapDaribarCustomer(profile),
        profileComplete: profileComplete(profile),
      }, { headers: NO_STORE });
      if (current.rotated) setDaribarAuthCookies(response, current.rotated);
      return response;
    } catch (error) {
      const status = providerStatus(error);
      return NextResponse.json({ user: null, error: status === 400 ? "bad_profile" : "profile_unavailable" }, {
        status: status === 400 ? 400 : status === 401 ? 401 : 502,
        headers: NO_STORE,
      });
    }
  }

  if (action === "delete") {
    const current = await currentDaribarProfile(req);
    if (current.status === "anonymous") {
      const response = NextResponse.json({ ok: false, error: "no_session" }, {
        status: 401,
        headers: NO_STORE,
      });
      if (current.clear) clearSession(response);
      return response;
    }
    if (current.status === "unavailable") {
      return NextResponse.json({ ok: false, error: "auth_unavailable" }, {
        status: 503,
        headers: NO_STORE,
      });
    }

    const cookieStore = await cookies();
    const access = current.rotated?.accessToken
      || bearer(req)
      || cookieStore.get(DARIBAR_ACCESS_COOKIE)?.value
      || "";
    try {
      await deleteDaribarUser(access);
    } catch (error) {
      return NextResponse.json({ ok: false, error: "deletion_failed" }, {
        status: providerStatus(error) === 401 ? 401 : 502,
        headers: NO_STORE,
      });
    }
    const response = NextResponse.json({ ok: true, status: "deleted" }, { headers: NO_STORE });
    clearSession(response);
    return response;
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400, headers: NO_STORE });
}
