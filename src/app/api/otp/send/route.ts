import { NextResponse } from "next/server";
import {
  activateCode,
  deferCode,
  genCode,
  reserveCode,
  sendSms,
} from "@/lib/otp";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { normalizeOtpPhone } from "@/lib/otpContract";
import { clientIp, rateLimit } from "@/lib/rateLimit";

// POST { phone } → шлёт SMS-код через настроенного провайдера. Обходов без реальной отправки нет.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_OTP_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  const now = Date.now();
  if (!rateLimit(`otp:${clientIp(req)}`, 10, 10 * 60_000, now) ||
      !rateLimit("otp:global", 120, 60_000, now)) {
    return NextResponse.json({ ok: false, sent: false, error: "too_many_requests", retryAfter: 600 }, {
      status: 429, headers: { ...NO_STORE, "retry-after": "600" },
    });
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await readBoundedJson<unknown>(req, MAX_OTP_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError(400, "invalid_json");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ ok: false, sent: false, error: error instanceof RequestBodyError ? error.code : "invalid_json" }, {
      status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE,
    });
  }
  const phone = normalizeOtpPhone(body.phone);
  if (!phone) {
    return NextResponse.json({ ok: false, sent: false, error: "bad_phone" }, { status: 400, headers: NO_STORE });
  }
  const code = genCode();
  try {
    if (!await reserveCode(phone, code)) {
      return NextResponse.json({ ok: false, sent: false, error: "too_soon", retryAfter: 30 }, {
        status: 429, headers: { ...NO_STORE, "retry-after": "30" },
      });
    }
  } catch {
    return NextResponse.json({ ok: false, sent: false, error: "otp_unavailable" }, {
      status: 503, headers: NO_STORE,
    });
  }
  // P1SMS digit is the emergency OTP route for accounts without an approved
  // alphabetic sender. Keep it code-only so no unregistered brand text can
  // trigger content moderation; approved named providers retain the brand.
  const isP1Digit = String(process.env.SMS_PROVIDER || "").toLowerCase() === "p1sms"
    && String(process.env.P1SMS_CHANNEL || "digit").toLowerCase() === "digit";
  const text = isP1Digit ? code : `AptekaSoSklada: ${code}`;
  const r = await sendSms(phone, text);
  if (!r.ok) {
    const retryAfter = Math.max(30, Math.min(Number(r.retryAfter) || 30, 300));
    await deferCode(phone, code, retryAfter * 1000).catch(() => undefined);
    console.error("OTP provider send failed", { reason: r.error || "unknown" });
    return NextResponse.json(
      { ok: false, sent: false, error: "provider_unavailable", retryAfter },
      { status: 502, headers: { ...NO_STORE, "retry-after": String(retryAfter) } },
    );
  }
  if (!await activateCode(phone, code).catch(() => false)) {
    return NextResponse.json(
      { ok: false, sent: true, error: "otp_state_error" },
      { status: 500, headers: NO_STORE },
    );
  }
  return NextResponse.json({ ok: true, sent: true }, { headers: NO_STORE });
}
