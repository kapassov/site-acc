"use client";

import { useState, useEffect } from "react";
import { X, Phone, Sparkles, Gift, ArrowRight } from "lucide-react";
import { useScanner } from "@/lib/ui/ScannerContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useToast } from "@/lib/ui/ToastContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { tenge } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

/** Баллы Saumart по номеру телефона (заменил QR-сканер). */
export function ScannerModal() {
  const { isOpen, close } = useScanner();
  const { user } = useAuth();
  const { push } = useToast();
  const { t, lang } = useLang();
  const [phone, setPhone] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect -- при открытии модалки подставляем телефон из профиля */
      setPhone(user?.phone ?? "");
      setShown(Boolean(user));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen, user]);

  const balance = user?.bonus ?? 1500;

  const check = () => {
    if (phone.replace(/\D/g, "").length < 6) {
      push(t("bonus.badPhone"));
      return;
    }
    setShown(true);
    push(t("bonus.found"));
  };

  return (
    <div className={`fixed inset-0 z-[80] ${isOpen ? "" : "pointer-events-none"}`} aria-hidden={!isOpen}>
      <div onClick={close} className={`absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className={`relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-pop transition-all duration-300 ${isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}>
          <button onClick={close} aria-label="×" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl text-white/85 transition hover:bg-white/15">
            <X className="h-5 w-5" />
          </button>

          <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 pb-7 pt-8 text-center text-white">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Gift className="h-7 w-7" /></span>
            <h2 className="mt-3 font-display text-xl font-bold">{t("bonus.modalTitle")}</h2>
            <p className="mx-auto mt-1 max-w-[16rem] text-sm text-brand-50/90">{t("bonus.modalSub")}</p>
          </div>

          <div className="px-6 py-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">{t("bonus.phoneLabel")}</span>
              <span className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                <Phone className="h-4 w-4 shrink-0 text-brand-600" />
                <input value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setShown(false); }} placeholder="+7 (___) ___-__-__" inputMode="tel" className="h-11 flex-1 bg-transparent text-sm outline-none" />
              </span>
            </label>

            {shown ? (
              <div className="mt-4 rounded-2xl bg-brand-50 p-4 text-center">
                <p className="text-xs font-medium text-brand-700/80">{t("bonus.balance")}</p>
                <p className="mt-0.5 flex items-center justify-center gap-1.5 font-display text-3xl font-extrabold text-brand-700"><Sparkles className="h-6 w-6" /> {balance.toLocaleString(lang === "kz" ? "kk-KZ" : lang === "en" ? "en-US" : "ru-RU")}</p>
                <p className="mt-0.5 text-xs text-slate-500">≈ {tenge(balance)}</p>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">{t("bonus.howto")}</p>
              </div>
            ) : (
              <button onClick={check} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white transition hover:bg-brand-700">
                {t("bonus.check")} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
