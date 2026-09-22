/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, Trash2, ChevronUp, ChevronDown, Pencil, X, RotateCcw, Lock } from "lucide-react";
import { useContent, ORDER_STATUSES, uid, type Content } from "@/lib/content/ContentContext";
import { CollectionIcon, ICON_NAMES } from "@/components/ui/CollectionIcon";
import { NotificationsAdmin } from "@/components/admin/NotificationsAdmin";
import { OrdersAdmin } from "@/components/admin/OrdersAdmin";

type AdminTab = keyof Content | "notifications";
const TABS: [AdminTab, string][] = [
  ["banners", "Баннеры"],
  ["quickLinks", "Быстрые ссылки"],
  ["stories", "Сторис"],
  ["collections", "Подборки"],
  ["promos", "Промокоды"],
  ["orders", "Заказы"],
  ["notifications", "Уведомления"],
];
// Конкретные адреса для выбора (реальные страницы сайта) — общий список для всех форм.
const HREF_OPTIONS: { value: string; label: string }[] = [
  { value: "/", label: "Главная" },
  { value: "/catalog", label: "Каталог — все товары" },
  { value: "/catalog/kosmetika", label: "Категория · Косметика и уход" },
  { value: "/catalog/bady", label: "Категория · Витамины и БАДы" },
  { value: "/catalog/lekarstva-i-bady", label: "Категория · Лекарства" },
  { value: "/catalog/mama-i-malysh", label: "Категория · Мама и малыш" },
  { value: "/catalog/zagar-i-zashita-ot-solnca", label: "Категория · Солнцезащита" },
  { value: "/catalog/gigiyena", label: "Категория · Гигиена" },
  { value: "/promotions", label: "Акции" },
  { value: "/brands", label: "Бренды" },
  { value: "/favorites", label: "Избранное" },
  { value: "/pharmacies", label: "Аптеки на карте" },
  { value: "/delivery", label: "Доставка" },
  { value: "/help", label: "Помощь / FAQ" },
  { value: "/about", label: "О компании" },
  { value: "/account/bonuses", label: "Бонусы / лояльность" },
  { value: "/cart", label: "Корзина" },
];
const HREF_CUSTOM = "__custom__";
const tenge = (n: number) => n.toLocaleString("ru-RU") + " ₸";
const clone = (c: Content): Content => JSON.parse(JSON.stringify(c));
const QUICK_IMAGE_POSITIONS: Record<string, string> = { ql1: "62% center", ql2: "65% center", ql3: "64% center", ql4: "64% center" };

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function quickLinkOverlay(from: string, to: string): string {
  return `linear-gradient(180deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.05) 56%, rgba(0,0,0,.2) 100%), linear-gradient(135deg, ${hexToRgba(from, .82)} 0%, ${hexToRgba(from, .28)} 52%, ${hexToRgba(to, .48)} 100%)`;
}

