// OTP по SMS. Учетные данные провайдера — серверные секреты, в клиент не уходят.
// Состояние проверки хранится в нашей PostgreSQL, код — только как HMAC-дайджест.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { ordersDatabasePool } from "./orders/store.ts";
import { OTP_CODE_LENGTH } from "./otpContract.ts";
import { isStrongRuntimeSecret } from "./serverSecrets.ts";

const TTL_MS = 5 * 60 * 1000; // код живёт 5 минут
const RESEND_MS = 30 * 1000; // не чаще раза в 30с
const MAX_ATTEMPTS = 5;

function runtimeVariable(name: string): string | undefined {
  // Dynamic lookup keeps server-only credentials out of build-time env
  // expansion. This matters for secrets containing "$".
  return process.env[name];
}

function digestCode(phone: string, code: string): string {
  const secret = process.env.CUSTOMER_AUTH_SECRET || "";
  if (!isStrongRuntimeSecret(secret)) throw new Error("customer_auth_secret_missing");
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function genCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, "0");
}

/** Можно ли слать сейчас (анти-флуд). */
export async function canSend(phone: string, now = Date.now()): Promise<boolean> {
  const db = await ordersDatabasePool();
  const result = await db.query<{ allowed: boolean }>(`
    SELECT NOT EXISTS (
      SELECT 1 FROM customer_otp_challenges
      WHERE phone = $1 AND resend_available_at > $2
    ) AS allowed
  `, [phone, new Date(now)]);
  return result.rows[0]?.allowed === true;
}

/** Атомарно резервирует отправку, чтобы параллельные запросы не списали деньги дважды. */
export async function reserveCode(phone: string, code: string, now = Date.now()): Promise<boolean> {
  const db = await ordersDatabasePool();
  const instant = new Date(now);
  const result = await db.query(`
    INSERT INTO customer_otp_challenges (
      phone, code_digest, state, expires_at, resend_available_at, attempts
    ) VALUES ($1, $2, 'pending', $3, $4, 0)
    ON CONFLICT (phone) DO UPDATE SET
      code_digest = EXCLUDED.code_digest,
      state = 'pending',
      expires_at = EXCLUDED.expires_at,
      resend_available_at = EXCLUDED.resend_available_at,
      attempts = 0,
      created_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE customer_otp_challenges.resend_available_at <= $5
       OR customer_otp_challenges.expires_at <= $5
    RETURNING phone
  `, [
    phone,
    digestCode(phone, code),
    new Date(now + TTL_MS),
    new Date(now + RESEND_MS),
    instant,
  ]);
  return result.rowCount === 1;
}

/** Код становится пригодным для входа только после успешного ответа SMS-шлюза. */
export async function activateCode(phone: string, code: string): Promise<boolean> {
  const db = await ordersDatabasePool();
  const result = await db.query(`
    UPDATE customer_otp_challenges
    SET state = 'active', updated_at = clock_timestamp()
    WHERE phone = $1 AND code_digest = $2 AND state = 'pending'
    RETURNING phone
  `, [phone, digestCode(phone, code)]);
  return result.rowCount === 1;
}

/** Освобождает резерв при ошибке шлюза, чтобы пользователь мог повторить отправку. */
export async function discardCode(phone: string, code: string): Promise<void> {
  const db = await ordersDatabasePool();
  await db.query(
    "DELETE FROM customer_otp_challenges WHERE phone = $1 AND code_digest = $2",
    [phone, digestCode(phone, code)],
  );
}

/** Keeps a failed provider reservation pending so retries cannot hammer a
 * temporarily blocked gateway. Pending codes are never accepted for login. */
export async function deferCode(phone: string, code: string, delayMs: number): Promise<void> {
  const boundedDelay = Math.max(RESEND_MS, Math.min(Math.trunc(delayMs), TTL_MS));
  const db = await ordersDatabasePool();
  await db.query(`
    UPDATE customer_otp_challenges
    SET resend_available_at = GREATEST(resend_available_at, $3),
        updated_at = clock_timestamp()
    WHERE phone = $1 AND code_digest = $2 AND state = 'pending'
  `, [phone, digestCode(phone, code), new Date(Date.now() + boundedDelay)]);
}

