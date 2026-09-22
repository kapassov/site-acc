import { randomUUID, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { applyDeliveryResults } from "./store";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";
import type {
  DeliveryResult,
  DeliverySummary,
  PushNotificationPayload,
  StoredPushSubscription,
} from "./types";

export interface PushMessageInput {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  icon?: unknown;
  badge?: unknown;
  image?: unknown;
  tag?: unknown;
  orderNumber?: unknown;
  status?: unknown;
}

type PrivatePushConfig = {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  subject: string;
};

function privateConfig(): PrivatePushConfig {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "";
  return {
    enabled: Boolean(publicKey && privateKey && /^(mailto:|https:\/\/)/i.test(subject)),
    publicKey,
    privateKey,
    subject,
  };
}

export function publicPushConfig(): {
  enabled: boolean;
  publicKey: string;
} {
  const config = privateConfig();
  return { enabled: config.enabled, publicKey: config.enabled ? config.publicKey : "" };
}

function equalSecrets(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function adminAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN || "";
  const actual = req.headers.get("x-admin-token") || "";
  return Boolean(isStrongRuntimeSecret(expected) && actual && equalSecrets(actual, expected));
}

function text(value: unknown, fallback: string, max: number): string {
  const normalized = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return (normalized || fallback).slice(0, max);
}

function optionalText(value: unknown, max: number): string | undefined {
  const normalized = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return normalized ? normalized.slice(0, max) : undefined;
}

function relativeUrl(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.length > 500) return fallback;
  return candidate;
}

function assetUrl(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.length > 500) return fallback;
  return candidate;
}

function topic(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value : fallback;
  const safe = candidate.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  return safe || "inkar-notification";
}

export function createPushPayload(
  type: string,
  input: PushMessageInput,
  defaults: { title: string; body: string; url?: string; tag?: string },
  id = randomUUID(),
): PushNotificationPayload {
  const createdAt = new Date().toISOString();
  return {
    id,
    type: text(type, "notification", 80),
    title: text(input.title, defaults.title, 100),
    body: text(input.body, defaults.body, 240),
    url: relativeUrl(input.url, defaults.url || "/"),
    icon: assetUrl(input.icon, "/favicon.ico"),
    badge: assetUrl(input.badge, "/favicon.ico"),
    image: assetUrl(input.image),
    tag: topic(input.tag, defaults.tag || type),
    orderNumber: optionalText(input.orderNumber, 80),
    status: optionalText(input.status, 80),
    createdAt,
  };
}

function errorStatus(error: unknown): number {
  if (error instanceof webpush.WebPushError) return error.statusCode;
  if (error && typeof error === "object" && "statusCode" in error) {
    const status = Number((error as { statusCode?: unknown }).statusCode);
    return Number.isFinite(status) ? status : 0;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "push delivery failed";
}

async function deliverOne(
  target: StoredPushSubscription,
  payload: PushNotificationPayload,
  config: PrivatePushConfig,
): Promise<DeliveryResult> {
  try {
    const result = await webpush.sendNotification(
      target.subscription,
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: payload.type.startsWith("order.") ? 86_400 : 3_600,
        urgency: payload.type.startsWith("order.") ? "high" : "normal",
        topic: topic(payload.tag, payload.type),
        timeout: 10_000,
      },
    );
    return {
      endpoint: target.subscription.endpoint,
      ok: true,
      statusCode: result.statusCode,
      revoked: false,
    };
  } catch (error) {
    const statusCode = errorStatus(error);
    return {
      endpoint: target.subscription.endpoint,
      ok: false,
      statusCode,
      error: errorMessage(error),
      revoked: statusCode === 404 || statusCode === 410,
    };
  }
}

export class PushNotConfiguredError extends Error {
  constructor() {
    super("Web Push VAPID is not configured");
    this.name = "PushNotConfiguredError";
  }
}

export async function sendToSubscribers(
  targets: StoredPushSubscription[],
  payload: PushNotificationPayload,
): Promise<{ summary: DeliverySummary; results: DeliveryResult[] }> {
  const config = privateConfig();
  if (!config.enabled) throw new PushNotConfiguredError();

  const uniqueTargets = [...new Map(targets.map((target) => [target.subscription.endpoint, target])).values()];
  const results: DeliveryResult[] = [];
  const batchSize = 20;
  for (let index = 0; index < uniqueTargets.length; index += batchSize) {
    const batch = uniqueTargets.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map((target) => deliverOne(target, payload, config))));
  }
  await applyDeliveryResults(results);

  return {
    summary: {
      targets: results.length,
      sent: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      revoked: results.filter((result) => result.revoked).length,
    },
    results,
  };
}
