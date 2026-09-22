"use client";

import { useState, useEffect } from "react";
import { X, Truck, ShieldCheck, Gift, LogIn, UserPlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { cn } from "@/lib/cn";

/** Приветственное окно для новых посетителей (один раз, помним в localStorage). */
export function WelcomeModal() {
  const pathname = usePathname();
  const paymentFlow = pathname.startsWith("/payment");
  const { t } = useLang();
  const { openLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [enter, setEnter] = useState(false);

  useEffect(() => {
    if (paymentFlow) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    try {
      if (!localStorage.getItem("ass_welcomed")) {
        t1 = setTimeout(() => {
          setOpen(true);
          t2 = setTimeout(() => setEnter(true), 30);
        }, 1700);
      }
    } catch {
      /* ignore */
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [paymentFlow]);

  const close = () => {
    setEnter(false);
    setTimeout(() => setOpen(false), 250);
    try {
      localStorage.setItem("ass_welcomed", "1");
    } catch {
      /* ignore */
    }
  };

  const openCustomerAuth = () => {
    setEnter(false);
    try {
      localStorage.setItem("ass_welcomed", "1");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      setOpen(false);
      openLogin();
    }, 250);
  };

  if (paymentFlow || !open) return null;

  const features = [
    { icon: Truck, text: t("welcome.f1") },
    { icon: ShieldCheck, text: t("welcome.f2") },
    { icon: Gift, text: t("welcome.f3") },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-4">
      <div className={cn("absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300", enter ? "opacity-100" : "opacity-0")} onClick={close} />
      <div
        className={cn(
          "relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-pop transition-all duration-300 sm:rounded-3xl",
          enter ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
        )}
      >
        <button onClick={close} aria-label={t("common.close")} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/85 text-slate-600 transition hover:bg-white">
          <X className="h-5 w-5" />
        </button>

        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 pb-8 pt-9 text-center text-white">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-pop">
            <svg viewBox="0 0 100 100" className="h-9 w-9 text-brand-600"><path d="M35 0 H65 V35 H100 V65 H65 V100 H35 V65 H0 V35 H35 Z" fill="currentColor" /></svg>
          </span>
          <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{t("welcome.title")}</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-brand-50/90">{t("welcome.sub")}</p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {features.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><f.icon className="h-5 w-5" /></span>
              <span className="text-sm font-medium text-slate-800">{f.text}</span>
            </div>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              onClick={openCustomerAuth}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white px-3 font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              <LogIn className="h-4 w-4 shrink-0" />
              {t("welcome.login")}
            </button>
            <button
              onClick={openCustomerAuth}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 font-semibold text-white transition hover:bg-brand-700"
            >
              <UserPlus className="h-4 w-4 shrink-0" />
              {t("welcome.register")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