/** Validate an OTP without consuming it. Customer login consumes only after
 * Medusa has completed, so an upstream timeout does not burn a valid SMS. */
export async function validateCode(
  phone: string,
  code: string,
  now = Date.now(),
): Promise<{ ok: boolean; reason?: string }> {
  const db = await ordersDatabasePool();
  const result = await db.query<{
    code_digest: string;
    expires_at: Date | string;
    attempts: number;
  }>(`
    UPDATE customer_otp_challenges
    SET attempts = attempts + 1, updated_at = clock_timestamp()
    WHERE phone = $1 AND state = 'active'
    RETURNING code_digest, expires_at, attempts
  `, [phone]);
  const row = result.rows[0];
  if (!row) return { ok: false, reason: "no_code" };
  const expected = String(row.code_digest || "");
  if (new Date(row.expires_at).valueOf() < now) {
    await db.query(
      "DELETE FROM customer_otp_challenges WHERE phone = $1 AND code_digest = $2",
      [phone, expected],
    );
    return { ok: false, reason: "expired" };
  }
  if (Number(row.attempts) > MAX_ATTEMPTS) {
    await db.query(
      "DELETE FROM customer_otp_challenges WHERE phone = $1 AND code_digest = $2",
      [phone, expected],
    );
    return { ok: false, reason: "too_many" };
  }
  if (!equalDigest(expected, digestCode(phone, code.trim()))) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

export async function consumeCode(phone: string, code: string, now = Date.now()): Promise<boolean> {
  const db = await ordersDatabasePool();
  const result = await db.query(`
    DELETE FROM customer_otp_challenges
    WHERE phone = $1 AND code_digest = $2 AND state = 'active' AND expires_at >= $3
    RETURNING phone
  `, [phone, digestCode(phone, code.trim()), new Date(now)]);
  return result.rowCount === 1;
}

export async function checkCode(
  phone: string,
  code: string,
  now = Date.now(),
): Promise<{ ok: boolean; reason?: string }> {
  const checked = await validateCode(phone, code, now);
  if (checked.ok) await consumeCode(phone, code, now);
  return checked;
}

type SmsResult = { ok: boolean; error?: string; messageId?: string; retryAfter?: number };

export function smscResponseResult(
  httpOk: boolean,
  status: number,
  data: Record<string, unknown>,
): SmsResult {
  if (!httpOk || data.error || data.error_code) {
    const errorCode = data.error_code ? String(data.error_code).slice(0, 24) : null;
    return {
      ok: false,
      error: errorCode ? `smsc_${errorCode}` : `http_${status}`,
      ...(errorCode === "4" ? { retryAfter: 300 } : {}),
    };
  }
  if (data.id === undefined && data.cnt === undefined) {
    return { ok: false, error: "smsc_invalid_response" };
  }
  return { ok: true };
}

export function smscPasswordValue(encoded: string | undefined, fallback: string | undefined): string | undefined {
  const value = encoded?.trim();
  if (!value) return fallback;
  if (value.length > 16_384 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return undefined;
  const text = decoded.toString("utf8");
  if (!text || Buffer.from(text, "utf8").toString("base64") !== value) return undefined;
  return text;
}

export function p1smsDeliveryResponseResult(
  httpOk: boolean,
  status: number,
  data: unknown,
  expectedMessageId: string,
): SmsResult {
  if (!httpOk) return { ok: false, error: `http_${status}` };
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  const row = rows.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return String(record.sms_id ?? record.id ?? "") === expectedMessageId;
  });
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, error: "p1sms_status_missing" };
  }
  const record = row as Record<string, unknown>;
  const deliveryStatus = String(record.sms_status ?? record.status ?? "").toLowerCase();
  if (deliveryStatus === "sent" || deliveryStatus === "delivered") return { ok: true };
  return { ok: false, error: "p1sms_not_sent" };
}

