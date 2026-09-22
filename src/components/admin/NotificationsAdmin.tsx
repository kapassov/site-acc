"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  History,
  Link2,
  LoaderCircle,
  Megaphone,
  PackageCheck,
  RefreshCw,
  Send,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";

type Audience = "all" | "promos" | "orders";

type NotificationStats = {
  active: number;
  promos: number;
  orders: number;
  sent: number;
};

type HistoryItem = {
  id: string;
  title: string;
  body: string;
  audience: Audience | string;
  status: string;
  sent: number;
  failed: number;
  createdAt: string;
};

type NotificationForm = {
  title: string;
  body: string;
  deeplink: string;
  audience: Audience;
};

const EMPTY_STATS: NotificationStats = { active: 0, promos: 0, orders: 0, sent: 0 };

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "Всем подписчикам",
  promos: "Подписчикам акций",
  orders: "Покупателям",
};

const QUICK_TEMPLATES: Array<NotificationForm & { name: string; icon: typeof ShoppingBag }> = [
  {
    name: "Заказ принят",
    icon: ShoppingBag,
    title: "Заказ принят",
    body: "Ваш заказ №{{orderNumber}} принят и передан в сборку.",
    deeplink: "/account/orders",
    audience: "orders",
  },
  {
    name: "Заказ в пути",
    icon: Truck,
    title: "Заказ уже в пути",
    body: "Курьер забрал заказ №{{orderNumber}}. Скоро он будет у вас.",
    deeplink: "/account/orders",
    audience: "orders",
  },
  {
    name: "Готов к выдаче",
    icon: PackageCheck,
    title: "Заказ готов к выдаче",
    body: "Заказ №{{orderNumber}} собран. Покажите код получения в аптеке.",
    deeplink: "/account/orders",
    audience: "orders",
  },
  {
    name: "Новая акция",
    icon: Megaphone,
    title: "Новая акция в аптеке",
    body: "Открывайте подборку и выбирайте товары по специальным ценам.",
    deeplink: "/promotions",
    audience: "promos",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberFrom(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function textFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeHistory(value: unknown, index: number): HistoryItem {
  const row = asRecord(value);
  const rawAudience = row.audience;
  let audience = typeof rawAudience === "string" ? rawAudience : "all";
  if (rawAudience && typeof rawAudience === "object") {
    const audienceObject = asRecord(rawAudience);
    audience = audienceObject.marketingOnly ? "promos" : textFrom(audienceObject.type, "all");
  }
  return {
    id: textFrom(row.id, row.messageId, `notification-${index}`),
    title: textFrom(row.title, "Без заголовка"),
    body: textFrom(row.body, row.text),
    audience,
    status: textFrom(row.status, "sent"),
    sent: numberFrom(row.sent, row.sentCount, row.successCount),
    failed: numberFrom(row.failed, row.failedCount, row.failureCount),
    createdAt: textFrom(row.createdAt, row.sentAt, row.date),
  };
}

function audienceLabel(value: string): string {
  return AUDIENCE_LABELS[value as Audience] ?? value;
}

function statusMeta(status: string): { label: string; className: string } {
  switch (status.toLowerCase()) {
    case "sent":
    case "delivered":
    case "success":
      return { label: "Отправлено", className: "bg-emerald-50 text-emerald-700" };
    case "partial":
      return { label: "Частично", className: "bg-amber-50 text-amber-700" };
    case "failed":
    case "error":
      return { label: "Ошибка", className: "bg-red-50 text-red-700" };
    case "sending":
    case "queued":
    case "pending":
      return { label: "Отправляется", className: "bg-sky-50 text-sky-700" };
    default:
      return { label: status || "Неизвестно", className: "bg-slate-100 text-slate-600" };
  }
}

function adminToken(): string {
  try {
    return sessionStorage.getItem("ass_admin_token") || "";
  } catch {
    return "";
  }
}

export function NotificationsAdmin() {
  const [stats, setStats] = useState<NotificationStats>(EMPTY_STATS);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState<NotificationForm>({
    title: "",
    body: "",
    deeplink: "/",
    audience: "all",
  });

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const token = adminToken();
      if (!token) throw new Error("Сессия администратора истекла. Войдите в админку снова.");
      const response = await fetch("/api/admin/notifications", {
        cache: "no-store",
        headers: { "x-admin-token": token },
      });
      const payload: unknown = await response.json().catch(() => ({}));
      const data = asRecord(payload);
      if (!response.ok) throw new Error(textFrom(data.error, data.message, "Не удалось загрузить уведомления"));

      const rawStats = Object.keys(asRecord(data.stats)).length ? asRecord(data.stats) : data;
      setStats({
        active: numberFrom(rawStats.active, rawStats.activeSubscribers, rawStats.subscribers),
        promos: numberFrom(rawStats.promos, rawStats.promoSubscribers, rawStats.marketingSubscribers),
        orders: numberFrom(rawStats.orders, rawStats.orderSubscribers, rawStats.customers),
        sent: numberFrom(rawStats.sent, rawStats.sentTotal, rawStats.totalSent),
      });

      const rawHistory = Array.isArray(data.history)
        ? data.history
        : Array.isArray(data.messages)
          ? data.messages
          : [];
      setItems(rawHistory.map(normalizeHistory));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const updateForm = <K extends keyof NotificationForm>(key: K, value: NotificationForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setSuccess("");
  };

  const applyTemplate = (template: NotificationForm) => {
    setForm(template);
    setError("");
    setSuccess("");
  };

  const sendNow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = form.title.trim();
    const body = form.body.trim();
    const deeplink = form.deeplink.trim() || "/";
    if (!title || !body) {
      setError("Заполните заголовок и текст уведомления.");
      setSuccess("");
      return;
    }
    if (!window.confirm(`Отправить уведомление: ${AUDIENCE_LABELS[form.audience].toLowerCase()}?`)) return;

    setSending(true);
    setError("");
    setSuccess("");
    try {
      const token = adminToken();
      if (!token) throw new Error("Сессия администратора истекла. Войдите в админку снова.");
      const response = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ title, body, deeplink, audience: form.audience }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      const data = asRecord(payload);
      if (!response.ok) throw new Error(textFrom(data.error, data.message, "Не удалось отправить уведомление"));
      const sent = numberFrom(data.sent, data.sentCount, data.successCount);
      const failed = numberFrom(data.failed, data.failedCount, data.failureCount);
      setSuccess(
        sent || failed
          ? `Рассылка завершена: отправлено ${sent.toLocaleString("ru-RU")}${failed ? `, ошибок ${failed.toLocaleString("ru-RU")}` : ""}.`
          : textFrom(data.message, "Уведомление поставлено в очередь."),
      );
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить уведомление");
    } finally {
      setSending(false);
    }
  };

  const statCards = [
    { label: "Активные", value: stats.active, hint: "подписчиков", icon: Users, className: "bg-brand-50 text-brand-700" },
    { label: "Акции", value: stats.promos, hint: "получают рекламу", icon: Megaphone, className: "bg-violet-50 text-violet-700" },
    { label: "Заказы", value: stats.orders, hint: "покупателей", icon: ShoppingBag, className: "bg-amber-50 text-amber-700" },
    { label: "Отправлено", value: stats.sent, hint: "уведомлений", icon: Send, className: "bg-sky-50 text-sky-700" },
  ];

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-100 bg-white shadow-soft">
        <div className="text-center text-slate-500">
          <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-brand-600" />
          <p className="mt-3 text-sm font-medium">Загружаем уведомления…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
              <BellRing className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl font-extrabold text-slate-900">Пуш-уведомления</h2>
              <p className="text-sm text-slate-500">Заказы, статусы доставки и рекламные рассылки</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-soft">
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${card.className}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className="mt-0.5 font-display text-2xl font-extrabold text-slate-900">{card.value.toLocaleString("ru-RU")}</p>
              <p className="text-xs text-slate-500">{card.hint}</p>
            </div>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <span className="flex-1">{error}</span>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <form onSubmit={sendNow} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft sm:p-6">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-brand-600" />
            <h3 className="font-display text-lg font-extrabold text-slate-900">Новая рассылка</h3>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Заголовок</span>
              <input
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                maxLength={80}
                placeholder="Например: Заказ уже в пути"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
                <span>Текст уведомления</span>
                <span className="text-xs font-normal text-slate-400">{form.body.length}/240</span>
              </span>
              <textarea
                value={form.body}
                onChange={(event) => updateForm("body", event.target.value)}
                maxLength={240}
                rows={4}
                placeholder="Коротко опишите событие или предложение"
                className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Получатели</span>
                <select
                  value={form.audience}
                  onChange={(event) => updateForm("audience", event.target.value as Audience)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {(Object.entries(AUDIENCE_LABELS) as Array<[Audience, string]>).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Deeplink</span>
                <span className="flex h-11 items-center rounded-xl border border-slate-200 px-3.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                  <Link2 className="mr-2 h-4 w-4 flex-none text-slate-400" />
                  <input
                    value={form.deeplink}
                    onChange={(event) => updateForm("deeplink", event.target.value)}
                    placeholder="/promotions"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={sending || !form.title.trim() || !form.body.trim()}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Отправляем…" : "Отправить сейчас"}
          </button>
        </form>

        <aside className="rounded-2xl border border-slate-100 bg-white p-5 shadow-soft">
          <h3 className="font-display text-base font-extrabold text-slate-900">Быстрые шаблоны</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Выберите шаблон и при необходимости измените текст перед отправкой.</p>
          <div className="mt-4 space-y-2">
            {QUICK_TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-slate-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">{template.name}</span>
                    <span className="block truncate text-xs text-slate-500">{template.title}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-brand-600" />
            <h3 className="font-display text-lg font-extrabold text-slate-900">История рассылок</h3>
          </div>
          <span className="text-xs font-medium text-slate-400">Последние {items.length}</span>
        </div>

        {items.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <BellRing className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Рассылок пока нет</p>
            <p className="mt-1 text-xs text-slate-500">После первой отправки здесь появится результат.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">Уведомление</th>
                  <th className="px-4 py-3 font-semibold">Получатели</th>
                  <th className="px-4 py-3 font-semibold">Результат</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-5 py-3 text-right font-semibold">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const meta = statusMeta(item.status);
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="max-w-sm px-5 py-4">
                        <p className="font-semibold text-slate-900">{item.title}</p>
                        {item.body && <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</p>}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{audienceLabel(item.audience)}</td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-800">{item.sent.toLocaleString("ru-RU")} отправлено</p>
                        {item.failed > 0 && <p className="mt-0.5 text-xs text-red-600">{item.failed.toLocaleString("ru-RU")} ошибок</p>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right text-xs text-slate-500">{formatDate(item.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default NotificationsAdmin;
