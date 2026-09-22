"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { bonusHistory, levels } from "@/lib/data/account";
import { cn } from "@/lib/cn";
import { accountExtraCopy } from "@/lib/i18n/account-extra";

export default function BonusesPage() {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const copy = accountExtraCopy[lang];
  if (!user) return null;

  if (typeof user.bonus !== "number" || !user.level) {
    return (
      <section className="rounded-2xl border border-slate-100 p-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">{t("acc.tile.bonuses")}</h1>
        <p className="mt-2 text-sm text-slate-500">{copy.bonusUnavailable}</p>
      </section>
    );
  }

  const idx = levels.findIndex((l) => l.name === user.level);
  const next = levels[idx + 1];
  const progress = next ? 64 : 100;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-brand-50/80">{t("acc.bonusAcc")}</p>
            <p className="font-display text-4xl font-extrabold leading-tight">{user.bonus.toLocaleString(copy.locale)}</p>
            <p className="text-sm text-brand-50/80">{t("acc.bonusUnit")}</p>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">{user.level}</span>
        </div>
        {next && (
          <div className="mt-5">
            <div className="flex justify-between text-sm text-brand-50/90">
              <span>{t("acc.toLevel")} {next.name} ({next.cashback} {t("acc.cashbackWord")})</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/20">
              <div className="h-2 rounded-full bg-gold-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-100 p-5">
        <h2 className="font-display text-lg font-bold text-slate-900">{t("acc.levels")}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {levels.map((l) => (
            <div key={l.name} className={cn("rounded-xl border p-4 text-center", l.name === user.level ? "border-brand-500 bg-brand-50" : "border-slate-100")}>
              <p className="text-2xl font-extrabold text-slate-900">{l.cashback}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{l.name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 p-5">
        <h2 className="font-display text-lg font-bold text-slate-900">{t("acc.bonusHistory")}</h2>
        {bonusHistory.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">{copy.bonusHistoryEmpty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {bonusHistory.map((b, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{b.label}</p>
                  <p className="text-xs text-slate-400">{b.date}</p>
                </div>
                <span className={cn("font-semibold", b.amount > 0 ? "text-brand-700" : "text-slate-500")}>{b.amount > 0 ? "+" : ""}{b.amount.toLocaleString(copy.locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
