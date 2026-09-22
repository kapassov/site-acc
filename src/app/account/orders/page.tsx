"use client";

import { useState } from "react";
import Link from "next/link";
import { Package, Check, Truck, Home, RefreshCw } from "lucide-react";
import { orderStatusMeta, type OrderStatus } from "@/lib/data/account";
import { useOrders } from "@/lib/orders/useOrders";
import { useToast } from "@/lib/ui/ToastContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";

const filters: { key: "all" | OrderStatus; labelKey: string }[] = [
  { key: "all", labelKey: "acc.f.all" },
  { key: "awaiting_payment", labelKey: "acc.f.awaitingPayment" },
  { key: "processing", labelKey: "acc.f.processing" },
  { key: "delivered", labelKey: "acc.f.delivered" },
];

const trackSteps = [
  { labelKey: "track.accepted", icon: Check },
  { labelKey: "track.assembled", icon: Check },
  { labelKey: "track.transit", icon: Truck },
  { labelKey: "track.delivered", icon: Home },
];

export default function OrdersPage() {
  const { push } = useToast();
  const { t, plural } = useLang();
  const [f, setF] = useState<"all" | OrderStatus>("all");
  const orders = useOrders();
  const list = orders.filter((o) => f === "all" || o.status === f);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-slate-900">{t("acc.ordersT")}</h1>

      <div className="flex flex-wrap gap-2">
        {filters.map((x) => (
          <button key={x.key} onClick={() => setF(x.key)} className={cn("rounded-full px-4 py-2 text-sm font-medium transition", f === x.key ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-600 hover:border-brand-300")}>
            {t(x.labelKey)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-slate-300"><Package className="h-8 w-8" /></span>
          <p className="mt-4 font-semibold text-slate-800">{t("acc.ord.empty")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("acc.ord.emptySub")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((o) => (
            <div key={o.id} className="rounded-2xl border border-slate-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-50 text-slate-500"><Package className="h-5 w-5" /></span>
                  <div>
                    <p className="font-semibold text-slate-900">{o.id}</p>
                    <p className="text-sm text-slate-500">{o.date} · {o.itemsCount} {plural(o.itemsCount)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", orderStatusMeta[o.status].className)}>{t(`st.${o.status}`)}</span>
                  <span className="font-display text-lg font-bold text-slate-900">{tenge(o.total)}</span>
                </div>
              </div>

              {o.status === "processing" && (
                <div className="mt-4 flex items-center">
                  {trackSteps.map((s, i) => {
                    const Icon = s.icon;
                    const activeStep = Math.max(0, Math.min(3, o.progressStep ?? 0));
                    const done = i < activeStep;
                    const current = i === activeStep;
                    return (
                      <div key={s.labelKey} className="flex flex-1 flex-col items-center last:flex-none">
                        <div className="flex w-full items-center">
                          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", done || current ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400")}><Icon className="h-4 w-4" /></span>
                          {i < trackSteps.length - 1 && <span className={cn("h-0.5 flex-1", done ? "bg-brand-600" : "bg-slate-100")} />}
                        </div>
                        <span className={cn("mt-1.5 text-[11px]", current ? "font-semibold text-brand-700" : "text-slate-400")}>{t(s.labelKey)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {o.status === "awaiting_payment" && (
                <p className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">{t("acc.ord.awaitingPayment")}</p>
              )}
              {o.status === "action_required" && (
                <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{t("acc.ord.actionRequired")}</p>
              )}

              <p className="mt-3 line-clamp-1 text-sm text-slate-500">{o.preview.join(" · ")}</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => push(t("ai.toastAdd"))} className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:border-brand-300">
                  <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-4 w-4" /> {t("acc.ord.repeat")}</span>
                </button>
                <Link href={`/account/orders/${encodeURIComponent(o.detailId)}`} className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-slate-500 transition hover:bg-slate-50">{t("acc.ord.details")}</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
