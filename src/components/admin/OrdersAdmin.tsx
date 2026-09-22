"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ORDER_STATUSES, type Order } from "@/lib/content/defaults";

type AdminOrder = Order & { createdAt?: string };

function token() {
  try { return sessionStorage.getItem("ass_admin_token") || ""; } catch { return ""; }
}

export function OrdersAdmin() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const r = await fetch("/api/admin/orders", { headers: { "x-admin-token": token() }, cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Не удалось загрузить заказы");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Не удалось загрузить заказы");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- первичная загрузка серверных заказов после открытия вкладки
  useEffect(() => { void load(); }, [load]);

  async function changeStatus(order: AdminOrder, status: string) {
    if (status === order.status) return;
    const previous = order.status;
    setBusy(order.id); setMessage("");
    setOrders((list) => list.map((x) => x.id === order.id ? { ...x, status } : x));
    try {
      const r = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-admin-token": token() },
        body: JSON.stringify({ id: order.id, status }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Не удалось изменить статус");
      const push = await fetch("/api/admin/notifications/order-status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token() },
        body: JSON.stringify({ orderNumber: order.n, status }),
      });
      const pushData = await push.json().catch(() => ({}));
      const sent = Number(pushData?.sent ?? pushData?.delivery?.sent ?? 0);
      setMessage(push.ok && sent > 0
        ? `Статус сохранён, уведомление отправлено на ${sent} устройство`
        : "Статус сохранён. Устройство пока не подписано на уведомления.");
    } catch (e) {
      setOrders((list) => list.map((x) => x.id === order.id ? { ...x, status: previous } : x));
      setMessage(e instanceof Error ? e.message : "Не удалось изменить статус");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold text-slate-900">Заказы покупателей</h2>
          <p className="text-sm text-slate-500">Смена статуса автоматически отправляет уведомление покупателю.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>
      {message && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{message}</p>}
      {loading ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">Загрузка…</p>
      ) : orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">Заказов пока нет</p>
      ) : (
        <div className="space-y-2.5">
          {orders.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-soft">
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-extrabold text-slate-900">Заказ №{order.n}</p>
                <p className="text-xs text-slate-500">{order.date} · {order.sum.toLocaleString("ru-RU")} ₸ · {order.items} тов.</p>
              </div>
              <select value={order.status} disabled={busy === order.id} onChange={(e) => void changeStatus(order, e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-brand-500 disabled:opacity-60">
                {ORDER_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
