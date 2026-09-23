"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { DEFAULT_CONTENT, normalizeContent, type Content, type Order } from "./defaults";
import { browserUuidV4 } from "@/lib/client-uuid";
import type { DeliveryDetails } from "@/lib/checkout/delivery-details";

// Реэкспорт модели, чтобы существующие импорты "@/lib/content/ContentContext" не ломались.
export { DEFAULT_CONTENT, ORDER_STATUSES, uid, normalizeContent } from "./defaults";
export type { Banner, Collection, Promo, Order, Story, QuickLink, Content } from "./defaults";

const KEY = "ass_web_cms_v1"; // локальный кэш для мгновенной отрисовки/офлайна
const TOKEN_KEY = "ass_admin_token";
// v1 could retain an unrecoverable pre-fix provider attempt in the browser and
// block every later checkout before a request reached the server. Keep the old
// record untouched for audit, but start the corrected flow with a fresh key.
const CHECKOUT_ATTEMPT_KEY = "ass_checkout_attempt_v3";

type CheckoutAttemptState = "pending" | "uncertain" | "created_without_link" | "redirected";
type StoredCheckoutAttempt = {
  key: string;
  cartInstanceId: string;
  requestHash: string;
  cartHash: string;
  state: CheckoutAttemptState;
  paymentSessionId?: string;
  updatedAt: number;
};

type NewOrder = Pick<Order, "sum" | "items"> & {
  delivery?: string;
  payment?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  pharmacyId?: string;
  pharmacyName?: string;
  pharmacyAddress?: string;
  quoteId?: string;
  fulfillment?: "warehouse" | "pharmacy" | "pickup";
  promoCode?: string;
  comment?: string;
  deliveryDetails?: DeliveryDetails;
  cartInstanceId: string;
  cartItems: { productId: string; variantId: string; quantity: number }[];
};
type Ctx = {
  content: Content;
  ready: boolean;
  save: (c: Content) => Promise<Content>;
  reset: () => Promise<Content>;
  addOrder: (o: NewOrder) => Promise<Order>;
};
const ContentCtx = createContext<Ctx | null>(null);

function readCheckoutAttempt(): StoredCheckoutAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKOUT_ATTEMPT_KEY) || "null") as Partial<StoredCheckoutAttempt> | null;
    if (!value || typeof value !== "object"
        || !value.key || !value.cartInstanceId || !value.requestHash || !value.cartHash
        || !["pending", "uncertain", "created_without_link", "redirected"].includes(String(value.state))
        || !Number.isFinite(value.updatedAt)) return null;
    const paymentSessionId = value.paymentSessionId == null
      ? null
      : safePaymentSessionId(value.paymentSessionId);
    if (value.paymentSessionId != null && !paymentSessionId) return null;
    return {
      ...value,
      ...(paymentSessionId ? { paymentSessionId } : {}),
    } as StoredCheckoutAttempt;
  } catch {
    return null;
  }
}

function writeCheckoutAttempt(value: StoredCheckoutAttempt): void {
  try { localStorage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify(value)); } catch {/* ignore */}
}

