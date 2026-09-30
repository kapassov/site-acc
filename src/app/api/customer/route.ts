import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { MedusaStoreError, medusaStore } from "@/lib/medusaStore";
import { consumeCode, validateCode } from "@/lib/otp";
import { isValidOtpCode, normalizeOtpPhone } from "@/lib/otpContract";
import { phoneDigits } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const AUTH_MODE = "sms" as const;
const MAX_BODY_BYTES = 8 * 1024;
const CUSTOMER_COOKIE = "ms_cust";
const LEGACY_DEMO_COOKIE = "inkar_demo_session";
const LEGACY_DARIBAR_ACCESS_COOKIE = "daribar_access";
const LEGACY_DARIBAR_REFRESH_COOKIE = "daribar_refresh";
const EMAIL_DOMAIN = "phone.darihana.kz";

type StoreCustomer = {
  id?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  metadata?: Record<string, unknown> | null;
};

const cookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
  secure: process.env.NODE_ENV === "production",
};

function bearer(req: Request): string | null {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function sessionToken(req: Request): Promise<string | null> {
  return bearer(req) || (await cookies()).get(CUSTOMER_COOKIE)?.value || null;
}

function clearLegacySessions(response: NextResponse): void {
  response.cookies.set(CUSTOMER_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(LEGACY_DEMO_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(LEGACY_DARIBAR_ACCESS_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(LEGACY_DARIBAR_REFRESH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

function derivePassword(phone: string): string {
  const secret = process.env.CUSTOMER_AUTH_SECRET || "";
  if (!isStrongRuntimeSecret(secret)) throw new Error("customer_auth_secret_missing");
  return `P!${crypto.createHmac("sha256", secret).update(phone).digest("base64url").slice(0, 26)}`;
}

function phoneEmail(phone: string): string {
  return `u${phone}@${EMAIL_DOMAIN}`;
}

function cleanName(value: unknown): string {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
  return name && !/[\d<>]/.test(name) ? name : "";
}

function profileComplete(customer: StoreCustomer | null): boolean {
  const name = cleanName([customer?.first_name, customer?.last_name].filter(Boolean).join(" "));
  return name.length >= 2 && name.toLocaleLowerCase("ru-RU") !== "гость";
}

function mapCustomer(customer: StoreCustomer) {
  const metadata = customer.metadata || {};
  const contactEmail = typeof metadata.contact_email === "string" ? metadata.contact_email.trim() : "";
  const accountEmail = typeof customer.email === "string" ? customer.email.trim() : "";
  const rawEmail = contactEmail || (accountEmail.endsWith(`@${EMAIL_DOMAIN}`) ? "" : accountEmail);
  const name = cleanName([customer.first_name, customer.last_name].filter(Boolean).join(" "));
  const level = ["Bronze", "Silver", "Gold", "Platinum"].includes(String(metadata.level))
    ? String(metadata.level)
    : "Bronze";
  return {
    name,
    phone: phoneDigits(typeof customer.phone === "string" ? customer.phone : ""),
    email: rawEmail || null,
    bonus: Number(metadata.bonus ?? 0) || 0,
    level,
    profileComplete: profileComplete(customer),
  };
}

async function login(email: string, password: string): Promise<string | null> {
  try {
    const result = await medusaStore<{ token?: unknown }>("/auth/customer/emailpass", {
      method: "POST", body: { email, password },
    });
    return typeof result.token === "string" && result.token ? result.token : null;
  } catch (error) {
    if (error instanceof MedusaStoreError && [400, 401, 404].includes(error.status)) return null;
    throw error;
  }
}

async function getOrCreateCustomer(phone: string): Promise<{ token: string; customer: StoreCustomer }> {
  const email = phoneEmail(phone);
  const password = derivePassword(phone);
  let token = await login(email, password);
  if (!token) {
    try {
      const registered = await medusaStore<{ token?: unknown }>("/auth/customer/emailpass/register", {
        method: "POST", body: { email, password },
      });
      token = typeof registered.token === "string" ? registered.token : null;
    } catch (error) {
      if (!(error instanceof MedusaStoreError) || ![400, 409, 422].includes(error.status)) throw error;
    }
  }
  if (!token) token = await login(email, password);
  if (!token) throw new Error("customer_auth_unavailable");

  let current = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
  if (!current.customer) {
    await medusaStore("/store/customers", {
      method: "POST",
      token,
      body: { email, first_name: "Гость", phone, metadata: { bonus: 0, level: "Bronze" } },
    });
    token = await login(email, password);
    if (!token) throw new Error("customer_auth_unavailable");
    current = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
  }
  if (!current.customer || typeof current.customer.id !== "string") {
    throw new Error("customer_profile_unavailable");
  }
  return { token, customer: current.customer };
}

export async function GET(req: Request) {
  const token = await sessionToken(req);
  if (!token) return NextResponse.json({ user: null, authMode: AUTH_MODE }, { headers: NO_STORE });
  try {
    const result = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
    if (!result.customer) throw new MedusaStoreError(404, { error: "customer_not_found" });
    return NextResponse.json({
      user: mapCustomer(result.customer),
      authMode: AUTH_MODE,
      profileComplete: profileComplete(result.customer),
    }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MedusaStoreError && [401, 404].includes(error.status)) {
      const response = NextResponse.json({ user: null, authMode: AUTH_MODE }, { headers: NO_STORE });
      clearLegacySessions(response);
      return response;
    }
    return NextResponse.json({ user: null, authMode: AUTH_MODE, transient: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError(400, "invalid_json");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.code : "invalid_json" }, {
      status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE,
    });
  }

  const action = String(body.action || "");
  if (action === "logout") {
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    clearLegacySessions(response);
    return response;
  }

  if (action === "continue") {
    const phone = normalizeOtpPhone(body.phone);
    const code = String(body.code || "").trim();
    if (!phone) return NextResponse.json({ error: "bad_phone" }, { status: 400, headers: NO_STORE });
    if (!isValidOtpCode(code)) {
      return NextResponse.json({ error: "bad_code", reason: "invalid" }, { status: 401, headers: NO_STORE });
    }
    if (!rateLimit(`customer-otp:${clientIp(req)}:${phone}`, 8, 10 * 60_000, Date.now())) {
      return NextResponse.json({ error: "too_many_requests", retryAfter: 600 }, {
        status: 429, headers: { ...NO_STORE, "retry-after": "600" },
      });
    }
    let checked: Awaited<ReturnType<typeof validateCode>>;
    try {
      checked = await validateCode(phone, code);
    } catch {
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
    }
    if (!checked.ok) {
      const reason = checked.reason === "expired" || checked.reason === "no_code" ? "expired" : checked.reason;
      return NextResponse.json({ error: reason === "expired" ? "expired_code" : "bad_code", reason }, {
        status: 401, headers: NO_STORE,
      });
    }
    try {
      const result = await getOrCreateCustomer(phone);
      if (!await consumeCode(phone, code)) {
        return NextResponse.json({ error: "bad_code", reason: "expired" }, { status: 401, headers: NO_STORE });
      }
      const complete = profileComplete(result.customer);
      const response = NextResponse.json({
        user: mapCustomer(result.customer),
        authMode: AUTH_MODE,
        profileComplete: complete,
        userInfoFilled: complete,
        ...(body.withToken === true ? { token: result.token } : {}),
      }, { headers: NO_STORE });
      response.cookies.set(CUSTOMER_COOKIE, result.token, cookieOptions);
      response.cookies.set(LEGACY_DEMO_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      response.cookies.set(LEGACY_DARIBAR_ACCESS_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      response.cookies.set(LEGACY_DARIBAR_REFRESH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      return response;
    } catch (error) {
      console.error("Customer SMS login failed", {
        reason: error instanceof MedusaStoreError ? `medusa_${error.status}` : "customer_auth_unavailable",
      });
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
    }
  }

  if (action === "update") {
    const token = await sessionToken(req);
    if (!token) return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (name.length < 2) return NextResponse.json({ error: "bad_name" }, { status: 400, headers: NO_STORE });
      const [firstName, ...lastName] = name.split(" ");
      patch.first_name = firstName;
      patch.last_name = lastName.join(" ");
    }
    if (body.email !== undefined) {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "bad_email" }, { status: 400, headers: NO_STORE });
      }
      try {
        const current = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
        if (!current.customer) throw new MedusaStoreError(404, { error: "customer_not_found" });
        patch.metadata = {
          ...(current.customer.metadata || {}),
          contact_email: email || null,
        };
      } catch (error) {
        const status = error instanceof MedusaStoreError && [401, 404].includes(error.status) ? 401 : 502;
        return NextResponse.json({ error: status === 401 ? "unauthorized" : "profile_unavailable" }, {
          status, headers: NO_STORE,
        });
      }
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "bad_action" }, { status: 400, headers: NO_STORE });
    try {
      await medusaStore("/store/customers/me", { method: "POST", token, body: patch });
      const result = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
      if (!result.customer) throw new Error("customer_profile_unavailable");
      return NextResponse.json({
        user: mapCustomer(result.customer),
        profileComplete: profileComplete(result.customer),
      }, { headers: NO_STORE });
    } catch (error) {
      const status = error instanceof MedusaStoreError && [401, 404].includes(error.status) ? 401 : 502;
      return NextResponse.json({ error: status === 401 ? "unauthorized" : "profile_unavailable" }, {
        status, headers: NO_STORE,
      });
    }
  }

  if (action === "delete") {
    const token = await sessionToken(req);
    if (!token) return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
    try {
      const current = await medusaStore<{ customer?: StoreCustomer }>("/store/customers/me", { token });
      if (!current.customer) throw new MedusaStoreError(404, { error: "customer_not_found" });
      await medusaStore("/store/customers/me", {
        method: "POST", token,
        body: { metadata: {
          ...(current.customer.metadata || {}),
          account_deletion_status: "requested",
          account_deletion_requested_at: new Date().toISOString(),
        } },
      });
      const response = NextResponse.json({ ok: true, status: "requested" }, { status: 202, headers: NO_STORE });
      clearLegacySessions(response);
      return response;
    } catch {
      return NextResponse.json({ error: "deletion_request_failed" }, { status: 502, headers: NO_STORE });
    }
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400, headers: NO_STORE });
}
