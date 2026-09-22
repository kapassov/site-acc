"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Logo } from "@/components/layout/Logo";
import { applyPhoneMaskEdit, formatPhone, phoneDigits, isFullPhone } from "@/lib/phone";
import { isValidOtpCode, normalizeOtpPhone, OTP_CODE_LENGTH } from "@/lib/otpContract";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";
import { requestAuthJson } from "@/lib/auth/clientRequest";

type Stage = "contact" | "code" | "profile";
type AuthErrorState = { key: string; values?: Record<string, string | number>; diagnosticCode?: string };

const RESEND_DELAY_SECONDS = 30;

function sendErrorKey(code: unknown, status: number): string {
  if (code === "bad_phone") return "auth.badPhone";
  if (code === "too_soon") return "auth.tooSoon";
  if (code === "too_many_requests" || status === 429) return "auth.tooMany";
  if (code === "provider_unavailable" || code === "provider_timeout" || code === "otp_unavailable") {
    return "auth.smsUnavailable";
  }
  return "auth.sendFailed";
}

export function AuthModal() {
  const { authMode, isModalOpen, closeLogin, continueWithPhone, updateProfile } = useAuth();
  const { t } = useLang();
  const [stage, setStage] = useState<Stage>("contact");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorState | null>(null);
  const [fieldError, setFieldError] = useState<"phone" | "code" | "name" | null>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const sendInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const otpAbortRef = useRef<AbortController | null>(null);
  const cancelOtpRequest = useCallback(() => {
    requestGenerationRef.current += 1;
    sendInFlightRef.current = false;
    otpAbortRef.current?.abort();
    otpAbortRef.current = null;
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelOtpRequest();
      closeLogin();
      setStage("contact");
      setName("");
      setPhone("");
      setCode("");
      setCooldown(0);
      setError(null);
      setFieldError(null);
      setBusy(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelOtpRequest, closeLogin, isModalOpen]);

  const reset = () => {
    cancelOtpRequest();
    setStage("contact");
    setName("");
    setPhone("");
    setCode("");
    setCooldown(0);
    setError(null);
    setFieldError(null);
    setBusy(false);
  };

  const close = () => {
    closeLogin();
    reset();
  };

  const sendCode = async () => {
    if (sendInFlightRef.current || busy || cooldown > 0) return;
    if (!isFullPhone(phone)) {
      setFieldError("phone");
      setError({ key: "auth.fullPhone" });
      phoneRef.current?.focus();
      return;
    }

    sendInFlightRef.current = true;
    const requestGeneration = ++requestGenerationRef.current;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const controller = new AbortController();
      otpAbortRef.current = controller;
      const { response, payload } = await requestAuthJson("/api/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          phone: phoneDigits(phone),
        }),
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      if (response.ok && payload?.ok) {
        setCode("");
        setStage("code");
        setCooldown(RESEND_DELAY_SECONDS);
      } else {
        if (payload?.error === "too_soon" || response.status === 429) {
          const retryAfter = Number(payload?.retryAfter ?? response.headers.get("retry-after"));
          setCooldown(Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(3_600, Math.ceil(retryAfter)) : RESEND_DELAY_SECONDS);
        }
        setError({ key: sendErrorKey(payload?.error, response.status) });
      }
    } catch (cause) {
      if (requestGeneration !== requestGenerationRef.current) return;
      if ((cause as Error)?.name !== "AbortError") setError({ key: "auth.networkFailed" });
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        otpAbortRef.current = null;
        sendInFlightRef.current = false;
        setBusy(false);
      }
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sendInFlightRef.current || busy || authMode === "loading") return;

    if (stage === "contact") {
      await sendCode();
      return;
    }

    if (stage === "code") {
      if (!isValidOtpCode(code)) {
        setFieldError("code");
        setError({ key: "auth.invalidOtp", values: { count: OTP_CODE_LENGTH } });
        codeRef.current?.focus();
        return;
      }

      sendInFlightRef.current = true;
      const requestGeneration = ++requestGenerationRef.current;
      const controller = new AbortController();
      otpAbortRef.current = controller;
      setBusy(true);
      setError(null);
      setFieldError(null);
      const result = await continueWithPhone(phone, code, { signal: controller.signal });
      if (requestGeneration !== requestGenerationRef.current) return;
      if (result.error) {
        setError({ key: `auth.error.${result.error}` });
      } else if (result.needsProfile) {
        setStage("profile");
      } else {
        reset();
      }
      otpAbortRef.current = null;
      sendInFlightRef.current = false;
      setBusy(false);
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      close();
      return;
    }
    if (cleanName.length < 2) {
      setFieldError("name");
      setError({ key: "auth.invalidName" });
      nameRef.current?.focus();
      return;
    }

    sendInFlightRef.current = true;
    const requestGeneration = ++requestGenerationRef.current;
    const controller = new AbortController();
    otpAbortRef.current = controller;
    setBusy(true);
    setError(null);
    setFieldError(null);
    const updateError = await updateProfile({ name: cleanName }, { signal: controller.signal });
    if (requestGeneration !== requestGenerationRef.current) return;
    if (updateError) setError({ key: `auth.error.${updateError}` });
    else close();
    otpAbortRef.current = null;
    sendInFlightRef.current = false;
    setBusy(false);
  };

  const changePhone = () => {
    cancelOtpRequest();
    setStage("contact");
    setCode("");
    setCooldown(0);
    setError(null);
    setFieldError(null);
    setBusy(false);
  };

  const input = (invalid = false) => cn(
    "h-14 w-full rounded-xl border bg-slate-100 px-4 text-base text-slate-800 outline-none transition placeholder:text-slate-400 sm:h-12 sm:bg-white sm:text-sm",
    invalid
      ? "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100 focus:border-rose-500 focus:ring-rose-100"
      : "border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100",
  );

  if (!isModalOpen) return null;

  const description = authMode === "loading"
    ? t("auth.checking")
    : stage === "contact"
      ? t("auth.contactDescription")
      : stage === "code"
        ? t("auth.codeSent", { phone: formatPhone(phone) })
        : t("auth.profileDescription");

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" onClick={close} aria-label={t("a11y.closeLogin")} className="absolute inset-0 h-full w-full bg-slate-900/50 backdrop-blur-sm" />
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full items-center justify-center p-0 sm:p-4 [padding-bottom:max(0rem,env(safe-area-inset-bottom))] sm:[padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:[padding-top:max(1rem,env(safe-area-inset-top))]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            aria-describedby="auth-description"
            className="relative flex min-h-dvh w-full max-w-none flex-col overflow-y-auto bg-white p-5 pt-16 shadow-pop sm:min-h-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-sm sm:rounded-3xl sm:p-7"
          >
            <button type="button" onClick={close} aria-label={t("common.close")} className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="flex"><Logo /></div>
            <h2 id="auth-title" className="mt-8 text-left text-2xl font-extrabold text-slate-900 sm:mt-5 sm:text-center sm:text-xl">
              {stage === "profile" ? t("auth.profileTitle") : t("auth.loginTitle")}
            </h2>
            <p id="auth-description" className="mt-2 text-left text-sm leading-relaxed text-slate-500 sm:mt-1 sm:text-center">
              {description}
            </p>

            <form onSubmit={submit} className="mt-7 flex flex-1 flex-col gap-3 sm:mt-5">
              {authMode === "loading" ? (
                <div className="h-12 animate-pulse rounded-xl bg-slate-100" aria-label={t("auth.loading")} />
              ) : stage === "contact" ? (
                <>
                  <label htmlFor="auth-phone" className="sr-only">{t("auth.phoneLabel")}</label>
                  <input
                    id="auth-phone"
                    ref={phoneRef}
                    autoFocus
                    value={phone}
                    disabled={busy}
                    onPaste={(event) => {
                      const normalized = normalizeOtpPhone(event.clipboardData.getData("text"));
                      event.preventDefault();
                      if (!normalized) {
                        setFieldError("phone");
                        setError({ key: "auth.fullPhone" });
                        return;
                      }
                      setPhone(formatPhone(normalized));
                      setFieldError(null);
                      setError(null);
                    }}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const inputType = (event.nativeEvent as InputEvent).inputType || "";
                      // Browser autofill can replace the field without a paste
                      // event. A complete unformatted local number needs +7;
                      // partial masked typing must retain its current prefix.
                      const replacement = inputType === "insertReplacementText"
                        || /^\d{10,}$/.test(raw);
                      const normalized = replacement ? normalizeOtpPhone(raw) : "";
                      if (replacement && !normalized) {
                        setFieldError("phone");
                        setError({ key: "auth.fullPhone" });
                        return;
                      }
                      const edit = applyPhoneMaskEdit(
                        phone,
                        normalized || raw,
                        inputType,
                        event.target.selectionStart ?? raw.length,
                      );
                      setPhone(edit.value);
                      window.requestAnimationFrame(() => {
                        const inputElement = phoneRef.current;
                        if (inputElement && inputElement === document.activeElement) {
                          inputElement.setSelectionRange(edit.caret, edit.caret);
                        }
                      });
                      setFieldError(null);
                      setError(null);
                    }}
                    placeholder="+7 (___) ___-__-__"
                    inputMode="tel"
                    autoComplete="tel"
                    aria-invalid={fieldError === "phone"}
                    aria-describedby={fieldError === "phone" ? "auth-error" : "auth-description"}
                    className={input(fieldError === "phone")}
                  />
                </>
              ) : stage === "code" ? (
                <>
                  <label htmlFor="auth-code" className="sr-only">{t("auth.codeLabel")}</label>
                  <input
                    id="auth-code"
                    ref={codeRef}
                    autoFocus
                    value={code}
                    disabled={busy}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH));
                      setFieldError(null);
                      setError(null);
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_CODE_LENGTH}
                    placeholder={t("auth.otpPlaceholder", { count: OTP_CODE_LENGTH })}
                    aria-invalid={fieldError === "code"}
                    aria-describedby={fieldError === "code" ? "auth-error" : "auth-description"}
                    className={input(fieldError === "code")}
                  />
                  <div className="flex min-h-9 items-center justify-between gap-3 text-sm">
                    <button type="button" onClick={changePhone} className="font-medium text-brand-700 hover:text-brand-800">{t("auth.changePhone")}</button>
                    <button
                      type="button"
                      onClick={sendCode}
                      disabled={busy || cooldown > 0}
                      className="text-right font-medium text-brand-700 hover:text-brand-800 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="auth-name" className="sr-only">{t("auth.nameLabel")}</label>
                  <input
                    id="auth-name"
                    ref={nameRef}
                    autoFocus
                    value={name}
                    disabled={busy}
                    onChange={(event) => {
                      setName(event.target.value.slice(0, 60));
                      setFieldError(null);
                      setError(null);
                    }}
                    placeholder={t("auth.namePlaceholder")}
                    autoComplete="name"
                    aria-invalid={fieldError === "name"}
                    aria-describedby={fieldError === "name" ? "auth-error" : "auth-description"}
                    className={input(fieldError === "name")}
                  />
                  <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {t("auth.phoneConfirmed")}
                  </div>
                </>
              )}

              {error && (
                <p id="auth-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{t(error.key, error.values)}{error.diagnosticCode && <span className="mt-1 block text-xs">{t("auth.securityErrorCode", { code: error.diagnosticCode })}</span>}</span>
                </p>
              )}

              <button type="submit" disabled={busy || authMode === "loading" || (stage === "contact" && cooldown > 0)} className="mt-auto h-12 w-full rounded-xl bg-brand-600 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-0">
                {busy ? t("common.wait") : stage === "contact" && cooldown > 0 ? t("auth.resendIn", { seconds: cooldown }) : stage === "contact" ? t("auth.getCode") : stage === "code" ? t("auth.verifyCode") : name.trim() ? t("auth.saveContinue") : t("auth.continue")}
              </button>
              {stage === "profile" && name.trim() && (
                <button type="button" onClick={close} disabled={busy} className="h-11 w-full rounded-xl font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                  {t("auth.skip")}
                </button>
              )}
            </form>

            <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
              {t("auth.legal")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
