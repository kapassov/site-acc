import crypto from "node:crypto";
import { isStrongRuntimeSecret } from "./serverSecrets.ts";

export type CustomerAuthMode = "sms" | "demo";

export type DemoIdentity = {
  email: string;
  password: string;
  phone: string;
  sessionHash: string;
};

const DEMO_EMAIL_DOMAIN = "demo.darihana.kz";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTALL_ID_RE = /^(?=.{20,128}$)(?=.*[A-Za-z])[A-Za-z0-9_-]+$/;

/**
 * Customer authentication is production-only now. Keep the legacy `demo`
 * type and helpers temporarily so old stored orders remain readable, but an
 * environment variable can no longer switch the live storefront into a fake
 * registration or checkout flow.
 */
export function customerAuthMode(): CustomerAuthMode {
  return "sms";
}

function requireSecret(secret: string): string {
  if (!isStrongRuntimeSecret(secret)) throw new Error("CUSTOMER_AUTH_SECRET is not securely configured");
  return secret;
}

function signDemoSession(sessionId: string, secret: string): string {
  return crypto
    .createHmac("sha256", requireSecret(secret))
    .update(`demo-session:${sessionId}`)
    .digest("base64url")
    .slice(0, 32);
}

/** A signed, per-browser identifier. It contains no Medusa token or customer data. */
export function createDemoSession(secret: string): string {
  const sessionId = crypto.randomUUID();
  return `${sessionId}.${signDemoSession(sessionId, secret)}`;
}

/** Random, non-PII app installation identifier: 20-128 ASCII letters/digits/_/-. */
export function isValidDemoInstallId(value: unknown): value is string {
  return typeof value === "string" && INSTALL_ID_RE.test(value);
}

/** Stable signed session for native apps. The raw installId is never persisted in Medusa. */
export function createDemoSessionForInstallId(installId: string, secret: string): string {
  if (!isValidDemoInstallId(installId)) throw new Error("Invalid demo install id");
  const hex = crypto
    .createHmac("sha256", requireSecret(secret))
    .update(`demo-install:${installId}`)
    .digest("hex")
    .slice(0, 32);
  const variant = (8 + (Number.parseInt(hex[16], 16) % 4)).toString(16);
  const sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return `${sessionId}.${signDemoSession(sessionId, secret)}`;
}

export function readDemoSession(value: string | null | undefined, secret: string): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const sessionId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!UUID_RE.test(sessionId) || !signature) return null;
  try {
    const expected = signDemoSession(sessionId, secret);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes)
      ? sessionId
      : null;
  } catch {
    return null;
  }
}

/** Stable, isolated Medusa credentials for one signed demo session. */
export function demoIdentity(sessionId: string, secret: string): DemoIdentity {
  if (!UUID_RE.test(sessionId)) throw new Error("Invalid demo session");
  const key = requireSecret(secret);
  const digest = crypto.createHmac("sha256", key).update(`demo-identity:${sessionId}`).digest();
  const sessionHash = digest.toString("hex").slice(0, 24);
  const phoneNumber = BigInt(`0x${digest.subarray(0, 8).toString("hex")}`) % BigInt("10000000000");
  const password = crypto
    .createHmac("sha256", key)
    .update(`demo-password:${sessionId}`)
    .digest("base64url")
    .slice(0, 30);

  return {
    email: `demo-${sessionHash}@${DEMO_EMAIL_DOMAIN}`,
    password: `D!${password}`,
    phone: `7${phoneNumber.toString().padStart(10, "0")}`,
    sessionHash,
  };
}

/** Demo privileges require both the Medusa marker and the server-signed browser/app session. */
export function matchesDemoCustomer(
  customer: { email?: unknown; metadata?: Record<string, unknown> } | null | undefined,
  signedSession: string | null | undefined,
  secret: string,
): boolean {
  const sessionId = readDemoSession(signedSession, secret);
  if (!sessionId || customer?.metadata?.demo_customer !== true) return false;
  const identity = demoIdentity(sessionId, secret);
  return customer.email === identity.email && customer.metadata.demo_session_hash === identity.sessionHash;
}

export function isSyntheticCustomerEmail(email?: string | null): boolean {
  return Boolean(email && (email.endsWith("@phone.darihana.kz") || email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)));
}
