"use client";

import { analyticsPath } from "./path";

export type AnalyticsEventName =
  | "page_viewed"
  | "search_performed"
  | "category_viewed"
  | "filter_applied"
  | "product_viewed"
  | "cart_item_added"
  | "cart_item_removed"
  | "checkout_started"
  | "delivery_city_compared"
  | "delivery_city_option_selected"
  | "order_submitted"
  | "order_confirmed"
  | "web_vital";

type EventProperties = Record<string, string | number | boolean | null | undefined>;

function storedId(storage: Storage, key: string, prefix: string): string {
  const current = storage.getItem(key);
  if (current) return current;
  const id = `${prefix}_${crypto.randomUUID()}`;
  storage.setItem(key, id);
  return id;
}

export function trackEvent(name: AnalyticsEventName, properties: EventProperties = {}): void {
  if (typeof window === "undefined") return;
  try {
    const anonymousId = storedId(window.localStorage, "inkar-anonymous-id", "anon");
    const sessionId = storedId(window.sessionStorage, "inkar-session-id", "session");
    const event = {
      idempotencyKey: `evt_${crypto.randomUUID()}`,
      name,
      source: "web",
      version: 1,
      occurredAt: new Date().toISOString(),
      anonymousId,
      sessionId,
      properties,
      context: {
        path: analyticsPath(window.location.pathname),
        viewportWidth: window.innerWidth,
      },
      consent: {},
    };
    const body = JSON.stringify({ events: [event] });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Аналитика не должна влиять на покупку, даже если storage/CDP недоступны.
  }
}
