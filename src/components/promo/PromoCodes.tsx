"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/lib/ui/ToastContext";
import { useLang } from "@/lib/i18n/LanguageContext";

const codes = [
  { badge: "−20%", sKey: "promos.c1.s", code: "KBEAUTY20", from: "#14a085", to: "#0b6f3c" },
  { badge: "0 ₸", sKey: "promos.c2.s", code: "GOLDFREE", from: "#6d6af6", to: "#4338ca" },
  { badge: "+300", sKey: "promos.c3.s", code: "IMMUNO300", from: "#ff7350", to: "#df451f" },
];

export function PromoCodes() {
  const { push } = useToast();
  const { t } = useLang();
  const copy = (c: string) => {
    try { navigator.clipboard?.writeText(c); } catch { /* ignore */ }
    push(`${t("cart.promo")} ${c} ✓`);
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {codes.map((c) => (
        <div key={c.code} className="overflow-hidden rounded-3xl p-6 text-white" style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}>
          <p className="font-display text-2xl font-extrabold">{c.badge}</p>
          <p className="mt-2 text-sm text-white/90">{t(c.sKey)}</p>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-white/15 px-3 py-2.5 backdrop-blur">
            <code className="font-mono text-sm font-bold tracking-wider">{c.code}</code>
            <button onClick={() => copy(c.code)} className="inline-flex items-center gap-1.5 text-sm font-semibold transition hover:opacity-80">
              <Copy className="h-4 w-4" /> {t("promos.copy")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
