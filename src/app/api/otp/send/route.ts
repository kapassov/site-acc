import { NextResponse } from "next/server";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import {
  DaribarAuthContractError,
  daribarOtpEnabled,
  daribarOtpFailure,
  sendDaribarOtp,
} from "@/lib/daribar/auth";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { normalizeOtpPhone } from "@/lib/otpContract";

// POST { phone } -> sends an authorization code through Daribar Swagger v2.
export const dynamic = "force-dynamic";

const MAX_OTP_BODY_BYTES = 4 * 1024;
const NO_STORE = { "cache-control": "no-store" };

function json(body: Record<string, unknown>, status = 200, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...(retryAfter ? { "retry-after": String(retryAfter) } : {}) },
  });
}

export async function POST(req: Request) {
  if (!daribarOtpEnabled()) {
    return json({ ok: false, sent: false, error: "provider_unavailable" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_OTP_BODY_BYTES);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, sent: false, error: "invalid_json" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json({ ok: false, sent: false, error: error.code }, error.status);
    }
    return json({ ok: false, sent: false, error: "invalid_json" }, 400);
  }

  const phone = normalizeOtpPhone(body.phone);
  if (!/^7\d{10}$/.test(phone)) {
    return json({ ok: false, sent: false, error: "bad_phone" }, 400);
  }

  const now = Date.now();
  if (!rateLimit(`otp:${clientIp(req)}`, 10, 10 * 60_000, now)
      || !rateLimit("otp:global", 120, 60_000, now)) {
    return json({ ok: false, sent: false, error: "too_many_requests", retryAfter: 600 }, 429, 600);
  }
  if (!rateLimit(`otp-phone:${phone}`, 1, 30_000, now)) {
    return json({ ok: false, sent: false, error: "too_soon", retryAfter: 30 }, 429, 30);
  }

  try {
    await sendDaribarOtp(phone);
    // Do not expose userInfoFilled before authentication: it would allow
    // callers to enumerate which phone numbers already have Daribar profiles.
    return json({ ok: true, sent: true });
  } catch (error) {
    const failure = daribarOtpFailure(error, "send");
    console.error("Daribar OTP send failed", {
      reason: error instanceof DaribarAuthContractError ? error.code : "provider_unavailable",
      status: failure.status,
    });
    return json({
      ok: false, sent: false, error: failure.error,
      ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}),
    }, failure.status, failure.retryAfter);
  }
}
