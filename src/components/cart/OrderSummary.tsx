"use client";

import { tenge } from "@/lib/format";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { Clock3, Sparkles } from "lucide-react";
import { cartExtraCopy, type CartFulfillment } from "@/lib/i18n/cart-extra";

export function OrderSummary({
  subtotal,
  savings,
  count,
  cta,
  fulfillment,
}: {
  subtotal: number;
  savings: number;
  count: number;
  cta: React.ReactNode;
  fulfillment?: CartFulfillment;
}) {
  const { lang, t, plural } = useLang();
  const copy = cartExtraCopy[lang];
  const fulfillmentCopy = fulfillment ? copy.fulfillment[fulfillment] : null;
  const { user } = useAuth();
  return (
    <div className="sticky top-6 rounded-2xl bg-white p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)] sm:p-5">
      <h2 className="font-display text-lg font-bold text-slate-900">{t("sum.title")}</h2>
      {fulfillmentCopy && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-brand-800">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{fulfillmentCopy.eta}</p>
            <p className="mt-0.5 text-xs text-brand-700/75">{copy.summary.pharmacyHours}</p>
          </div>
        </div>
      )}
      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">{count} {plural(count)}</dt>
          <dd className="font-medium text-slate-800">{tenge(subtotal + savings)}</dd>
        </div>
        {savings > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-500">{t("sum.discount")}</dt>
            <dd className="font-medium text-accent-600">−{tenge(savings)}</dd>
          </div>
        )}
        {fulfillmentCopy && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{fulfillmentCopy.title}</dt>
            <dd className="text-right font-medium text-slate-800">{fulfillmentCopy.summaryPrice}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4">
        <span className="text-slate-600">{t("sum.total")}</span>
        <span className="font-display text-2xl font-extrabold text-slate-900">{tenge(subtotal)}</span>
      </div>
      {fulfillment === "courier" && (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{copy.summary.deliveryFeePending}</p>
      )}
      {user?.name && user?.phone && (
        <p className="mt-1.5 text-sm font-medium text-brand-700">{t("sum.cashback")}: +{tenge(Math.round(subtotal * 0.05))} {t("sum.points")}</p>
      )}
      {!user && subtotal > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-700"><Sparkles className="h-4 w-4" /> {copy.summary.earnUpTo(Math.round(subtotal * 0.05).toLocaleString(copy.locale))}</p>
      )}
      <div className="mt-5">{cta}</div>
    </div>
  );
}
