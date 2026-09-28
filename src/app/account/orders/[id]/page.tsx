"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, CreditCard, MapPin, Package, Truck, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { orderStatusMeta, type OrderStatus } from "@/lib/data/account";
import { tenge } from "@/lib/format";
import { useLang } from "@/lib/i18n/LanguageContext";

type Detail = {
  id: string; date: string; status: OrderStatus; total: number; itemsCount: number;
  providerOrderId?: string; sourceSystem?: string;
  paymentStatus?: string; deliveryStatus?: string; providerStatus?: string; providerAvailable: boolean;
  providerOrderAvailable?: boolean; progressStep?: number; createdAt?: string; statusUpdatedAt?: string;
  actions?: { canCancel: boolean; canReturn: boolean };
  requests?: { cancel: { status: string; requestedAt: string } | null; return: { status: string; requestedAt: string } | null };
  deliveryMethod: string; pickupCode?: string | null;
  pharmacy: { name?: string; address?: string };
  delivery: { address?: string; provider?: string; eta?: string; status?: string; trackingUrl?: string | null };
  payment: { method?: string; status?: string; providerMethod?: string | null; authorized?: boolean; paidAt?: string | null; refundAmount?: number; refundStatus?: string | null; chargedTotal?: number | null };
  items: Array<{ productId: string; title: string; quantity: number; unitPrice: number; total: number; handle?: string | null; image?: string | null }>;
};