export function p1smsResponseResult(
  httpOk: boolean,
  status: number,
  data: Record<string, unknown>,
): SmsResult {
  if (!httpOk) return { ok: false, error: `http_${status}` };
  if (data.status !== "success") return { ok: false, error: "p1sms_rejected" };

  const messages = Array.isArray(data.data) ? data.data : [];
  const first = messages[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return { ok: false, error: "p1sms_invalid_response" };
  }

  const message = first as Record<string, unknown>;
  const messageStatus = typeof message.status === "string" ? message.status.toLowerCase() : "";
  const messageErrors = message.errors;
  const hasErrors = Array.isArray(messageErrors)
    ? messageErrors.length > 0
    : messageErrors !== undefined && messageErrors !== null && messageErrors !== "";
  if (hasErrors || messageStatus === "error" || messageStatus === "not_sent") {
    return { ok: false, error: "p1sms_message_error" };
  }

  const messageId = message.id;
  const hasMessageId = (typeof messageId === "number" && Number.isFinite(messageId))
    || (typeof messageId === "string" && messageId.trim().length > 0);
  if (!hasMessageId || messageStatus !== "sent") {
    return { ok: false, error: "p1sms_invalid_response" };
  }
  return { ok: true, messageId: String(messageId) };
}

async function sendViaSmsc(phone: string, text: string): Promise<SmsResult> {
  const login = runtimeVariable("SMSC_LOGIN")?.trim();
  const password = smscPasswordValue(
    runtimeVariable("SMSC_PASSWORD_B64"),
    runtimeVariable("SMSC_PASSWORD"),
  );
  const apiKey = runtimeVariable("SMSC_API_KEY");
  if ((!login || !password) && !apiKey) return { ok: false, error: "smsc_credentials_missing" };

  const form = new URLSearchParams({
    phones: phone,
    mes: text,
    fmt: "3",
    charset: "utf-8",
  });
  if (apiKey) form.set("apikey", apiKey);
  else {
    form.set("login", login!);
    form.set("psw", password!);
  }
  const sender = runtimeVariable("SMSC_SENDER")?.trim();
  if (sender) form.set("sender", sender);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://smsc.kz/sys/send.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    return smscResponseResult(res.ok, res.status, data as Record<string, unknown>);
  } catch {
    return { ok: false, error: "smsc_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Legacy P1SMS adapter retained for rollback while SMSC.kz is the active provider. */
async function sendViaP1Sms(phone: string, text: string): Promise<SmsResult> {
  const apiKey = runtimeVariable("P1SMS_API_KEY");
  if (!apiKey) return { ok: false, error: "no_api_key" };
  const channel = runtimeVariable("P1SMS_CHANNEL") || "digit";
  const sender = runtimeVariable("P1SMS_SENDER");
  const sms: Record<string, unknown> = { channel, text, phone };
  if (sender && channel !== "digit") sms.sender = sender;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://admin.p1sms.kz/apiSms/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, sms: [sms] }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const created = p1smsResponseResult(res.ok, res.status, data as Record<string, unknown>);
    if (!created.ok || !created.messageId) return created;

    // P1SMS initially reports "sent" even when the message is moved to account
    // moderation a moment later. OTP must not become active until the status API
    // confirms that the message is still in the actual delivery pipeline.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const statusUrl = new URL("https://admin.p1sms.kz/apiSms/getSmsStatus");
    statusUrl.searchParams.set("apiKey", apiKey);
    statusUrl.searchParams.set("smsId[0]", created.messageId);
    const statusController = new AbortController();
    const statusTimeout = setTimeout(() => statusController.abort(), 5_000);
    try {
      const statusResponse = await fetch(statusUrl, { signal: statusController.signal });
      const statusData = await statusResponse.json().catch(() => [] as unknown[]);
      return p1smsDeliveryResponseResult(
        statusResponse.ok,
        statusResponse.status,
        statusData,
        created.messageId,
      );
    } catch {
      return { ok: false, error: "p1sms_status_unavailable" };
    } finally {
      clearTimeout(statusTimeout);
    }
  } catch {
    return { ok: false, error: "p1sms_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendSms(phone: string, text: string): Promise<SmsResult> {
  const provider = String(runtimeVariable("SMS_PROVIDER")
    || (runtimeVariable("SMSC_PASSWORD_B64") || runtimeVariable("SMSC_PASSWORD") || runtimeVariable("SMSC_API_KEY")
      ? "smsc"
      : "p1sms"))
    .trim()
    .toLowerCase();
  return provider === "smsc" ? sendViaSmsc(phone, text) : sendViaP1Sms(phone, text);
}
