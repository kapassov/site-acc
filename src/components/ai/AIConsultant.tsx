"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Stethoscope, Sparkles, Send, Info, Plus, MapPin, Heart } from "lucide-react";
import type { Product } from "@/lib/types";
import { useCatalogData } from "@/lib/content/CatalogData";
import { aiTrending, aiChips, getAiIntent, type AiChipId, type AiIntentId, type AiPick, type AiWhyId } from "@/lib/data/ai";
import { aiCopy, findAiIntent } from "@/lib/data/ai-copy";
import { ProductImage } from "@/components/ui/ProductImage";
import { useCart } from "@/lib/cart/CartContext";
import { useToast } from "@/lib/ui/ToastContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";

type RecoItem = { product: Product; whyId: AiWhyId };
type BotTextKey = "ai.greet" | "ai.trendIntro" | "ai.clarify";
type Msg = {
  id: number;
  role: "user" | "bot";
  /** Only real user input is stored as text; assistant copy stays locale-independent. */
  text?: string;
  chipId?: AiChipId;
  botTextKey?: BotTextKey;
  intentId?: AiIntentId;
  trend?: boolean;
  typing?: boolean;
};

/** Разрешает абстрактные подсказки в реальные товары из живого каталога (Medusa). */
function resolveCards(picks: AiPick[], pool: Product[]): RecoItem[] {
  if (pool.length === 0) return [];
  const used = new Set<string>();
  const hay = (p: Product) => `${p.name} ${p.brand} ${p.categorySlug ?? ""}`.toLowerCase();
  const out: RecoItem[] = [];
  for (const pk of picks) {
    const matched = pool.find((p) => !used.has(p.id) && pk.match.some((k) => hay(p).includes(k)));
    const prod = matched ?? pool.find((p) => !used.has(p.id));
    if (prod) {
      used.add(prod.id);
      out.push({ product: prod, whyId: matched ? pk.whyId : "generic" });
    }
  }
  return out;
}

export function AIConsultant() {
  const { add } = useCart();
  const { push } = useToast();
  const { t, lang } = useLang();
  const locale = aiCopy[lang];
  const { products: pool } = useCatalogData();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const append = (m: Omit<Msg, "id">) => {
    idRef.current += 1;
    const id = idRef.current;
    setMessages((p) => [...p, { ...m, id }]);
    return id;
  };

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    append({ role: "bot", botTextKey: "ai.greet" });
    const tid = append({ role: "bot", typing: true });
    setTimeout(() => {
      setMessages((p) => p.map((m) => (m.id === tid ? { ...m, typing: false, botTextKey: "ai.trendIntro", trend: true } : m)));
    }, 900);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const ask = (q: string, requestedIntentId?: AiIntentId, chipId?: AiChipId) => {
    const query = q.trim();
    if (!query) return;
    append({ role: "user", text: chipId ? undefined : query, chipId });
    setInput("");
    const tid = append({ role: "bot", typing: true });
    setTimeout(() => {
      const intent = requestedIntentId ? getAiIntent(requestedIntentId) : findAiIntent(query, lang);
      setMessages((p) => p.map((m) => (m.id === tid
        ? (intent ? { ...m, typing: false, intentId: intent.id } : { ...m, typing: false, botTextKey: "ai.clarify" })
        : m)));
    }, 850);
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white"><Stethoscope className="h-6 w-6" /></span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">{t("ai.title")}</h1>
          <p className="text-sm text-slate-500">{t("ai.sub")}</p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t("ai.disclaimer")}
      </div>

      {/* Инструкция «как пользоваться» — компактно, в верхней части над чатом */}
      <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/50 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-brand-600" />
          <h2 className="font-display text-sm font-bold text-slate-900">{t("hw.title")}</h2>
        </div>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex gap-2.5 sm:flex-col sm:gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{n}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{t(`hw.s${n}.t`)}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t(`hw.s${n}.d`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-5 flex-1 space-y-4">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} pool={pool} onAdd={(p) => { add(p); push(t("ai.toastAdd")); }} notify={push} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {aiChips.map((c) => (
          <button key={c.id} onClick={() => ask(locale.chips[c.id].query, c.intentId, c.id)} className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700">
            {locale.chips[c.id].label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="sticky bottom-4 mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-soft">
        <input id="saumi-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("ai.ph")} className="h-11 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-slate-400" />
        <button type="submit" aria-label={locale.send} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-700">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

function Bubble({ m, pool, onAdd, notify }: { m: Msg; pool: Product[]; onAdd: (p: Product) => void; notify: (msg: string) => void }) {
  const { t, lang } = useLang();
  const locale = aiCopy[lang];
  const isBot = m.role === "bot";
  const intent = m.intentId ? getAiIntent(m.intentId) : null;
  const picks = m.trend ? aiTrending : intent?.picks;
  const cards = picks ? resolveCards(picks, pool) : [];
  const messageText = m.chipId ? locale.chips[m.chipId].query : m.text ?? (m.botTextKey ? t(m.botTextKey) : m.intentId ? locale.intents[m.intentId].intro : undefined);
  const warning = m.intentId ? locale.intents[m.intentId].warn : undefined;
  return (
    <div className={cn("flex gap-2.5", !isBot && "flex-row-reverse")}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold", isBot ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600")}>
        {isBot ? <Stethoscope className="h-5 w-5" /> : locale.userAvatar}
      </span>
      <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed", isBot ? "bg-slate-50 text-slate-700" : "bg-brand-600 text-white")}>
        {m.typing ? (
          <span className="flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
        ) : (
          <>
            {messageText && <p>{messageText}</p>}
            {m.trend && <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-600"><Sparkles className="h-3.5 w-3.5" /> {t("ai.trendBadge")}</div>}
            {cards.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {cards.map((c) => <RecoCard key={c.product.id} product={c.product} whyId={c.whyId} onAdd={onAdd} />)}
              </div>
            )}
            {warning && <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> {warning}</div>}
            {cards.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button onClick={() => notify(t("ai.toastNear"))} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200 transition hover:text-brand-700"><MapPin className="h-3.5 w-3.5" /> {t("ai.where")}</button>
                <button onClick={() => notify(t("ai.toastSave"))} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 ring-1 ring-slate-200 transition hover:text-brand-700"><Heart className="h-3.5 w-3.5" /> {t("ai.save")}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecoCard({ product, whyId, onAdd }: { product: Product; whyId: AiWhyId; onAdd: (p: Product) => void }) {
  const { t, lang } = useLang();
  return (
    <div className="flex gap-3 rounded-xl bg-white p-2.5 ring-1 ring-slate-100">
      <Link href={`/product/${product.slug}`} className="shrink-0">
        <ProductImage product={product} className="h-16 w-16 overflow-hidden rounded-lg" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{product.brand}</p>
        <Link href={`/product/${product.slug}`} className="line-clamp-1 text-sm font-medium text-slate-800 transition hover:text-brand-700">{product.name}</Link>
        <p className="mt-1 flex items-start gap-1 text-xs text-slate-500"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" /> {aiCopy[lang].why[whyId]}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-bold text-slate-900">{product.priceTBD ? t("card.priceTBD") : tenge(product.price)}</span>
          <button onClick={() => { if (!product.priceTBD) onAdd(product); }} disabled={product.priceTBD} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-50 px-3 text-xs font-semibold text-brand-700 transition hover:bg-brand-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> {t("ai.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
