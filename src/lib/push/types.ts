export type PushAudience = "all" | "promos" | "orders";

export type PushEventName = "order.created" | "app.download_interest" | "test";

export type NotificationKind = "campaign" | "event" | "order-status";

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPreferences {
  orders: boolean;
  promos: boolean;
}

/**
 * Server-only representation. `deviceTokenHash` is a SHA-256 digest; the raw
 * device token is returned to the browser once and is never persisted.
 */
export interface StoredPushSubscription {
  id: string;
  deviceId: string;
  /** Medusa customer that authenticated this device. Missing on legacy guest records. */
  customerId?: string;
  deviceTokenHash: string;
  subscription: BrowserPushSubscription;
  preferences: PushPreferences;
  locale?: string;
  city?: string;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  failureCount: number;
  revokedAt?: string;
  revokeReason?: string;
}

export interface OrderPushBinding {
  orderNumber: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PushNotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  orderNumber?: string;
  status?: string;
  createdAt: string;
}

export interface DeliverySummary {
  targets: number;
  sent: number;
  failed: number;
  revoked: number;
}

export interface DeliveryResult {
  endpoint: string;
  ok: boolean;
  statusCode: number;
  error?: string;
  revoked: boolean;
}

export interface NotificationHistoryEntry {
  id: string;
  kind: NotificationKind;
  event?: PushEventName;
  audience?: PushAudience;
  orderNumber?: string;
  orderStatus?: string;
  payload: PushNotificationPayload;
  delivery: DeliverySummary;
  createdAt: string;
}

export interface PushStoreData {
  version: 1;
  updatedAt: string;
  subscriptions: StoredPushSubscription[];
  orderBindings: OrderPushBinding[];
  history: NotificationHistoryEntry[];
}

export interface PushStoreStats {
  subscriptions: {
    total: number;
    active: number;
    revoked: number;
    orders: number;
    promos: number;
  };
  orderBindings: number;
  history: number;
  deliveries: {
    sent: number;
    failed: number;
    revoked: number;
  };
}
