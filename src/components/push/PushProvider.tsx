"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import {
  DEFAULT_PUSH_PREFERENCES,
  loadPushClientState,
  sendPushEvent,
  storePushPreferences,
  subscribeToPush,
  syncPushPreferences,
  unsubscribeFromPush,
  type PushPreferences,
} from "@/lib/push/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";

type PushContextValue = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  busy: boolean;
  preferences: PushPreferences;
  error: string | null;
  enable: (preferences?: Partial<PushPreferences>) => Promise<boolean>;
  disable: () => Promise<void>;
  setPreferences: (preferences: Partial<PushPreferences>) => Promise<void>;
  sendEvent: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  dismissPrompt: () => void;
};

const PushContext = createContext<PushContextValue | null>(null);
const DISMISSED_KEY = "inkar-push-prompt-dismissed-v1";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function promptWasDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch { return false; }
}

function rememberPromptDismissal(): void {
  try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* storage may be blocked */ }
}

function pushErrorCode(error: unknown): string {
  return error instanceof Error ? error.message : "push_failed";
}

function errorMessage(code: string, t: (key: string) => string): string {
  if (code === "push_denied") return t("push.denied");
  if (code === "push_disabled") return t("push.disabled");
  if (code === "push_unsupported") return t("push.unsupported");
  if (code === "login_required") return t("push.loginRequired");
  return t("push.failed");
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { user, openLogin } = useAuth();
  const { t } = useLang();
  const wasAuthenticated = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferencesState] = useState<PushPreferences>(DEFAULT_PUSH_PREFERENCES);
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && promptWasDismissed());
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const error = errorCode ? errorMessage(errorCode, t) : null;

  useEffect(() => {
    let alive = true;
    loadPushClientState()
      .then((state) => {
        if (!alive) return;
        setSupported(state.supported);
        setPermission(state.permission);
        setSubscribed(Boolean(state.subscription));
        setPreferencesState(state.preferences);
      })
      .catch(() => {
        if (!alive) return;
        setSupported(false);
        setPermission("unsupported");
      })
      .finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, []);

  const enable = useCallback(async (patch: Partial<PushPreferences> = {}) => {
    if (!user) {
      setErrorCode("login_required");
      openLogin();
      return false;
    }
    const next = { ...preferences, ...patch };
    setBusy(true);
    setErrorCode(null);
    try {
      await subscribeToPush(next);
      setPreferencesState(next);
      setPermission("granted");
      setSubscribed(true);
      setDismissed(true);
      return true;
    } catch (cause) {
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
      setErrorCode(pushErrorCode(cause));
      return false;
    } finally { setBusy(false); }
  }, [openLogin, preferences, user]);

  const disable = useCallback(async () => {
    setBusy(true);
    setErrorCode(null);
    try { await unsubscribeFromPush(preferences); }
    catch (cause) { setErrorCode(pushErrorCode(cause)); }
    finally { setSubscribed(false); setBusy(false); }
  }, [preferences]);

  const updatePreferences = useCallback(async (patch: Partial<PushPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferencesState(next);
    storePushPreferences(next);
    if (!subscribed) return;
    setBusy(true);
    setErrorCode(null);
    try { await syncPushPreferences(next); }
    catch (cause) { setErrorCode(pushErrorCode(cause)); }
    finally { setBusy(false); }
  }, [preferences, subscribed]);

  const sendEvent = useCallback(async (event: string, payload?: Record<string, unknown>) => {
    await sendPushEvent(event, payload);
  }, []);

  const dismissPrompt = useCallback(() => {
    rememberPromptDismissal();
    setDismissed(true);
  }, []);

  useEffect(() => {
    const hadSession = wasAuthenticated.current;
    wasAuthenticated.current = Boolean(user);
    if (!hadSession || user || !subscribed) return;
    // Logging out also detaches this browser so account notifications cannot
    // continue on a shared device.
    void unsubscribeFromPush(preferences)
      .catch(() => undefined)
      .finally(() => setSubscribed(false));
  }, [preferences, subscribed, user]);

  const value = useMemo<PushContextValue>(() => ({
    supported, permission, subscribed, busy, preferences, error,
    enable, disable, setPreferences: updatePreferences, sendEvent, dismissPrompt,
  }), [supported, permission, subscribed, busy, preferences, error, enable, disable, updatePreferences, sendEvent, dismissPrompt]);

  const showPrompt = hydrated && Boolean(user) && supported && permission === "default" && !subscribed && !dismissed;

  return (
    <PushContext.Provider value={value}>
      {children}
      {showPrompt && (
        <PushPrompt
          busy={busy}
          error={error}
          initialPromos={preferences.promos}
          onEnable={(promos) => enable({ orders: true, promos })}
          onDismiss={dismissPrompt}
        />
      )}
    </PushContext.Provider>
  );
}

function PushPrompt({ busy, error, initialPromos, onEnable, onDismiss }: {
  busy: boolean;
  error: string | null;
  initialPromos: boolean;
  onEnable: (promos: boolean) => Promise<boolean>;
  onDismiss: () => void;
}) {
  const { t } = useLang();
  const [promos, setPromos] = useState(initialPromos);
  return (
    <aside aria-label={t("push.connection")} className="fixed bottom-4 left-4 right-4 z-[120] mx-auto max-w-sm rounded-2xl border border-brand-100 bg-white p-4 shadow-pop">
      <button type="button" aria-label={t("push.closeOffer")} onClick={onDismiss} className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-7">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Bell className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-slate-900">{t("push.orderStatus")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t("push.orderStatusSub")}</p>
        </div>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={promos} onChange={(event) => setPromos(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
        {t("push.promos")}
      </label>
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onDismiss} className="h-9 flex-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">{t("push.later")}</button>
        <button type="button" disabled={busy} onClick={() => void onEnable(promos)} className="h-9 flex-1 rounded-xl bg-brand-600 px-3 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
          {busy ? t("push.enabling") : t("push.enable")}
        </button>
      </div>
    </aside>
  );
}

export function usePush(): PushContextValue {
  const context = useContext(PushContext);
  if (!context) throw new Error("usePush must be used within <PushProvider>");
  return context;
}