const copy = {
  ru: { back: "Мои заказы", title: "Детали заказа", loading: "Проверяем актуальный статус…", missing: "Заказ не найден", retry: "Повторить", goods: "Товары", payment: "Оплата", paid: "Оплачено", unpaid: "Ожидает оплаты", payAtPickup: "Оплата при получении", authorized: "Деньги зарезервированы", failedPayment: "Оплата не прошла", canceledPayment: "Платёж отменён", refundPending: "Возврат обрабатывается", refunded: "Возврат выполнен", cash: "Наличными в аптеке", card: "Банковской картой", delivery: "Получение", pickup: "Самовывоз", courier: "Курьерская доставка", pharmacy: "Аптека", address: "Адрес доставки", unavailable: "Daribar временно не вернул актуальный статус. Показаны сохранённые данные заказа.", deliveryAttention: "Курьерская заявка требует подтверждения. Заказ не считается переданным курьеру.", chargedMismatch: "Списанная сумма Daribar отличается от суммы заказа. Не оплачивайте повторно; обратитесь в поддержку с ID заказа.", charged: "Списано", tracking: "Отследить доставку", code: "Код получения", status: "Статус заказа", received: "Принят", assembled: "Собирается", onWay: "В пути", finished: "Получен", cancel: "Отменить заказ", return: "Запросить возврат", cancelConfirm: "Отправить запрос на отмену? Заказ останется активным, пока оператор Daribar не подтвердит отмену.", returnConfirm: "Отправить запрос на возврат? Деньги не вернутся автоматически: решение и сроки подтвердит оператор.", send: "Отправить запрос", dismiss: "Не сейчас", pendingCancel: "Запрос на отмену передан оператору. Пока отмена не подтверждена, заказ остаётся активным.", pendingReturn: "Запрос на возврат передан оператору. Статус платежа обновится после фактического возврата.", requestFailed: "Не удалось отправить запрос. Обновите заказ и попробуйте ещё раз.", serviceTitle: "Помощь с заказом", serviceHint: "Отмена и возврат не выполняются автоматически — ваш запрос увидит оператор." },
  kz: { back: "Менің тапсырыстарым", title: "Тапсырыс мәліметтері", loading: "Өзекті күй тексерілуде…", missing: "Тапсырыс табылмады", retry: "Қайталау", goods: "Тауарлар", payment: "Төлем", paid: "Төленді", unpaid: "Төлем күтілуде", payAtPickup: "Алғанда төлеу", authorized: "Қаражат резервтелді", failedPayment: "Төлем өтпеді", canceledPayment: "Төлем тоқтатылды", refundPending: "Қайтару өңделуде", refunded: "Қаражат қайтарылды", cash: "Дәріханада қолма-қол", card: "Банк картасымен", delivery: "Алу тәсілі", pickup: "Өзі алып кету", courier: "Курьерлік жеткізу", pharmacy: "Дәріхана", address: "Жеткізу мекенжайы", unavailable: "Daribar өзекті күйді уақытша қайтармады. Сақталған деректер көрсетілді.", deliveryAttention: "Курьерлік өтінім растауды қажет етеді. Тапсырыс курьерге берілді деп саналмайды.", chargedMismatch: "Daribar есептен шығарған сома тапсырыс сомасына сәйкес келмейді. Қайта төлемеңіз; тапсырыс ID-сімен қолдауға жүгініңіз.", charged: "Есептен шығарылды", tracking: "Жеткізуді қадағалау", code: "Алу коды", status: "Тапсырыс күйі", received: "Қабылданды", assembled: "Жиналуда", onWay: "Жолда", finished: "Алынды", cancel: "Тапсырысты тоқтату", return: "Қайтаруды сұрау", cancelConfirm: "Тоқтату өтінімін жіберу керек пе? Daribar операторы растағанша тапсырыс күшінде қалады.", returnConfirm: "Қайтару өтінімін жіберу керек пе? Ақша автоматты түрде қайтарылмайды.", send: "Өтінімді жіберу", dismiss: "Қазір емес", pendingCancel: "Тоқтату өтінімі операторға жіберілді. Расталғанша тапсырыс күшінде қалады.", pendingReturn: "Қайтару өтінімі операторға жіберілді. Төлем күйі нақты қайтарудан кейін жаңарады.", requestFailed: "Өтінімді жіберу мүмкін болмады. Қайта көріңіз.", serviceTitle: "Тапсырыс бойынша көмек", serviceHint: "Тоқтату мен қайтару автоматты емес — өтінімді оператор қарайды." },
  en: { back: "My orders", title: "Order details", loading: "Checking the latest status…", missing: "Order not found", retry: "Retry", goods: "Items", payment: "Payment", paid: "Paid", unpaid: "Awaiting payment", payAtPickup: "Pay on collection", authorized: "Funds authorized", failedPayment: "Payment failed", canceledPayment: "Payment canceled", refundPending: "Refund processing", refunded: "Refund completed", cash: "Cash at pharmacy", card: "Bank card", delivery: "Fulfilment", pickup: "Pickup", courier: "Courier delivery", pharmacy: "Pharmacy", address: "Delivery address", unavailable: "Daribar did not return a live status. Saved order details are shown.", deliveryAttention: "The courier booking needs confirmation. The order is not considered handed to a courier.", chargedMismatch: "Daribar charged a different amount from the order total. Do not pay again; contact support with the order ID.", charged: "Charged", tracking: "Track delivery", code: "Pickup code", status: "Order status", received: "Accepted", assembled: "Being prepared", onWay: "On the way", finished: "Received", cancel: "Cancel order", return: "Request a return", cancelConfirm: "Send a cancellation request? The order stays active until a Daribar operator confirms it.", returnConfirm: "Send a return request? A refund is not automatic; an operator will confirm the decision and timing.", send: "Send request", dismiss: "Not now", pendingCancel: "Cancellation request sent to an operator. The order remains active until confirmed.", pendingReturn: "Return request sent to an operator. Payment status changes only after an actual refund.", requestFailed: "Could not send the request. Refresh the order and try again.", serviceTitle: "Order support", serviceHint: "Cancellation and returns are not automatic; an operator reviews the request." },
} as const;

function isPaid(value: string | undefined): boolean {
  return ["paid", "success", "successful", "completed"].includes(String(value || "").toLowerCase());
}

function deliveryFailed(value: string | undefined): boolean {
  return ["failed", "rejected", "cancelled", "canceled"].includes(String(value || "").toLowerCase());
}

