"use client";

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode,
} from "react";
import { formatPhone } from "@/lib/phone";
import { normalizeOtpPhone } from "@/lib/otpContract";
import { requestAuthJson } from "@/lib/auth/clientRequest";

export type Level = "Bronze" | "Silver" | "Gold" | "Platinum";
export type AuthMode = "loading" | "sms";

export interface User {
  name: string;
  phone: string;
  email?: string;
  bonus?: number;
  level?: Level;
  profileComplete?: boolean;
  /** Kept for compatibility with old checkout data. New sessions are never demo sessions. */
  demo?: boolean;
}

export interface PhoneAuthResult {
  error: AuthClientError | null;
  needsProfile: boolean;
}

export type AuthClientError =
  | "bad_phone"
  | "invalid_code"
  | "expired_code"
  | "too_many_requests"
  | "sms_unavailable"
  | "auth_unavailable"
  | "profile_unavailable"
  | "bad_name"
  | "session_expired"
  | "save_failed"
  | "network_failed";

interface AuthContextValue {
  user: User | null;
  authMode: AuthMode;
  isModalOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  /** Вход или регистрация после подтверждения номера одноразовым кодом Daribar. */
  continueWithPhone: (contact: string, code: string, options?: { signal?: AbortSignal }) => Promise<PhoneAuthResult>;
  logout: () => void;
  updateProfile: (patch: Partial<Pick<User, "name" | "email">>, options?: { signal?: AbortSignal }) => Promise<AuthClientError | null>;
  addresses: string[];
  addAddress: (a: string) => void;
  removeAddress: (i: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = "inkar-user-v1"; // только оптимистичный кэш для мгновенной отрисовки; истина — на сервере
const ADDR_KEY = "inkar-addr-v1";

/** DTO сервера (/api/customer) → доменный User (телефон форматируем для показа). */
function toUser(d: unknown): User | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  // Do not revive obsolete demo identities from the optimistic local cache.
  if (o.demo === true) return null;
  const phone = typeof o.phone === "string" && o.phone ? formatPhone(o.phone) : "";
  const bonus = typeof o.bonus === "number" && Number.isFinite(o.bonus) ? o.bonus : undefined;
  const level = ["Bronze", "Silver", "Gold", "Platinum"].includes(String(o.level))
    ? o.level as Level
    : undefined;
  return {
    name: typeof o.name === "string" ? o.name.trim() : "",
    phone,
    email: typeof o.email === "string" && o.email ? o.email : undefined,
    ...(bonus === undefined ? {} : { bonus }),
    ...(level === undefined ? {} : { level }),
    ...(typeof o.profileComplete === "boolean" ? { profileComplete: o.profileComplete } : {}),
  };
}

function authError(error: unknown, status: number): AuthClientError {
  const code = typeof error === "string" ? error : "";
  if (code === "bad_code" || code === "invalid_code") return "invalid_code";
  if (code === "expired_code") return "expired_code";
  if (code === "bad_phone") return "bad_phone";
  if (code === "too_many_requests" || status === 429) return "too_many_requests";
  if (code === "provider_unavailable" || code === "provider_timeout" || code === "otp_unavailable") return "sms_unavailable";
  return "auth_unavailable";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [addressIds, setAddressIds] = useState<string[]>([]);
  const [isModalOpen, setOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("loading");
  const [hydrated, setHydrated] = useState(false);
  const sessionRevisionRef = useRef(0);
  const hydrationAbortRef = useRef<AbortController | null>(null);
  const pendingLogoutRef = useRef<Promise<boolean> | null>(null);

  // Оптимистичная отрисовка из кэша, затем сверка с сервером (актуальные баллы/уровень или разлогин).
  useEffect(() => {
    const revision = sessionRevisionRef.current;
    const controller = new AbortController();
    hydrationAbortRef.current = controller;
    /* eslint-disable react-hooks/set-state-in-effect -- разовая гидратация после маунта */
    try {
      const u = localStorage.getItem(USER_KEY);
      if (u) setUser(toUser(JSON.parse(u)));
      const a = localStorage.getItem(ADDR_KEY);
      if (a) setAddresses(JSON.parse(a));
    } catch { /* ignore */ }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      try {
        const { response: r, payload: m } = await requestAuthJson("/api/customer", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAuthMode("sms");
        if (revision !== sessionRevisionRef.current) return;
        if (!r.ok || m?.transient) return; // бэк недоступен — оставляем кэш, не разлогиниваем
        const verifiedUser = toUser(m?.user);
        setUser(verifiedUser
          ? { ...verifiedUser, profileComplete: m?.profileComplete !== false }
          : null);
      } catch {
        // Серверный default — sms. При офлайне вход всё равно недоступен, но UI не зависает в loading.
        if (!controller.signal.aborted) setAuthMode("sms");
      }
    })();
    fetch("/api/customer/addresses", { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted || revision !== sessionRevisionRef.current) return;
        const list = Array.isArray(data?.addresses) ? data.addresses : [];
        setAddresses(list.map((item: { label?: string }) => String(item.label || "")).filter(Boolean));
        setAddressIds(list.map((item: { id?: string }) => String(item.id || "")));
      })
      .catch(() => { /* офлайн — локальный кэш остаётся */ });
    return () => controller.abort();
  }, []);

