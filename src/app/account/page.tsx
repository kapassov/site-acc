"use client";

import Link from "next/link";
import { useState } from "react";
import { Package, Gift, Heart, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFavorites } from "@/lib/favorites/FavoritesContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { orderStatusMeta } from "@/lib/data/account";
import { useOrders } from "@/lib/orders/useOrders";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accountExtraCopy } from "@/lib/i18n/account-extra";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";

export default function AccountOverview() {
  const { user, updateProfile } = useAuth();
  const { count: favCount } = useFavorites();
  const { lang, t } = useLang();
  const copy = accountExtraCopy[lang];
  const [name, setName] = useState(user?.name ?? "");
  const [saved, setSaved] = useState(false);
  const orders = useOrders();

  if (!user) return null;

  const displayName = user.name.trim() || copy.customerFallback;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({ name: name.trim() || user.name });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const recent = orders.slice(0, 2);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-slate-900">{t("acc.hi")}, {displayName.split(" ")[0]}!</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile href="/account/orders" icon={<Package className="h-5 w-5" />} label={t("acc.tile.orders")} value={String(orders.length)} />
        {typeof user.bonus === "number" && user.level ? (
          <Tile href="/account/bonuses" icon={<Gift className="h-5 w-5" />} label={t("acc.tile.bonuses")} value={user.bonus.toLocaleString(copy.locale)} />
        ) : null}
        <Tile href="/favorites" icon={<Heart className="h-5 w-5" />} label={t("acc.tile.fav")} value={String(favCount)} />
      </div>

      <section className="rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("acc.recent")}</h2>
          <Link href="/account/orders" className="text-sm font-semibold text-brand-700 hover:text-brand-800">{t("acc.allOrders")}</Link>
        </div>
        <div className="mt-4 space-y-3">
          {recent.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{o.id}</p>
                <p className="text-sm text-slate-500">{o.date}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-slate-900">{tenge(o.total)}</p>
                <span className={cn("text-xs font-medium", orderStatusMeta[o.status].className.split(" ").find((c) => c.startsWith("text")))}>{t(`st.${o.status}`)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={save} className="rounded-2xl border border-slate-100 p-5">
        <h2 className="font-display text-lg font-bold text-slate-900">{t("acc.profile")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("acc.f.name")}><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label={t("acc.f.phone")}><input value={user.phone} disabled className={inputCls} /></Field>
        </div>
        <button type="submit" className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 font-semibold text-white transition hover:bg-brand-700">
          {saved ? t("acc.saved") : t("acc.save")}
        </button>
      </form>
    </div>
  );
}

function Tile({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <Link href={href} className="group flex items-center justify-between rounded-2xl border border-slate-100 p-4 transition hover:border-brand-200 hover:shadow-card">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
        <div>
          <p className="font-display text-xl font-extrabold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 text-slate-300 transition group-hover:text-brand-500" />
    </Link>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
