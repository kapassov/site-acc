"use client";

import { useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { accountExtraCopy } from "@/lib/i18n/account-extra";

export default function AddressesPage() {
  const { user, addresses, addAddress, removeAddress } = useAuth();
  const { lang, t } = useLang();
  const copy = accountExtraCopy[lang];
  const [val, setVal] = useState("");
  if (!user) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = val.trim();
    if (!v) return;
    addAddress(v);
    setVal("");
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-slate-900">{t("acc.addrT")}</h1>

      {addresses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">{t("acc.addrEmpty")}</p>
      ) : (
        <div className="space-y-3">
          {addresses.map((a, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl border border-slate-100 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><MapPin className="h-5 w-5" /></span>
                <span className="text-slate-800">{a}</span>
              </div>
              <button onClick={() => removeAddress(i)} aria-label={copy.removeAddress} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-accent-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-100 p-5">
        <h2 className="font-display text-lg font-bold text-slate-900">{t("acc.addrAdd")}</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder={t("acc.addrPh")} className="h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 font-semibold text-white transition hover:bg-brand-700">
            <Plus className="h-5 w-5" /> {t("acc.add")}
          </button>
        </div>
      </form>
    </div>
  );
}