function clearCheckoutAttempt(key: string): void {
  try {
    if (readCheckoutAttempt()?.key === key) localStorage.removeItem(CHECKOUT_ATTEMPT_KEY);
  } catch {/* ignore */}
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safePaymentSessionId(value: unknown): string | null {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * Keep the hosted URL server-side and move to our same-origin payment guard.
 * The guard performs an authenticated same-origin POST and then transfers the
 * current tab to the hosted provider with a server-side 303 redirect.
 */
function redirectToHostedPayment(paymentSessionId: string): never {
  // A hard navigation intentionally transfers control from checkout state to
  // the isolated same-origin payment guard.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/payment/${encodeURIComponent(paymentSessionId)}`);
  throw new Error("payment_redirect");
}

async function recoverHostedPayment(attempt: StoredCheckoutAttempt): Promise<"not_found"> {
  let result: Response;
  try {
    result = await fetch("/api/checkout/recover", {
      method: "POST",
      headers: { "x-idempotency-key": attempt.key },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error("order_status_uncertain");
  }
  const payload = await result.json().catch(() => ({}));
  if (result.ok) {
    const paymentSessionId = safePaymentSessionId(payload?.paymentSessionId);
    if (!paymentSessionId) throw new Error("payment_link_unavailable");
    writeCheckoutAttempt({
      ...attempt,
      state: "redirected",
      paymentSessionId,
      updatedAt: Date.now(),
    });
    redirectToHostedPayment(paymentSessionId);
  }
  const code = typeof payload?.error === "string" ? payload.error : "checkout_recovery_unavailable";
  if (result.status === 404 && code === "checkout_attempt_not_found") return "not_found";
  if (code === "checkout_in_progress") throw new Error("order_status_uncertain");
  if (code === "authentication_required") throw new Error("daribar_auth_required");
  throw new Error(code);
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<Content>(DEFAULT_CONTENT);
  const [ready, setReady] = useState(false);
  const contentRef = useRef(content);
  // ref обновляем в эффекте (не во время рендера), чтобы addOrder видел свежий контент
  useEffect(() => { contentRef.current = content; }, [content]);

  useEffect(() => {
    // Стартуем с DEFAULT (совпадает с SSR — без рассинхрона гидрации), затем:
    // 1) мгновенно из локального кэша, чтобы не мигало правками админки.
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- кэш применяем после гидрации намеренно
      if (raw) setContent(normalizeContent(JSON.parse(raw)));
    } catch {/* ignore */}
    // 2) затем свежий контент с сервера (источник истины — общий для сайта и мобилки).
    let alive = true;
    fetch("/api/content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("content fetch failed"))))
      .then((j) => {
        if (!alive) return;
        const c = normalizeContent(j);
        setContent(c);
        try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {/* ignore */}
      })
      .catch(() => {/* офлайн — остаёмся на кэше/дефолте */})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  /** The shared server is authoritative: only publish/cache a confirmed save. */
  const persist = useCallback(async (c: Content): Promise<Content> => {
    let token = "";
    try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {/* ignore */}
    const response = await fetch("/api/content", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": token },
      body: JSON.stringify(c),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `content_save_${response.status}`;
      throw new Error(code);
    }
    const saved = normalizeContent(payload);
    setContent(saved);
    contentRef.current = saved;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {/* ignore */}
    return saved;
  }, []);

  const reset = useCallback(() => persist(DEFAULT_CONTENT), [persist]);

  const addOrder = useCallback(async (o: NewOrder): Promise<Order> => {
    const requestHash = await sha256(o);
    const cartHash = await sha256(
      [...o.cartItems]
        .map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }))
        .sort((left, right) => `${left.productId}:${left.variantId}`.localeCompare(`${right.productId}:${right.variantId}`)),
    );
    const previous = readCheckoutAttempt();
    let recoverableAttempt: StoredCheckoutAttempt | null = null;
    if (previous?.cartInstanceId === o.cartInstanceId) {
      if (previous.cartHash !== cartHash) {
        throw new Error("checkout_attempt_conflict");
      }
      if (previous.state === "redirected") {
        const paymentSessionId = safePaymentSessionId(previous.paymentSessionId);
        if (paymentSessionId) {
          // Ask the server to validate ownership and renew an expired internal
          // session for the same provider order. This never creates a duplicate
          // Daribar order and avoids blindly posting a stale browser UUID.
          const recovered = await recoverHostedPayment(previous);
          if (recovered === "not_found") throw new Error("order_status_uncertain");
        }
        throw new Error("order_already_created");
      }
      if (previous.state === "created_without_link") throw new Error("payment_link_unavailable");
      if (previous.state === "pending" || previous.state === "uncertain") {
        // Recover by the original key before comparing a refreshed quote ID.
        // This is a read-only server lookup and can never create a second order.
        await recoverHostedPayment(previous);
        recoverableAttempt = { ...previous, requestHash, cartHash };
      } else if (previous.requestHash !== requestHash) {
        throw new Error("checkout_attempt_conflict");
      }
    }
    const attempt: StoredCheckoutAttempt = recoverableAttempt
      ? { ...recoverableAttempt, state: "pending", updatedAt: Date.now() }
      : {
          key: browserUuidV4(),
          cartInstanceId: o.cartInstanceId,
          requestHash,
          cartHash,
          state: "pending",
          updatedAt: Date.now(),
        };
    writeCheckoutAttempt(attempt);
    let r: Response;
    try {
      r = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": attempt.key,
          "x-cart-instance-id": o.cartInstanceId,
        },
        body: JSON.stringify(o),
      });
    } catch {
      writeCheckoutAttempt({ ...attempt, state: "uncertain", updatedAt: Date.now() });
      throw new Error("order_status_uncertain");
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 202 && data?.requiresAction) {
      const paymentSessionId = safePaymentSessionId(data?.paymentSessionId);
      if (!paymentSessionId) {
        writeCheckoutAttempt({ ...attempt, state: "created_without_link", updatedAt: Date.now() });
        throw new Error("payment_link_unavailable");
      }
      writeCheckoutAttempt({
        ...attempt,
        state: "redirected",
        paymentSessionId,
        updatedAt: Date.now(),
      });
      redirectToHostedPayment(paymentSessionId);
    }
    if (!r.ok) {
      const code = typeof data?.error === "string" ? data.error : "order_create_failed";
      if (code === "order_status_uncertain" || code === "checkout_in_progress"
          || code === "checkout_attempt_conflict" || data?.recovery === "check_orders"
          || data?.orderCreated === true) {
        writeCheckoutAttempt({ ...attempt, state: "uncertain", updatedAt: Date.now() });
      } else if (code === "payment_link_unavailable") {
        writeCheckoutAttempt({ ...attempt, state: "created_without_link", updatedAt: Date.now() });
      } else {
        clearCheckoutAttempt(attempt.key);
      }
      throw new Error(code === "checkout_in_progress" ? "order_status_uncertain" : code);
    }
    if (!data?.order) {
      writeCheckoutAttempt({ ...attempt, state: "uncertain", updatedAt: Date.now() });
      throw new Error("order_status_uncertain");
    }
    clearCheckoutAttempt(attempt.key);
    const order = data.order as Order;
    setContent((prev) => {
      const next: Content = { ...prev, orders: [order, ...prev.orders.filter((x) => x.id !== order.id)] };
      contentRef.current = next;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {/* ignore */}
      return next;
    });
    return order;
  }, []);

  return <ContentCtx.Provider value={{ content, ready, save: persist, reset, addOrder }}>{children}</ContentCtx.Provider>;
}

export function useContent() {
  const c = useContext(ContentCtx);
  if (!c) throw new Error("useContent must be used within <ContentProvider>");
  return c;
}
