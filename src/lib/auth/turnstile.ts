"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const TURNSTILE_SCRIPT_ID = "daribar-turnstile-script";
export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_TIMEOUT_MS = 20_000;
const TURNSTILE_CHALLENGE_TIMEOUT_MS = 90_000;

type TurnstileWidgetId = string;

type TurnstileOptions = {
  sitekey: string;
  execution: "execute";
  appearance: "interaction-only";
  size: "flexible";
  callback: (token: string) => void;
  "error-callback": (errorCode?: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => TurnstileWidgetId;
  execute: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type PendingChallenge = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

let turnstileLoader: Promise<TurnstileApi> | null = null;

type SecurityFailure = "unavailable" | "configuration" | "domain" | "load" | "timeout" | "expired";
const SECURITY_MESSAGE_KEYS: Record<SecurityFailure, string> = {
  unavailable: "auth.securityUnavailable",
  configuration: "auth.securityConfiguration",
  domain: "auth.securityDomain",
  load: "auth.securityLoadFailed",
  timeout: "auth.securityTimeout",
  expired: "auth.securityExpired",
};

export class TurnstileClientError extends Error {
  readonly messageKey: string;
  readonly providerCode?: string;
  constructor(reason: SecurityFailure = "unavailable", providerCode?: string) {
    super("turnstile_unavailable");
    this.name = "TurnstileClientError";
    this.messageKey = SECURITY_MESSAGE_KEYS[reason];
    // Only known public error identifiers are retained, never arbitrary data
    // received from a third-party script (and never the challenge token/key).
    if (providerCode && /^(110100|110110|110200|110600|110620|200500|400020|400070)$/.test(providerCode)) {
      this.providerCode = providerCode;
    }
  }
}

function unavailable(reason: SecurityFailure = "unavailable"): TurnstileClientError {
  return new TurnstileClientError(reason);
}

export function turnstileProviderError(code?: string): TurnstileClientError {
  switch (code) {
    case "110200": return new TurnstileClientError("domain", code);
    case "110100": case "110110": case "400020": case "400070": return new TurnstileClientError("configuration", code);
    case "110600": case "110620": return new TurnstileClientError("timeout", code);
    case "200500": return new TurnstileClientError("load", code);
    default: return unavailable();
  }
}

export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(unavailable());
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;

  turnstileLoader = new Promise<TurnstileApi>((resolve, reject) => {
    const staleScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (staleScript?.dataset.turnstileState === "error") staleScript.remove();

    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript || document.createElement("script");
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(unavailable("load")), TURNSTILE_SCRIPT_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeoutId);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    }

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error || !window.turnstile) {
        script.dataset.turnstileState = "error";
        reject(error || unavailable("load"));
        return;
      }
      script.dataset.turnstileState = "ready";
      resolve(window.turnstile);
    }

    function onLoad() {
      finish();
    }

    function onError() {
      finish(unavailable("load"));
    }

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    if (!existingScript) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.cfasync = "false";
      script.dataset.turnstileState = "loading";
      document.head.appendChild(script);
    } else if (window.turnstile) {
      finish();
    }
  }).catch((error) => {
    turnstileLoader = null;
    throw error;
  });

  return turnstileLoader;
}

export function useTurnstileToken(active: boolean): {
  containerRef: RefObject<HTMLDivElement | null>;
  requestToken: () => Promise<string>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingRef = useRef<PendingChallenge | null>(null);
  const generationRef = useRef(0);
  const challengeRef = useRef(0);

  const rejectPending = useCallback((error = unavailable()) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    window.clearTimeout(pending.timeoutId);
    pending.reject(error);
  }, []);

  const resolvePending = useCallback((rawToken: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    const token = String(rawToken || "").trim();
    if (!token || token.length > 4_096 || /\s/.test(token)) {
      rejectPending();
      return;
    }
    pendingRef.current = null;
    window.clearTimeout(pending.timeoutId);
    pending.resolve(token);
  }, [rejectPending]);

  const requestToken = useCallback(async (): Promise<string> => {
    const siteKey = String(process.env.NEXT_PUBLIC_DARIBAR_TURNSTILE_SITE_KEY || "").trim();
    const container = containerRef.current;
    if (!siteKey) throw unavailable("configuration");
    if (!active || !container) throw unavailable();

    const generation = generationRef.current;
    const api = await loadTurnstile();
    // The script may finish after the user closed/reopened the modal. Do not
    // render into a detached container or resolve the next dialog's challenge.
    if (generation !== generationRef.current || container !== containerRef.current || !container.isConnected) throw unavailable();
    apiRef.current = api;
    const challenge = ++challengeRef.current;
    rejectPending();
    const previousWidget = widgetIdRef.current;
    widgetIdRef.current = null;
    if (previousWidget) {
      try { api.remove(previousWidget); } catch { /* Already removed by provider. */ }
    }
    const isCurrent = () => generation === generationRef.current && challenge === challengeRef.current;

    return new Promise<string>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => rejectPending(unavailable("timeout")), TURNSTILE_CHALLENGE_TIMEOUT_MS);
      pendingRef.current = { resolve, reject, timeoutId };

      try {
        const widgetId = api.render(container, {
            sitekey: siteKey,
            execution: "execute",
            appearance: "interaction-only",
            size: "flexible",
            callback: (token) => { if (isCurrent()) resolvePending(token); },
            // The UI distinguishes a configuration problem from a user's
            // network failure without exposing arbitrary provider payloads.
            "error-callback": (code) => { if (isCurrent()) rejectPending(turnstileProviderError(code)); },
            "expired-callback": () => { if (isCurrent()) rejectPending(unavailable("expired")); },
            "timeout-callback": () => { if (isCurrent()) rejectPending(unavailable("timeout")); },
          });
        if (!widgetId) throw unavailable();
        widgetIdRef.current = widgetId;
        api.execute(widgetId);
      } catch {
        rejectPending();
      }
    });
  }, [active, rejectPending, resolvePending]);

  useEffect(() => {
    if (!active) return;
    // Warm the provider script when the login modal opens so the first click
    // does not have to wait for a network round trip before the challenge.
    void loadTurnstile().catch(() => undefined);
    return () => {
      generationRef.current += 1;
      challengeRef.current += 1;
      rejectPending();
      const api = apiRef.current;
      const widgetId = widgetIdRef.current;
      if (api && widgetId) {
        try {
          api.remove(widgetId);
        } catch {
          // The challenge may already have removed itself after navigation.
        }
      }
      widgetIdRef.current = null;
      apiRef.current = null;
    };
  }, [active, rejectPending]);

  return { containerRef, requestToken };
}
