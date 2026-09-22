"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  LoaderCircle,
  Lock,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";
import { langs, type Lang } from "@/lib/i18n/dict";
import { paymentCopy } from "@/lib/i18n/payment";
import { useAuth, type User } from "@/lib/auth/AuthContext";

type PaymentSession = {
  orderId: string;
  providerOrderId: string;
  orderNumber?: string;
  amount: number;
  currency: "KZT";
  itemsCount: number;
};

type PaymentViewState =
  | { kind: "loading" }
  | { kind: "ready"; session: PaymentSession }
  | { kind: "redirecting"; session: PaymentSession }
  | { kind: "missing" }
  | { kind: "auth" }
  | { kind: "error" };

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePaymentSession(value: unknown): PaymentSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const orderId = typeof item.orderId === "string" || typeof item.orderId === "number"
    ? String(item.orderId)
    : "";
  const providerOrderId = typeof item.providerOrderId === "string" || typeof item.providerOrderId === "number"
    ? String(item.providerOrderId)
    : "";
  const orderNumber = typeof item.orderNumber === "string" || typeof item.orderNumber === "number"
    ? String(item.orderNumber).trim()
    : "";
  const amount = typeof item.amount === "number" ? item.amount : Number.NaN;
  const itemsCount = typeof item.itemsCount === "number" ? item.itemsCount : Number.NaN;
  if (!orderId || !providerOrderId || item.currency !== "KZT") return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isSafeInteger(itemsCount) || itemsCount < 1) return null;
  return { orderId, providerOrderId, orderNumber: orderNumber || undefined, amount, currency: "KZT", itemsCount };
}

function formatAmount(amount: number, currency: string, lang: Lang): string {
  const locale = lang === "kz" ? "kk-KZ" : lang === "en" ? "en-US" : "ru-RU";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
  return `${formatted} ${currency === "KZT" ? "₸" : currency}`;
}

