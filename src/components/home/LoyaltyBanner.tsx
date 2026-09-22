"use client";

import { Apple, Play, Gift } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/lib/ui/ToastContext";
import { usePush } from "@/components/push/PushProvider";
import { formatStaticCopy, staticPagesCopy } from "@/lib/i18n/static-pages";

const tiers = [
  { name: "Bronze", cashback: "3%" },
  { name: "Silver", cashback: "5%" },
  { name: "Gold", cashback: "7%" },
  { name: "Platinum", cashback: "10%" },
];

export function LoyaltyBanner() {
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  const { push } = useToast();
  const { sendEvent } = usePush();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-5 py-8 sm:rounded-3xl sm:px-10 sm:py-10 lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-white/5" />

        <div className="relative grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-gold-500/15 px-3.5 py-1.5 text-sm font-medium text-gold-200 ring-1 ring-gold-500/30">
              <Gift className="h-4 w-4" /> {t("loyalty.badge")}
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold leading-tight text-white sm:text-4xl">{t("loyalty.title")}</h2>
            <p className="mt-4 max-w-md text-brand-50/90">{t("loyalty.sub")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button type="button" onClick={() => { void sendEvent("app.download_interest", { store: "app-store", placement: "loyalty" }); push(formatStaticCopy(copy["toast.appSoon"], { store: "App Store" })); }} className="inline-flex h-12 items-center gap-2.5 rounded-2xl border border-white/20 bg-white/10 px-4 text-left text-white transition hover:bg-white/20">
                <Apple className="h-5 w-5" />
                <span className="leading-tight">
                  <span className="block text-[10px] text-brand-50/80">{t("store.top.app")}</span>
                  <span className="block text-sm font-semibold">App Store</span>
                </span>
              </button>
              <button type="button" onClick={() => { void sendEvent("app.download_interest", { store: "google-play", placement: "loyalty" }); push(formatStaticCopy(copy["toast.appSoon"], { store: "Google Play" })); }} className="inline-flex h-12 items-center gap-2.5 rounded-2xl border border-white/20 bg-white/10 px-4 text-left text-white transition hover:bg-white/20">
                <Play className="h-5 w-5" />
                <span className="leading-tight">
                  <span className="block text-[10px] text-brand-50/80">{t("store.top.gp")}</span>
                  <span className="block text-sm font-semibold">Google Play</span>
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:justify-items-end">
            {tiers.map((tier) => (
              <div key={tier.name} className="rounded-2xl bg-white/10 p-4 text-center ring-1 ring-white/15 backdrop-blur">
                <p className="text-2xl font-extrabold text-gold-300">{tier.cashback}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-white/80">{tier.name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
