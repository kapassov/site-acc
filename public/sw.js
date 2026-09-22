/* global clients */

const DEFAULT_ICON = "/icons/icon-192.png";
const DEFAULT_BADGE = "/icons/icon-192.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

function notificationUrl(payload) {
  const candidate = payload.url || payload.deepLink || payload.data?.url || "/";
  try {
    const url = new URL(candidate, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin;
  } catch {
    return self.location.origin;
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const url = notificationUrl(payload);
  const title = String(payload.title || "Аптека со склада");
  const options = {
    body: String(payload.body || "У вас новое уведомление"),
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_BADGE,
    image: payload.image || undefined,
    tag: payload.tag || undefined,
    requireInteraction: Boolean(payload.requireInteraction),
    silent: Boolean(payload.silent),
    data: { ...data, url },
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = notificationUrl({ data: event.notification.data || {} });

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const target = new URL(targetUrl);
      for (const client of windows) {
        const current = new URL(client.url);
        if (current.origin !== target.origin) continue;
        if ("navigate" in client && client.url !== target.href) await client.navigate(target.href);
        return client.focus();
      }
      return clients.openWindow(target.href);
    }),
  );
});