function paymentTone(value: string | undefined, authorized: boolean | undefined, refundStatus: string | null | undefined) {
  const status = String(value || "").toLowerCase();
  if (refundStatus === "refund_ready") return "refunded" as const;
  if (["ready_to_refund", "unhold"].includes(String(refundStatus || ""))) return "refundPending" as const;
  if (isPaid(status)) return "paid" as const;
  if (authorized || status === "wait_capture") return "authorized" as const;
  if (["failed", "kaspi_not_found"].includes(status)) return "failedPayment" as const;
  if (status === "canceled") return "canceledPayment" as const;
  return "unpaid" as const;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { lang, t } = useLang();
  const c = copy[lang];
  const [order, setOrder] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"cancel" | "return" | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState(false);

  const submitRequest = async () => {
    if (!confirmKind || requestBusy) return;
    setRequestBusy(true);
    setRequestError(false);
    try {
      const response = await fetch(`/api/customer/orders/${encodeURIComponent(params.id)}/request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: confirmKind }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.request) throw new Error("request_unavailable");
      setOrder((current) => current && confirmKind ? {
        ...current,
        actions: { canCancel: false, canReturn: false },
        requests: { cancel: current.requests?.cancel || null, return: current.requests?.return || null, [confirmKind]: result.request },
      } : current);
      setConfirmKind(null);
    } catch { setRequestError(true); }
    finally { setRequestBusy(false); }
  };

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    let lastLoadedAt = 0;
    const load = () => {
      lastLoadedAt = Date.now();
      controller?.abort();
      controller = new AbortController();
      fetch(`/api/customer/orders/${encodeURIComponent(params.id)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("order_unavailable")))
        .then((data) => {
          if (!alive) return;
          setOrder(data?.order || null);
          setFailed(!data?.order);
        })
        .catch((error) => {
          if (!alive || (error instanceof Error && error.name === "AbortError")) return;
          setFailed(true);
        })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const refreshVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastLoadedAt >= 30_000) load(); };
    const timer = window.setInterval(refreshVisible, 45_000);
    window.addEventListener("focus", refreshVisible);
    return () => { alive = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
  }, [params.id]);

  if (loading) return <div className="rounded-2xl border border-slate-100 p-8 text-slate-500">{c.loading}</div>;
  if (failed || !order) return (
    <div className="rounded-2xl border border-slate-100 p-8 text-center">
      <CircleAlert className="mx-auto h-10 w-10 text-rose-500" />
      <p className="mt-3 font-semibold text-slate-900">{c.missing}</p>
      <Link href="/account/orders" className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">{c.back}</Link>
    </div>
  );

  const paid = isPaid(order.payment.status || order.paymentStatus);
  const providerPaymentState = paymentTone(order.payment.status || order.paymentStatus, order.payment.authorized, order.payment.refundStatus);
  const paymentState = providerPaymentState === "refunded" || providerPaymentState === "refundPending"
    ? providerPaymentState
    : paid ? "paid" : providerPaymentState;
  const paymentLabel = order.payment.method === "cash" && paymentState === "unpaid" ? c.payAtPickup : c[paymentState];
  const paymentProblem = paymentState === "failedPayment" || paymentState === "canceledPayment";
  const chargedMismatch = paid && order.payment.chargedTotal != null
    && Math.abs(order.payment.chargedTotal - order.total) >= 1;
  const claimFailed = deliveryFailed(order.delivery.status || order.deliveryStatus);
  return (
    <div className="space-y-5">
      <Link href="/account/orders" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-700"><ArrowLeft className="h-4 w-4" />{c.back}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold text-slate-900">{c.title}</h1><p className="mt-1 break-all text-sm text-slate-500">{order.sourceSystem === "daribar" && order.providerOrderId ? order.providerOrderId : order.id} · {order.date}</p></div>
        <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", orderStatusMeta[order.status].className)}>{t(`st.${order.status}`)}</span>
      </div>

      {order.sourceSystem === "daribar" && !order.providerOrderAvailable && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{c.unavailable}</div>}
      {claimFailed && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{c.deliveryAttention}</div>}
      {chargedMismatch && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{c.chargedMismatch} {c.charged}: {tenge(order.payment.chargedTotal!)}.</div>}

      <section className="rounded-2xl border border-slate-100 bg-white p-5" aria-label={c.status}>
        <h2 className="font-semibold text-slate-900">{c.status}</h2>
        <p className="mt-1 text-sm text-slate-500">{t(`st.${order.status}`)}{order.deliveryStatus ? ` · ${order.deliveryStatus.replaceAll("_", " ")}` : ""}</p>
        {order.statusUpdatedAt && Number.isFinite(Date.parse(order.statusUpdatedAt)) && <p className="mt-1 text-xs text-slate-400">{{ ru: "Обновлено", kz: "Жаңартылды", en: "Updated" }[lang]}: {new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang === "kz" ? "kk-KZ" : "ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(order.statusUpdatedAt))}</p>}
        {order.status !== "cancelled" && order.status !== "action_required" && (
          <ol className="mt-5 grid grid-cols-4 gap-1" aria-label={c.status}>
            {([c.received, c.assembled, c.onWay, c.finished] as const).map((label, index) => {
              const step = order.status === "delivered" ? 3 : Math.min(2, Math.max(0, order.progressStep || 0));
              const done = index <= step;
              return <li key={label} className="min-w-0 text-center"><span className={cn("mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold", done ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>{done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span><span className={cn("mt-2 block text-xs", done ? "font-semibold text-brand-700" : "text-slate-500")}>{label}</span></li>;
            })}
          </ol>
        )}
      </section>

      {(order.actions?.canCancel || order.actions?.canReturn || order.requests?.cancel || order.requests?.return) && (
        <section className="rounded-2xl border border-slate-100 bg-white p-5">
          <h2 className="font-semibold text-slate-900">{c.serviceTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{c.serviceHint}</p>
          {order.requests?.cancel && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.pendingCancel}</p>}
          {order.requests?.return && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{c.pendingReturn}</p>}
          {!confirmKind && <div className="mt-4 flex flex-wrap gap-2">
            {order.actions?.canCancel && <button type="button" onClick={() => setConfirmKind("cancel")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50"><XCircle className="h-4 w-4" />{c.cancel}</button>}
            {order.actions?.canReturn && <button type="button" onClick={() => setConfirmKind("return")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw className="h-4 w-4" />{c.return}</button>}
          </div>}
          {confirmKind && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-950">{confirmKind === "cancel" ? c.cancelConfirm : c.returnConfirm}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={requestBusy} onClick={() => void submitRequest()} className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{requestBusy ? c.loading : c.send}</button><button type="button" disabled={requestBusy} onClick={() => setConfirmKind(null)} className="min-h-10 rounded-lg px-4 text-sm font-semibold text-slate-600">{c.dismiss}</button></div></div>}
          {requestError && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{c.requestFailed}</p>}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-100 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard className="h-5 w-5 text-brand-600" />{c.payment}</h2>
          <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">{order.payment.method === "cash" ? c.cash : c.card}</span><span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", paid ? "text-brand-700" : paymentProblem ? "text-rose-700" : "text-amber-700")}>{paid && <CheckCircle2 className="h-4 w-4" />}{paymentLabel}</span></div>
        </section>
        <section className="rounded-2xl border border-slate-100 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Truck className="h-5 w-5 text-brand-600" />{c.delivery}</h2>
          <p className="mt-4 text-sm font-medium text-slate-800">{order.deliveryMethod === "pickup" ? c.pickup : c.courier}</p>
          {order.delivery.address && <p className="mt-2 flex gap-2 text-sm text-slate-500"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{order.delivery.address}</p>}
          {order.delivery.trackingUrl && <a href={order.delivery.trackingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:underline">{c.tracking}</a>}
        </section>
      </div>

      {(order.pharmacy.address || order.pickupCode) && <section className="rounded-2xl border border-slate-100 p-5"><h2 className="font-semibold text-slate-900">{c.pharmacy}</h2>{order.pharmacy.address && <p className="mt-3 text-sm font-medium text-slate-800">{order.pharmacy.address}</p>}{order.pickupCode && <p className="mt-3 text-sm text-slate-600">{c.code}: <strong className="text-slate-900">{order.pickupCode}</strong></p>}</section>}

      <section className="rounded-2xl border border-slate-100 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Package className="h-5 w-5 text-brand-600" />{c.goods}</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {order.items.map((item, index) => <div key={`${item.productId}-${index}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">{item.image ? <Image src={item.image} alt="" width={56} height={56} className="h-14 w-14 rounded-lg object-contain" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-50"><Package className="h-5 w-5 text-slate-300" /></span>}<div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.quantity} × {tenge(item.unitPrice)}</p></div><span className="font-semibold text-slate-900">{tenge(item.total)}</span></div>)}
        </div>
        <div className="mt-5 flex justify-between border-t border-slate-100 pt-4"><span className="text-slate-500">{t("sum.total")}</span><strong className="font-display text-xl text-slate-900">{tenge(order.total)}</strong></div>
      </section>
    </div>
  );
}