  // Кэшируем профиль для мгновенной отрисовки при следующем заходе.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
  }, [user, hydrated]);

  useEffect(() => {
    if (hydrated) {
      try { localStorage.setItem(ADDR_KEY, JSON.stringify(addresses)); } catch { /* ignore */ }
    }
  }, [addresses, hydrated]);

  // Код проверяется сервером через Daribar; access/refresh остаются только в httpOnly-cookie.
  const continueWithPhone = useCallback(
    async (contact: string, code: string, options: { signal?: AbortSignal } = {}): Promise<PhoneAuthResult> => {
      const digits = normalizeOtpPhone(contact);
      if (digits.length !== 11) return { error: "bad_phone", needsProfile: false };
      const revision = ++sessionRevisionRef.current;
      hydrationAbortRef.current?.abort();
      setAuthMode("sms");
      try {
        // A delayed logout response clears its cookie even if React ignores
        // the response. Finish that bounded request before creating a session.
        const pendingLogout = pendingLogoutRef.current;
        if (pendingLogout && !await pendingLogout) return { error: "auth_unavailable", needsProfile: false };
        if (options.signal?.aborted || revision !== sessionRevisionRef.current) return { error: "network_failed", needsProfile: false };
        const { response: r, payload: m } = await requestAuthJson("/api/customer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: options.signal,
          body: JSON.stringify({ action: "continue", phone: digits, code }),
        });
        if (options.signal?.aborted || revision !== sessionRevisionRef.current) return { error: "network_failed", needsProfile: false };
        if (r.ok && m?.user) {
          const nextUser = toUser(m.user);
          if (!nextUser) return { error: "profile_unavailable", needsProfile: false };
          const blankName = !nextUser.name || nextUser.name.toLocaleLowerCase("ru-RU") === "гость";
          const needsProfile = m?.profileComplete === false || m?.userInfoFilled === false || blankName;
          setUser({ ...nextUser, profileComplete: !needsProfile });
          if (!needsProfile) setOpen(false);
          return { error: null, needsProfile };
        }
        return { error: authError(m?.error, r.status), needsProfile: false };
      } catch {
        return { error: "network_failed", needsProfile: false };
      }
    },
    [],
  );

  const logout = useCallback(() => {
    sessionRevisionRef.current += 1;
    hydrationAbortRef.current?.abort();
    setAuthMode("sms");
    setUser(null);
    setAddresses([]);
    setAddressIds([]);
    if (pendingLogoutRef.current) return;
    const pendingLogout = requestAuthJson("/api/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    }).then(({ response }) => response.ok).catch(() => false);
    pendingLogoutRef.current = pendingLogout;
    void pendingLogout.finally(() => {
      if (pendingLogoutRef.current === pendingLogout) pendingLogoutRef.current = null;
    });
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "name" | "email">>, options: { signal?: AbortSignal } = {}): Promise<AuthClientError | null> => {
      if (!user || pendingLogoutRef.current) return "session_expired";
      const revision = ++sessionRevisionRef.current;
      hydrationAbortRef.current?.abort();
      setAuthMode("sms");
      const previous = user;
      try {
        const { response: r, payload: m } = await requestAuthJson("/api/customer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: options.signal,
          body: JSON.stringify({ action: "update", ...patch }),
        });
        if (options.signal?.aborted || revision !== sessionRevisionRef.current) return "network_failed";
        if (r.ok && m?.user) {
          const updated = toUser(m.user);
          if (updated) setUser({ ...updated, profileComplete: m?.profileComplete !== false });
          return null;
        }
        setUser(previous);
        if (m?.error === "bad_name") return "bad_name";
        if (m?.error === "unauthorized") return "session_expired";
        return "save_failed";
      } catch {
        if (revision === sessionRevisionRef.current) setUser(previous);
        return "network_failed";
      }
    },
    [user],
  );

  const addAddress = useCallback((a: string) => {
    setAddresses((prev) => [...prev, a]);
    fetch("/api/customer/addresses", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: a }),
    }).then((r) => r.json()).then((data) => {
      const list = Array.isArray(data?.addresses) ? data.addresses : [];
      if (list.length) {
        setAddresses(list.map((item: { label?: string }) => String(item.label || "")).filter(Boolean));
        setAddressIds(list.map((item: { id?: string }) => String(item.id || "")));
      }
    }).catch(() => {});
  }, []);
  const removeAddress = useCallback((i: number) => {
    const id = addressIds[i];
    setAddresses((prev) => prev.filter((_, idx) => idx !== i));
    setAddressIds((prev) => prev.filter((_, idx) => idx !== i));
    if (id) fetch(`/api/customer/addresses?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }, [addressIds]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user, authMode, isModalOpen,
      openLogin: () => setOpen(true),
      closeLogin: () => setOpen(false),
      continueWithPhone, logout, updateProfile,
      addresses, addAddress, removeAddress,
    }),
    [user, authMode, isModalOpen, continueWithPhone, logout, updateProfile, addresses, addAddress, removeAddress],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
