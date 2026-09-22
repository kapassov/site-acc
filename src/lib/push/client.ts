"use client";

export type PushPreferences = { orders: boolean; promos: boolean };
export type PushDeviceCredentials = { deviceId: string | null; deviceToken: string | null };
export type PushClientState = PushDeviceCredentials & {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscription: PushSubscription | null;
  preferences: PushPreferences;
};

type PushConfigResponse = {
  enabled?: boolean;
  publicKey?: string;
  vapidPublicKey?: string;
  applicationServerKey?: string;
};
type SubscriptionResponse = { deviceId?: string | null; deviceToken?: string | null };

const PREFERENCES_KEY = "inkar-push-preferences-v1";
const DEVICE_ID_KEY = "inkar-push-device-id-v1";
const DEVICE_TOKEN_KEY = "inkar-push-device-token-v1";

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = { orders: true, promos: false };

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage restrictions must not break checkout or navigation.
  }
}

export function readPushPreferences(): PushPreferences {
  if (typeof window === "undefined") return DEFAULT_PUSH_PREFERENCES;
  try {
    const parsed = JSON.parse(readStorage(PREFERENCES_KEY) || "null") as Partial<PushPreferences> | null;
    return { orders: parsed?.orders !== false, promos: parsed?.promos === true };
  } catch { return DEFAULT_PUSH_PREFERENCES; }
}

export function storePushPreferences(preferences: PushPreferences): void {
  if (typeof window !== "undefined") writeStorage(PREFERENCES_KEY, JSON.stringify(preferences));
}

export function readPushDeviceCredentials(): PushDeviceCredentials {
  if (typeof window === "undefined") return { deviceId: null, deviceToken: null };
  return { deviceId: readStorage(DEVICE_ID_KEY), deviceToken: readStorage(DEVICE_TOKEN_KEY) };
}

function storePushDeviceCredentials(response: SubscriptionResponse): PushDeviceCredentials {
  const current = readPushDeviceCredentials();
  const next = {
    deviceId: response.deviceId === undefined ? current.deviceId : response.deviceId,
    deviceToken: response.deviceToken === undefined ? current.deviceToken : response.deviceToken,
  };
  writeStorage(DEVICE_ID_KEY, next.deviceId);
  writeStorage(DEVICE_TOKEN_KEY, next.deviceToken);
  return next;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `push_request_${response.status}`);
  return data;
}

async function fetchPushConfig(): Promise<{ enabled: boolean; publicKey: string }> {
  const config = await jsonRequest<PushConfigResponse>("/api/push/config");
  const publicKey = config.publicKey || config.vapidPublicKey || config.applicationServerKey || "";
  return { enabled: config.enabled !== false && Boolean(publicKey), publicKey };
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) throw new Error("push_unsupported");
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export async function loadPushClientState(): Promise<PushClientState> {
  const preferences = readPushPreferences();
  const credentials = readPushDeviceCredentials();
  if (!isPushSupported()) return { supported: false, permission: "unsupported", subscription: null, preferences, ...credentials };
  const registration = await registerPushServiceWorker();
  return {
    supported: true,
    permission: Notification.permission,
    subscription: await registration.pushManager.getSubscription(),
    preferences,
    ...credentials,
  };
}

function subscriptionBody(subscription: PushSubscription, preferences: PushPreferences) {
  return { subscription: subscription.toJSON(), preferences, ...readPushDeviceCredentials() };
}

export async function subscribeToPush(preferences: PushPreferences): Promise<{ subscription: PushSubscription; credentials: PushDeviceCredentials }> {
  if (!isPushSupported()) throw new Error("push_unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "push_denied" : "push_not_granted");
  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) throw new Error("push_disabled");

  const registration = await registerPushServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  const createdNow = !subscription;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
  }
  try {
    const response = await jsonRequest<SubscriptionResponse>("/api/push/subscriptions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscriptionBody(subscription, preferences)),
    });
    storePushPreferences(preferences);
    return { subscription, credentials: storePushDeviceCredentials(response) };
  } catch (error) {
    if (createdNow) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

export async function syncPushPreferences(preferences: PushPreferences): Promise<PushDeviceCredentials> {
  if (!isPushSupported()) throw new Error("push_unsupported");
  const registration = await registerPushServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) { storePushPreferences(preferences); return readPushDeviceCredentials(); }
  const response = await jsonRequest<SubscriptionResponse>("/api/push/subscriptions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscriptionBody(subscription, preferences)),
  });
  storePushPreferences(preferences);
  return storePushDeviceCredentials(response);
}

export async function unsubscribeFromPush(preferences: PushPreferences): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await registerPushServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  let serverError: unknown = null;
  try {
    const response = await jsonRequest<SubscriptionResponse>("/api/push/subscriptions", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(subscriptionBody(subscription, preferences)),
    });
    storePushDeviceCredentials(response);
  } catch (error) { serverError = error; }
  await subscription.unsubscribe();
  if (serverError) throw serverError;
}

export async function sendPushEvent(event: string, payload: Record<string, unknown> = {}): Promise<void> {
  const name = event.trim();
  if (!name) throw new Error("push_event_required");
  await jsonRequest<{ ok?: boolean }>("/api/push/event", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: name, payload, ...readPushDeviceCredentials() }),
  });
}