function shortOrderReference(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-5)}`;
}

export function PaymentPageClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { lang, setLang, plural } = useLang();
  const { user, isModalOpen, openLogin } = useAuth();
  const copy = paymentCopy[lang];
  const validSessionId = SESSION_ID_PATTERN.test(sessionId);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PaymentViewState>(() => (
    validSessionId ? { kind: "loading" } : { kind: "missing" }
  ));
  const authRecoveryRef = useRef<{ armed: boolean; sawModal: boolean; baselineUser: User | null }>({
    armed: false,
    sawModal: false,
    baselineUser: null,
  });

  const retry = useCallback(() => {
    if (!validSessionId) return;
    setState({ kind: "loading" });
    setReloadKey((value) => value + 1);
  }, [validSessionId]);

  const beginAuthRecovery = () => {
    authRecoveryRef.current = { armed: true, sawModal: false, baselineUser: user };
    openLogin();
  };

  useEffect(() => {
    document.title = `${copy.documentTitle} | Аптека со склада`;
  }, [copy.documentTitle]);

  useEffect(() => {
    if (!validSessionId) return;
    const controller = new AbortController();
    fetch(`/api/payment/session/${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (response.status === 401 || response.status === 403) return { kind: "auth" } as const;
        if (response.status === 404 || response.status === 410) return { kind: "missing" } as const;
        if (!response.ok) return { kind: "error" } as const;
        const session = parsePaymentSession(body);
        return session ? { kind: "ready", session } as const : { kind: "error" } as const;
      })
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, [reloadKey, sessionId, validSessionId]);

  useEffect(() => {
    const recovery = authRecoveryRef.current;
    if (!recovery.armed) return;
    if (isModalOpen) {
      recovery.sawModal = true;
      return;
    }
    // Closing the dialog without a successful OTP leaves the same User object.
    // A successful login/profile completion replaces it in AuthContext.
    if (!recovery.sawModal || !user || user === recovery.baselineUser) return;
    recovery.armed = false;
    const timer = window.setTimeout(retry, 0);
    return () => window.clearTimeout(timer);
  }, [isModalOpen, retry, user]);

  const currentSession = state.kind === "ready" || state.kind === "redirecting" ? state.session : null;
  const amount = currentSession ? formatAmount(currentSession.amount, currentSession.currency, lang) : "";
  const items = currentSession ? `${currentSession.itemsCount} ${plural(currentSession.itemsCount)}` : "";
  const continueAction = `/api/payment/session/${encodeURIComponent(sessionId)}/continue`;
  const redirecting = state.kind === "redirecting";

  const steps = useMemo(() => [
    { title: copy.steps.createdTitle, text: copy.steps.createdText, state: "done" as const },
    { title: copy.steps.paymentTitle, text: copy.steps.paymentText, state: "current" as const },
    { title: copy.steps.confirmationTitle, text: copy.steps.confirmationText, state: "next" as const },
  ], [copy.steps]);

  const beginRedirect = () => {
    if (currentSession) setState({ kind: "redirecting", session: currentSession });
  };

  useEffect(() => {
    if (state.kind !== "redirecting") return;
    let alive = true;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch(`/api/customer/orders/${encodeURIComponent(state.session.orderId)}`, {
          cache: "no-store", credentials: "same-origin",
        });
        const payload = response.ok ? await response.json() : null;
        const paymentStatus = String(payload?.order?.payment?.status || payload?.order?.paymentStatus || "").toLowerCase();
        if (alive && ["paid", "success", "successful", "completed"].includes(paymentStatus)) {
          router.replace(`/account/orders/${encodeURIComponent(state.session.orderId)}`);
        }
      } catch {
        // A transient provider/read error is retried while this page remains open.
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(check, 5_000);
    window.addEventListener("focus", check);
    void check();
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [router, state]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4f8f5] text-slate-900">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_10%_0%,rgba(52,201,125,0.15),transparent_36%),radial-gradient(circle_at_92%_18%,rgba(229,57,53,0.08),transparent_28%)]" />

      <header className="relative border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:h-20 sm:flex-nowrap sm:px-6 sm:py-0">
          <Logo className="shrink-0 max-w-[210px] max-[350px]:mx-auto sm:max-w-none" />
          <div className="flex shrink-0 items-center gap-2 max-[350px]:w-full max-[350px]:justify-center sm:gap-3">
            <div className="hidden items-center gap-2 text-sm font-semibold text-brand-800 sm:flex">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span>{copy.secureBadge}</span>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={copy.languageLabel}>
              {langs.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => setLang(language.code)}
                  aria-pressed={lang === language.code}
                  className={cn(
                    "min-h-9 rounded-md px-2 text-[11px] font-bold uppercase transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 sm:px-2.5",
                    lang === language.code ? "bg-white text-brand-800 shadow-sm" : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className={cn("relative mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10", currentSession && "pb-32 lg:pb-12")}>
        {state.kind === "loading" ? <PaymentLoading copy={copy} /> : null}

        {state.kind === "missing" ? (
          <PaymentErrorState
            kind="missing"
            title={copy.missingTitle}
            text={copy.missingText}
            orders={copy.orders}
          />
        ) : null}

        {state.kind === "auth" ? (
          <PaymentErrorState
            kind="auth"
            title={copy.authTitle}
            text={copy.authText}
            orders={copy.orders}
            actionLabel={copy.signIn}
            onAction={beginAuthRecovery}
            actionKind="login"
          />
        ) : null}

        {state.kind === "error" ? (
          <PaymentErrorState
            kind="error"
            title={copy.errorTitle}
            text={copy.errorText}
            orders={copy.orders}
            actionLabel={copy.retry}
            onAction={retry}
            actionKind="retry"
          />
        ) : null}

        {currentSession ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
            <section aria-labelledby="payment-title" className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)]">
              <div className="border-b border-slate-100 px-5 py-6 sm:px-8 sm:py-8">
                <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-brand-800">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {copy.created}
                </div>
                <h1 id="payment-title" className="mt-4 font-display text-3xl font-extrabold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                  {copy.title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">{copy.lead}</p>
              </div>

              <div className="px-5 py-6 sm:px-8 sm:py-8">
                <p className="text-sm font-medium text-slate-500">{copy.amount}</p>
                <p className="mt-1 font-display text-4xl font-extrabold tracking-[-0.04em] text-slate-950 sm:text-5xl">{amount}</p>
                <p className="mt-2 max-w-xl text-xs leading-5 text-slate-500 sm:text-sm">{copy.finalAmountHint}</p>

                <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-slate-200/80">
                    <CreditCard className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{copy.method}</p>
                    <p className="mt-0.5 truncate font-semibold text-slate-900">{copy.card}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{copy.provider}</p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50/70 p-4 sm:p-5">
                  <div className="flex gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm">
                      <Lock className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="font-semibold text-brand-950">{copy.securityTitle}</h2>
                      <p className="mt-1 text-sm leading-6 text-brand-900/75">{copy.securityBody}</p>
                      <p className="mt-2 text-xs font-medium text-brand-800/70">{copy.bankHint}</p>
                    </div>
                  </div>
                </div>

                <form method="post" action={continueAction} target="_blank" onSubmit={beginRedirect} className="mt-6 hidden lg:block" aria-busy={redirecting}>
                  <PaymentButton copy={copy} redirecting={redirecting} />
                </form>
                <Link href="/account/orders" className="mt-4 hidden w-fit text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:inline-flex">
                  {copy.orders}
                </Link>
              </div>
            </section>

            <aside aria-labelledby="order-summary-title" className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.5)] sm:p-6 lg:sticky lg:top-6">
              <h2 id="order-summary-title" className="font-display text-xl font-bold tracking-tight text-slate-950">{copy.summary}</h2>
              <dl className="mt-5 space-y-3 border-b border-slate-100 pb-5 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-slate-500">{copy.order}</dt>
                  <dd className="max-w-[190px] truncate text-right font-semibold text-slate-900" title={currentSession.orderNumber || currentSession.orderId}>
                    № {currentSession.orderNumber || shortOrderReference(currentSession.orderId)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">{copy.products}</dt>
                  <dd className="font-semibold text-slate-900">{items}</dd>
                </div>
                <div className="flex items-end justify-between gap-4 pt-2">
                  <dt className="font-semibold text-slate-700">{copy.total}</dt>
                  <dd className="font-display text-2xl font-extrabold tracking-tight text-slate-950">{amount}</dd>
                </div>
              </dl>

              <h3 className="mt-5 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{copy.progress}</h3>
              <ol className="mt-4 space-y-4">
                {steps.map((step, index) => (
                  <li key={step.title} className="relative flex gap-3">
                    {index < steps.length - 1 ? <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%+4px)] w-px bg-slate-200" /> : null}
                    <span className={cn(
                      "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold",
                      step.state === "done" && "border-brand-600 bg-brand-600 text-white",
                      step.state === "current" && "border-brand-300 bg-brand-50 text-brand-800 ring-4 ring-brand-50",
                      step.state === "next" && "border-slate-200 bg-white text-slate-400",
                    )}>
                      {step.state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className={cn("text-sm font-semibold", step.state === "next" ? "text-slate-500" : "text-slate-900")}>{step.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        ) : null}
      </div>

      {currentSession ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 px-4 pt-3 shadow-[0_-18px_50px_-35px_rgba(15,23,42,0.55)] backdrop-blur-xl [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-[11px] font-medium text-slate-500">{copy.amount}</p>
              <p className="truncate font-display text-lg font-extrabold tracking-tight text-slate-950">{amount}</p>
            </div>
            <form method="post" action={continueAction} target="_blank" onSubmit={beginRedirect} className="min-w-0 flex-1" aria-busy={redirecting}>
              <PaymentButton copy={copy} redirecting={redirecting} compact />
            </form>
          </div>
        </div>
      ) : null}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {redirecting ? copy.redirecting : ""}
      </div>
    </div>
  );
}

function PaymentButton({
  copy,
  redirecting,
  compact = false,
}: {
  copy: (typeof paymentCopy)[Lang];
  redirecting: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={redirecting}
      className={cn(
        "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 text-sm font-bold text-white shadow-[0_12px_25px_-14px_rgba(14,138,74,0.8)] transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-brand-500 sm:text-base",
        compact && "min-h-14 rounded-xl px-3 text-sm",
      )}
    >
      {redirecting ? <LoaderCircle className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 truncate">{redirecting ? copy.redirecting : compact ? copy.payShort : copy.pay}</span>
      {!redirecting ? <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}

function PaymentLoading({ copy }: { copy: (typeof paymentCopy)[Lang] }) {
  return (
    <section role="status" aria-busy="true" className="mx-auto max-w-xl rounded-3xl border border-slate-200/80 bg-white p-7 text-center shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)] sm:p-10">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <LoaderCircle className="h-7 w-7 motion-safe:animate-spin" aria-hidden="true" />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-950">{copy.loading}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">{copy.loadingHint}</p>
    </section>
  );
}

function PaymentErrorState({
  kind,
  title,
  text,
  orders,
  actionLabel,
  onAction,
  actionKind,
}: {
  kind: "missing" | "auth" | "error";
  title: string;
  text: string;
  orders: string;
  actionLabel?: string;
  onAction?: () => void;
  actionKind?: "login" | "retry";
}) {
  return (
    <section role="alert" className="mx-auto max-w-xl rounded-3xl border border-slate-200/80 bg-white p-6 text-center shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)] sm:p-10">
      <span className={cn(
        "mx-auto grid h-14 w-14 place-items-center rounded-2xl",
        kind === "missing" ? "bg-slate-100 text-slate-600" : kind === "auth" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700",
      )}>
        {kind === "missing" ? <PackageCheck className="h-7 w-7" aria-hidden="true" /> : <CircleAlert className="h-7 w-7" aria-hidden="true" />}
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600 sm:text-base">{text}</p>
      <div className="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">
        <Link href="/account/orders" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          {orders}
        </Link>
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
            {actionKind === "login"
              ? <UserRound className="h-4 w-4" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
