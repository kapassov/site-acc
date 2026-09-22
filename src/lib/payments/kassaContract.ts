import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { kztMinorUnits } from "../money.ts";

const DEFAULT_HOST = "https://api.kassa.com";
const KNOWN_STATUSES = new Set([
  "init", "process", "successful", "wait_capture", "canceled", "error",
  "refund", "refund_process", "refund_error",
]);
const KNOWN_NOTIFICATION_TYPES = new Set([
  "check", "pay", "cancel", "error", "refund", "wait_capture",
]);

export type KassaEnv = Record<string, string | undefined>;
export type KassaConfig = {
  host: string;
  apiKey: string;
  notificationKey: string;
  projectId: number;
  publicOrigin: string;
  returnSecret: string;
  testMode: boolean;
};
export type KassaNotification = {
  id: number | string;
  partner_payment_id?: string;
  token: string;
  status: string;
  notification_type: string;
  order: { amount: number; currency: string };
  is_test?: boolean;
  status_description?: string;
};

function origin(value: string, field: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(`${field}_https_required`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error(`${field}_origin_required`);
  }
  return url.origin;
}

export function kassaEnabled(env: KassaEnv = process.env): boolean {
  return env.KASSA_ENABLED === "true";
}

export function kassaConfig(env: KassaEnv = process.env): KassaConfig {
  if (!kassaEnabled(env)) throw new Error("kassa_disabled");
  const apiKey = String(env.KASSA_API_KEY || "").trim();
  const notificationKey = String(env.KASSA_NOTIFICATION_API_KEY || "").trim();
  const projectId = Number(env.KASSA_PROJECT_ID);
  const returnSecret = String(env.KASSA_RETURN_SECRET || env.CUSTOMER_AUTH_SECRET || "").trim();
  if (!/^[^:\s]+:.{16,}$/.test(apiKey)) throw new Error("kassa_api_key_invalid");
  if (notificationKey.length < 16) throw new Error("kassa_notification_key_invalid");
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("kassa_project_id_invalid");
  if (returnSecret.length < 32) throw new Error("kassa_return_secret_invalid");
  return {
    host: origin(String(env.KASSA_HOST || DEFAULT_HOST), "kassa_host"),
    apiKey,
    notificationKey,
    projectId,
    publicOrigin: origin(String(env.KASSA_PUBLIC_ORIGIN || ""), "kassa_public_origin"),
    returnSecret,
    testMode: env.KASSA_TEST_MODE === "true",
  };
}

export function kassaReturnToken(orderId: string, secret: string): string {
  return createHmac("sha256", secret).update(`kassa-return\n${orderId}`).digest("base64url");
}

export function verifyKassaReturnToken(orderId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(kassaReturnToken(orderId, secret));
  const actual = Buffer.from(String(token || ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyKassaNotification(rawBody: string, signature: string, apiKey: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(createHash("sha256").update(rawBody + apiKey).digest("hex"));
  const actual = Buffer.from(signature.toLowerCase());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseKassaNotification(value: unknown): KassaNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("kassa_notification_invalid");
  const body = value as Record<string, unknown>;
  const order = body.order as Record<string, unknown> | undefined;
  const status = String(body.status || "");
  const notificationType = String(body.notification_type || "");
  const amount = Number(order?.amount);
  const currency = String(order?.currency || "").toUpperCase();
  const token = String(body.token || "");
  if (!KNOWN_STATUSES.has(status) || !KNOWN_NOTIFICATION_TYPES.has(notificationType)
      || kztMinorUnits(amount) === null || amount <= 0 || !/^[A-Z]{3}$/.test(currency)
      || token.length < 8 || token.length > 512) {
    throw new Error("kassa_notification_invalid");
  }
  const parsed: KassaNotification = {
    id: typeof body.id === "number" || typeof body.id === "string" ? body.id : "",
    partner_payment_id: body.partner_payment_id ? String(body.partner_payment_id).slice(0, 256) : undefined,
    token,
    status,
    notification_type: notificationType,
    order: { amount, currency },
    status_description: body.status_description ? String(body.status_description).slice(0, 500) : undefined,
  };
  if (typeof body.is_test === "boolean") parsed.is_test = body.is_test;
  return parsed;
}

export function kassaPaymentState(status: string): "pending" | "paid" | "authorized" | "failed" | "refunded" {
  if (status === "successful") return "paid";
  if (status === "wait_capture") return "authorized";
  if (status === "refund") return "refunded";
  if (status === "canceled" || status === "error") return "failed";
  return "pending";
}