/** Загрузка фото/видео на сервер (POST /api/upload) с превью и кнопкой «убрать». */
function MediaInput({ value, onChange, accept, label }: { value: string; onChange: (url: string) => void; accept: "image" | "video"; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", f);
      let token = ""; try { token = sessionStorage.getItem("ass_admin_token") || ""; } catch { /* ignore */ }
      const r = await fetch("/api/upload", { method: "POST", headers: { "x-admin-token": token }, body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "ошибка загрузки");
      onChange(j.url as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label={label}>
      {value && (
        <div className="relative mb-2 overflow-hidden rounded-xl border border-slate-200">
          {accept === "video"
            ? <video src={value} className="h-32 w-full bg-slate-900 object-cover" muted controls playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={value} alt="" className="h-32 w-full object-cover" />}
          <button onClick={() => onChange("")} className="absolute right-2 top-2 rounded-lg bg-slate-900/70 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900">Убрать</button>
        </div>
      )}
      <input type="file" accept={accept === "video" ? "video/*" : "image/*"} onChange={pick} disabled={busy} className="text-sm" />
      {busy && <span className="ml-2 text-sm text-slate-500">Загрузка…</span>}
      {err && <p className="mt-1 text-sm text-accent-600">{err}</p>}
    </Field>
  );
}

export default function AdminPage() {
  const { content, ready, save, reset } = useContent();
  const [tab, setTab] = useState<AdminTab>("banners");
  const [edit, setEdit] = useState<{ kind: "banner" | "quicklink" | "story" | "collection" | "promo"; draft: any; isNew: boolean } | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- читаем флаг доступа после гидрации намеренно
  useEffect(() => { try { if (sessionStorage.getItem("ass_admin_ok") === "1") setUnlocked(true); } catch { /* ignore */ } }, []);

  const persistContent = async (next: Content): Promise<boolean> => {
    setSaving(true);
    setSaveNotice(null);
    try {
      await save(next);
      setSaveNotice({ kind: "ok", text: "Изменения сохранены на сервере" });
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "content_save_failed";
      const text = code === "unauthorized"
        ? "Не удалось сохранить: сессия администратора недействительна. Войдите заново."
        : code === "content_persist_failed"
          ? "Не удалось сохранить: серверное хранилище контента недоступно. Изменения не опубликованы."
          : "Не удалось сохранить изменения на сервере. Проверьте соединение и повторите попытку.";
      setSaveNotice({ kind: "error", text });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setArr = (key: keyof Content, arr: any[]) => persistContent({ ...content, [key]: arr } as Content);
  const move = async (key: keyof Content, i: number, dir: number) => {
    const a = (clone(content)[key] as any[]); const j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; await setArr(key, a);
  };
  const del = async (key: keyof Content, i: number) => { const a = clone(content)[key] as any[]; a.splice(i, 1); await setArr(key, a); };
  const patch = async (key: keyof Content, i: number, p: any) => { const a = clone(content)[key] as any[]; a[i] = { ...a[i], ...p }; await setArr(key, a); };
  const commit = async () => {
    if (!edit) return;
    const key = (edit.kind === "banner" ? "banners" : edit.kind === "quicklink" ? "quickLinks" : edit.kind === "story" ? "stories" : edit.kind === "collection" ? "collections" : "promos") as keyof Content;
    const a = clone(content)[key] as any[];
    const idx = a.findIndex((x) => x.id === edit.draft.id);
    if (idx >= 0) a[idx] = edit.draft; else a.push(edit.draft);
    if (await setArr(key, a)) setEdit(null);
  };

  const resetContent = async () => {
    setSaving(true);
    setSaveNotice(null);
    try {
      await reset();
      setSaveNotice({ kind: "ok", text: "Стандартный контент сохранён на сервере" });
    } catch {
      setSaveNotice({ kind: "error", text: "Не удалось сбросить контент: сервер не подтвердил сохранение." });
    } finally {
      setSaving(false);
    }
  };

  const newBanner = () => setEdit({ kind: "banner", isNew: true, draft: { id: uid(), eyebrow: "", title: "Новый баннер", sub: "", cta: "Подробнее", href: "/catalog", from: "#34c97d", to: "#0b6f3c", img: "", video: "", on: true } });
  const newQuickLink = () => setEdit({ kind: "quicklink", isNew: true, draft: { id: uid(), label: "Новая ссылка", href: "/catalog", from: "#0a7a41", to: "#0a6b3a", icon: "sparkle", img: "", on: true } });
  const newStory = () => setEdit({ kind: "story", isNew: true, draft: { id: uid(), label: "Новая", icon: "sparkle", href: "/catalog", from: "#34c97d", to: "#0c7d43", img: "", video: "", on: true } });
  const newColl = () => setEdit({ kind: "collection", isNew: true, draft: { id: uid(), title: "Новая подборка", href: "/catalog", from: "#34c97d", to: "#0c7d43", icon: "sparkle" } });
  const newPromo = () => setEdit({ kind: "promo", isNew: true, draft: { id: uid(), code: "", type: "percent", value: 10, note: "" } });

  if (!ready) return <div className="p-16 text-center text-slate-400">Загрузка…</div>;
  if (!unlocked) return <AdminGate onUnlock={() => setUnlocked(true)} />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">Админка контента</h1>
          <p className="mt-1 text-sm text-slate-500">Контент сайта и мобильного приложения (общий сервер). Товары и цены — из Medusa, сюда не входят.</p>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={saving} onClick={() => { if (confirm("Сбросить весь контент к стандартному?")) void resetContent(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
            <RotateCcw className="h-4 w-4" /> Сбросить
          </button>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" /> На сайт
          </Link>
        </div>
      </div>

      {saveNotice && (
        <div
          role={saveNotice.kind === "error" ? "alert" : "status"}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${saveNotice.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
        >
          {saveNotice.text}
        </div>
      )}

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 no-scrollbar">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "banners" && (
          <Section onAdd={newBanner} addLabel="Добавить баннер">
            {content.banners.map((b, i) => (
              <Row key={b.id} onUp={() => move("banners", i, -1)} onDown={() => move("banners", i, 1)} onEdit={() => setEdit({ kind: "banner", isNew: false, draft: { ...b } })} onDel={() => del("banners", i)}>
                <div className="relative h-12 w-16 flex-none overflow-hidden rounded-lg" style={{ background: b.img ? `linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.45)), url(${JSON.stringify(b.img)}) center/cover` : `linear-gradient(135deg, ${b.from}, ${b.to})` }}>
                  {b.video && <span className="absolute inset-0 grid place-items-center bg-black/30 text-[10px] font-bold text-white">▶ ВИДЕО</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{b.title.replace(/\n/g, " ")}</p>
                  <p className="truncate text-xs text-slate-500">{b.eyebrow} · {b.href}</p>
                </div>
                <Toggle on={b.on} onClick={() => patch("banners", i, { on: !b.on })} />
              </Row>
            ))}
          </Section>
        )}

        {tab === "quickLinks" && (
          <Section onAdd={newQuickLink} addLabel="Добавить ссылку">
            {content.quickLinks.map((q, i) => (
              <Row key={q.id} onUp={() => move("quickLinks", i, -1)} onDown={() => move("quickLinks", i, 1)} onEdit={() => setEdit({ kind: "quicklink", isNew: false, draft: { ...q } })} onDel={() => del("quickLinks", i)}>
                <div className="relative grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${q.from}, ${q.to})` }}>
                  {q.img && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={q.img} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: QUICK_IMAGE_POSITIONS[q.id] || "center" }} />
                      <span className="absolute inset-0" style={{ background: quickLinkOverlay(q.from, q.to) }} />
                    </>
                  )}
                  {!q.img && <CollectionIcon name={q.icon} className="h-6 w-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{q.label}</p>
                  <p className="truncate text-xs text-slate-500">{q.href}</p>
                </div>
                <Toggle on={q.on} onClick={() => patch("quickLinks", i, { on: !q.on })} />
              </Row>
            ))}
          </Section>
        )}

        {tab === "stories" && (
          <Section onAdd={newStory} addLabel="Добавить сторис">
            {content.stories.map((s, i) => (
              <Row key={s.id} onUp={() => move("stories", i, -1)} onDown={() => move("stories", i, 1)} onEdit={() => setEdit({ kind: "story", isNew: false, draft: { ...s } })} onDel={() => del("stories", i)}>
                <div className="relative grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-full text-white" style={{ background: `linear-gradient(150deg, ${s.from}, ${s.to})` }}>
                  {s.img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.img} alt="" className="h-full w-full object-cover" />
                    : <CollectionIcon name={s.icon} className="h-6 w-6" />}
                  {s.video && <span className="absolute bottom-0 inset-x-0 bg-black/45 text-center text-[8px] font-bold text-white">▶</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{s.label}</p>
                  <p className="truncate text-xs text-slate-500">{s.href}</p>
                </div>
                <Toggle on={s.on} onClick={() => patch("stories", i, { on: !s.on })} />
              </Row>
            ))}
          </Section>
        )}

        {tab === "collections" && (
          <Section onAdd={newColl} addLabel="Добавить подборку">
            {content.collections.map((c, i) => (
              <Row key={c.id} onUp={() => move("collections", i, -1)} onDown={() => move("collections", i, 1)} onEdit={() => setEdit({ kind: "collection", isNew: false, draft: { ...c } })} onDel={() => del("collections", i)}>
                <div className="grid h-12 w-12 flex-none place-items-center rounded-lg text-white" style={{ background: `linear-gradient(150deg, ${c.from}, ${c.to})` }}>
                  <CollectionIcon name={c.icon} className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{c.title}</p>
                  <p className="truncate text-xs text-slate-500">{c.href}</p>
                </div>
              </Row>
            ))}
          </Section>
        )}

        {tab === "promos" && (
          <Section onAdd={newPromo} addLabel="Добавить промокод">
            {content.promos.map((p, i) => (
              <Row key={p.id} onEdit={() => setEdit({ kind: "promo", isNew: false, draft: { ...p } })} onDel={() => del("promos", i)}>
                <div className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-brand-600 font-display text-xs font-bold text-white">%</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold tracking-wide text-slate-900">{p.code}</p>
                  <p className="truncate text-xs text-slate-500">{p.type === "percent" ? `−${p.value}%` : p.type === "amount" ? `−${tenge(p.value)}` : "Бесплатная доставка"}{p.note ? ` · ${p.note}` : ""}</p>
                </div>
              </Row>
            ))}
          </Section>
        )}

        {tab === "notifications" && <NotificationsAdmin />}
        {tab === "orders" && <OrdersAdmin />}

        {false && (
          content.orders.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">Заказов пока нет</p>
          ) : (
            <div className="space-y-2.5">
              {content.orders.map((o, i) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-soft">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-extrabold text-slate-900">Заказ №{o.n}</p>
                    <p className="text-xs text-slate-500">{o.date} · {tenge(o.sum)} · {o.items} тов.</p>
                  </div>
                  <select value={o.status} onChange={(e) => patch("orders", i, { status: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-brand-500">
                    {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <button onClick={() => del("orders", i)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-accent-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setEdit(null)} />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-pop sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-extrabold">{edit.isNew ? "Новый элемент" : "Редактирование"}</h3>
              <button onClick={() => setEdit(null)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            {edit.kind === "banner" && <BannerForm draft={edit.draft} set={(d: any) => setEdit({ ...edit, draft: d })} />}
            {edit.kind === "quicklink" && <QuickLinkForm draft={edit.draft} set={(d: any) => setEdit({ ...edit, draft: d })} />}
            {edit.kind === "story" && <StoryForm draft={edit.draft} set={(d: any) => setEdit({ ...edit, draft: d })} />}
            {edit.kind === "collection" && <CollectionForm draft={edit.draft} set={(d: any) => setEdit({ ...edit, draft: d })} />}
            {edit.kind === "promo" && <PromoForm draft={edit.draft} set={(d: any) => setEdit({ ...edit, draft: d })} />}

            {saveNotice?.kind === "error" && (
              <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
                {saveNotice.text}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setEdit(null)} className="h-12 flex-none rounded-xl border border-slate-200 px-5 font-semibold text-slate-600">Отмена</button>
              <button disabled={saving} onClick={() => void commit()} className="h-12 flex-1 rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">{saving ? "Сохраняем…" : "Сохранить"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // Код проверяется НА СЕРВЕРЕ (/api/admin/verify) — секрет не лежит в клиентском бандле.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(false);
    try {
      const r = await fetch("/api/admin/verify", { method: "POST", headers: { "x-admin-token": pin } });
      if (r.ok) {
        try { sessionStorage.setItem("ass_admin_ok", "1"); sessionStorage.setItem("ass_admin_token", pin); } catch { /* ignore */ }
        onUnlock();
      } else {
        setErr(true);
      }
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <div className="rounded-3xl border border-slate-100 bg-white p-7 shadow-card">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white"><Lock className="h-6 w-6" /></span>
        <h1 className="mt-4 font-display text-xl font-extrabold text-slate-900">Админка контента</h1>
        <p className="mt-1 text-sm text-slate-500">Введите код доступа, чтобы редактировать витрину.</p>
        <form onSubmit={submit} className="mt-5">
          <input type="password" value={pin} onChange={(e) => { setPin(e.target.value); setErr(false); }} placeholder="Код доступа" autoFocus className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          {err && <p className="mt-2 text-sm text-accent-600">Неверный код доступа</p>}
          <button type="submit" disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-brand-600 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">{busy ? "Проверка…" : "Войти"}</button>
        </form>
        <Link href="/" className="mt-3 block text-center text-sm text-slate-500 transition hover:text-brand-700">← На сайт</Link>
      </div>
    </div>
  );
}

function Section({ children, onAdd, addLabel }: { children: React.ReactNode; onAdd: () => void; addLabel: string }) {
  return (
    <div>
      <div className="space-y-2.5">{children}</div>
      <button onClick={onAdd} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700">
        <Plus className="h-5 w-5" /> {addLabel}
      </button>
    </div>
  );
}

function Row({ children, onEdit, onDel, onUp, onDown }: { children: React.ReactNode; onEdit: () => void; onDel: () => void; onUp?: () => void; onDown?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-soft">
      {children}
      <div className="flex flex-none items-center">
        {onUp && <button onClick={onUp} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"><ChevronUp className="h-4 w-4" /></button>}
        {onDown && <button onClick={onDown} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"><ChevronDown className="h-4 w-4" /></button>}
        <button onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>
        <button onClick={onDel} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-accent-500"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative h-6 w-11 flex-none rounded-full transition ${on ? "bg-brand-600" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-3 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}
const inputCls = "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500";

function HrefSelect({ value, set }: { value: string; set: (v: string) => void }) {
  const known = HREF_OPTIONS.some((o) => o.value === value);
  const [custom, setCustom] = useState(!known && value !== "");
  return (
    <div className="space-y-2">
      <select
        value={custom ? HREF_CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === HREF_CUSTOM) setCustom(true);
          else { setCustom(false); set(e.target.value); }
        }}
        className={inputCls}
      >
        {HREF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label} — {o.value}</option>)}
        <option value={HREF_CUSTOM}>Другой адрес…</option>
      </select>
      {custom && (
        <input
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder="/любой/путь или https://…"
          className={inputCls}
        />
      )}
    </div>
  );
}

function BannerForm({ draft, set }: { draft: any; set: (d: any) => void }) {
  const bg = draft.img ? `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)), url(${JSON.stringify(draft.img)}) center/cover` : `linear-gradient(120deg, ${draft.from}, ${draft.to})`;
  return (
    <div>
      <div className="mb-3 flex h-28 flex-col justify-center rounded-2xl px-4 text-white" style={{ background: bg }}>
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-90">{draft.eyebrow || "надзаголовок"}</span>
        <span className="font-display text-xl font-extrabold leading-tight drop-shadow">{(draft.title || "Заголовок").replace(/\n/g, " ")}</span>
      </div>
      <MediaInput label="Фото (текст ляжет поверх)" accept="image" value={draft.img || ""} onChange={(url) => set({ ...draft, img: url })} />
      <MediaInput label="Видео-фон (приоритетнее фото, без звука)" accept="video" value={draft.video || ""} onChange={(url) => set({ ...draft, video: url })} />
      <Field label="Надзаголовок"><input value={draft.eyebrow} onChange={(e) => set({ ...draft, eyebrow: e.target.value })} className={inputCls} /></Field>
      <Field label="Заголовок (Enter — новая строка)"><textarea value={draft.title} onChange={(e) => set({ ...draft, title: e.target.value })} rows={2} className={inputCls} /></Field>
      <Field label="Подпись"><input value={draft.sub} onChange={(e) => set({ ...draft, sub: e.target.value })} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Текст кнопки"><input value={draft.cta} onChange={(e) => set({ ...draft, cta: e.target.value })} className={inputCls} /></Field>
        <Field label="Кнопка ведёт"><HrefSelect value={draft.href} set={(v) => set({ ...draft, href: v })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Цвет 1"><input type="color" value={draft.from} onChange={(e) => set({ ...draft, from: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
        <Field label="Цвет 2"><input type="color" value={draft.to} onChange={(e) => set({ ...draft, to: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={draft.on} onChange={(e) => set({ ...draft, on: e.target.checked })} /> Показывать на сайте</label>
    </div>
  );
}

function QuickLinkForm({ draft, set }: { draft: any; set: (d: any) => void }) {
  // авто-цвет текста по яркости верхнего стопа — как на сайте (любой цвет остаётся читаемым)
  const light = (() => {
    const m = /^#?([0-9a-f]{6})$/i.exec((draft.from || "").trim());
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6;
  })();
  return (
    <div>
      <div className="relative mb-3 flex h-28 items-start overflow-hidden rounded-2xl p-4" style={{ background: `linear-gradient(135deg, ${draft.from}, ${draft.to})` }}>
        {draft.img && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.img} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: QUICK_IMAGE_POSITIONS[draft.id] || "center" }} />
            <span className="absolute inset-0" style={{ background: quickLinkOverlay(draft.from, draft.to) }} />
          </>
        )}
        <span className={`relative z-10 max-w-[70%] text-[15px] font-extrabold uppercase leading-tight ${draft.img ? "text-white" : light ? "text-slate-900" : "text-white"}`}>{draft.label || "Заголовок"}</span>
        {draft.img ? (
          <span className="absolute bottom-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-900 shadow-sm">
            <ArrowRight className="h-4 w-4" />
          </span>
        ) : (
          <CollectionIcon name={draft.icon} className={`pointer-events-none absolute -bottom-3 -right-2 h-20 w-20 ${light ? "text-slate-900/15" : "text-white/25"}`} />
        )}
      </div>
      <MediaInput label="Фото карточки" accept="image" value={draft.img || ""} onChange={(url) => set({ ...draft, img: url })} />
      <Field label="Заголовок (коротко — 1–2 слова)"><input value={draft.label} onChange={(e) => set({ ...draft, label: e.target.value })} className={inputCls} /></Field>
      <Field label="Ведёт в (ссылка)"><HrefSelect value={draft.href} set={(v) => set({ ...draft, href: v })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Градиент: цвет сверху"><input type="color" value={draft.from} onChange={(e) => set({ ...draft, from: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
        <Field label="Градиент: цвет снизу"><input type="color" value={draft.to} onChange={(e) => set({ ...draft, to: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
      </div>
      <Field label="Иконка">
        <div className="flex flex-wrap gap-2">
          {ICON_NAMES.map((n) => (
            <button key={n} onClick={() => set({ ...draft, icon: n })} className={`grid h-11 w-11 place-items-center rounded-xl border text-slate-600 ${draft.icon === n ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>
              <CollectionIcon name={n} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={draft.on} onChange={(e) => set({ ...draft, on: e.target.checked })} /> Показывать на сайте</label>
    </div>
  );
}

function CollectionForm({ draft, set }: { draft: any; set: (d: any) => void }) {
  return (
    <div>
      <div className="relative mb-3 grid h-32 place-items-center overflow-hidden rounded-2xl text-white" style={{ background: `linear-gradient(150deg, ${draft.from}, ${draft.to})` }}>
        {draft.img && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.img} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${draft.from}d9, ${draft.to}d9)` }} />
          </>
        )}
        <CollectionIcon name={draft.icon} className="relative z-10 h-12 w-12" />
      </div>
      <Field label="Заголовок"><input value={draft.title} onChange={(e) => set({ ...draft, title: e.target.value })} className={inputCls} /></Field>
      <Field label="Ведёт в"><HrefSelect value={draft.href} set={(v) => set({ ...draft, href: v })} /></Field>
      <MediaInput label="Фото карточки" accept="image" value={draft.img || ""} onChange={(url) => set({ ...draft, img: url })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Цвет 1"><input type="color" value={draft.from} onChange={(e) => set({ ...draft, from: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
        <Field label="Цвет 2"><input type="color" value={draft.to} onChange={(e) => set({ ...draft, to: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
      </div>
      <Field label="Иконка">
        <div className="flex flex-wrap gap-2">
          {ICON_NAMES.map((n) => (
            <button key={n} onClick={() => set({ ...draft, icon: n })} className={`grid h-11 w-11 place-items-center rounded-xl border text-slate-600 ${draft.icon === n ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>
              <CollectionIcon name={n} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

function StoryForm({ draft, set }: { draft: any; set: (d: any) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-full text-white" style={{ background: `linear-gradient(150deg, ${draft.from}, ${draft.to})` }}>
          {draft.img
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={draft.img} alt="" className="h-full w-full object-cover" />
            : <CollectionIcon name={draft.icon} className="h-8 w-8" />}
        </div>
        <p className="text-sm text-slate-500">Фото/видео на весь экран (как в Instagram). Без медиа — иконка на кольце.</p>
      </div>
      <Field label="Подпись"><input value={draft.label} onChange={(e) => set({ ...draft, label: e.target.value })} className={inputCls} /></Field>
      <Field label="Ведёт в"><HrefSelect value={draft.href} set={(v) => set({ ...draft, href: v })} /></Field>
      <MediaInput label="Фото (превью кружка + полный экран)" accept="image" value={draft.img || ""} onChange={(url) => set({ ...draft, img: url })} />
      <MediaInput label="Видео (полноэкранное, без звука)" accept="video" value={draft.video || ""} onChange={(url) => set({ ...draft, video: url })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Цвет кольца 1"><input type="color" value={draft.from} onChange={(e) => set({ ...draft, from: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
        <Field label="Цвет кольца 2"><input type="color" value={draft.to} onChange={(e) => set({ ...draft, to: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200" /></Field>
      </div>
      <Field label="Иконка (если без фото)">
        <div className="flex flex-wrap gap-2">
          {ICON_NAMES.map((n) => (
            <button key={n} onClick={() => set({ ...draft, icon: n })} className={`grid h-11 w-11 place-items-center rounded-xl border text-slate-600 ${draft.icon === n ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200"}`}>
              <CollectionIcon name={n} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={draft.on} onChange={(e) => set({ ...draft, on: e.target.checked })} /> Показывать</label>
    </div>
  );
}

function PromoForm({ draft, set }: { draft: any; set: (d: any) => void }) {
  return (
    <div>
      <Field label="Код"><input value={draft.code} onChange={(e) => set({ ...draft, code: e.target.value.toUpperCase() })} className={inputCls + " uppercase tracking-wide"} /></Field>
      <Field label="Тип скидки">
        <select value={draft.type} onChange={(e) => set({ ...draft, type: e.target.value })} className={inputCls}>
          <option value="percent">Процент %</option>
          <option value="amount">Сумма ₸</option>
          <option value="free">Бесплатная доставка</option>
        </select>
      </Field>
      <Field label="Значение (% или ₸)"><input type="number" value={draft.value} onChange={(e) => set({ ...draft, value: Number(e.target.value) || 0 })} className={inputCls} /></Field>
      <Field label="Описание"><input value={draft.note} onChange={(e) => set({ ...draft, note: e.target.value })} className={inputCls} /></Field>
    </div>
  );
}
