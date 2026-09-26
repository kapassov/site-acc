"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, CreditCard, MapPin, Package, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { orderStatusMeta, type OrderStatus } from "@/lib/data/account";
import { tenge } from "@/lib/format";
import { useLang } from "@/lib/i18n/LanguageContext";

type Detail = {
  id: string; date: string; status: OrderStatus; total: number; itemsCount: number;
  paymentStatus?: string; deliveryStatus?: string; providerStatus?: string; providerAvailable: boolean;
  deliveryMethod: string; pickupCode?: string | null;
  pharmacy: { name?: string; address?: string };
  delivery: { address?: string; provider?: string; eta?: string; status?: string; trackingUrl?: string | null };
  payment: { method?: string; status?: string; providerMethod?: string | null; authorized?: boolean; paidAt?: string | null; refundAmount?: number; refundStatus?: string | null };
  items: Array<{ productId: string; title: string; quantity: number; unitPrice: number; total: number; handle?: string | null; image?: string | null }>;
};

const copy = {
  ru: { back: "Мои заказы", title: "Детали заказа", loading: "Проверяем актуальный статус…", missing: "Заказ не найден", retry: "Повторить", goods: "Товары", payment: "Оплата", paid: "Оплачено", unpaid: "Ожидает оплаты", authorized: "Деньги зарезервированы", failedPayment: "Оплата не прошла", canceledPayment: "Платёж отменён", refundPending: "Возврат обрабатывается", refunded: "Возврат выполнен", cash: "Наличными в аптеке", card: "Банковской картой", delivery: "Получение", pickup: "Самовывоз", courier: "Курьерская доставка", pharmacy: "Аптека", address: "Адрес доставки", unavailable: "Daribar временно не вернул актуальный статус. Показаны сохранённые данные заказа.", deliveryAttention: "Курьерская заявка требует подтверждения. Заказ не считается переданным курьеру.", tracking: "Отследить доставку", code: "Код получения" },
  kz: { back: "Менің тапсырыстарым", title: "Тапсырыс мәліметтері", loading: "Өзекті күй тексерілуде…", missing: "Тапсырыс табылмады", retry: "Қайталау", goods: "Тауарлар", payment: "Төлем", paid: "Төленді", unpaid: "Төлем күтілуде", authorized: "Қаражат резервтелді", failedPayment: "Төлем өтпеді", canceledPayment: "Төлем тоқтатылды", refundPending: "Қайтару өңделуде", refunded: "Қаражат қайтарылды", cash: "Дәріханада қолма-қол", card: "Банк картасымен", delivery: "Алу тәсілі", pickup: "Өзі алып кету", courier: "Курьерлік жеткізу", pharmacy: "Дәріхана", address: "Жеткізу мекенжайы", unavailable: "Daribar өзекті күйді уақытша қайтармады. Сақталған деректер көрсетілді.", deliveryAttention: "Курьерлік өтінім растауды қажет етеді. Тапсырыс курьерге берілді деп саналмайды.", tracking: "Жеткізуді қадағалау", code: "Алу коды" },
  en: { back: "My orders", title: "Order details", loading: "Checking the latest status…", missing: "Order not found", retry: "Retry", goods: "Items", payment: "Payment", paid: "Paid", unpaid: "Awaiting payment", authorized: "Funds authorized", failedPayment: "Payment failed", canceledPayment: "Payment canceled", refundPending: "Refund processing", refunded: "Refund completed", cash: "Cash at pharmacy", card: "Bank card", delivery: "Fulfilment", pickup: "Pickup", courier: "Courier delivery", pharmacy: "Pharmacy", address: "Delivery address", unavailable: "Daribar did not return a live status. Saved order details are shown.", deliveryAttention: "The courier booking needs confirmation. The order is not considered handed to a courier.", tracking: "Track delivery", code: "Pickup code" },
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

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const load = () => {
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
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 15_000);
    window.addEventListener("focus", load);
    return () => { alive = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [params.id]);

  if (loading) return <div className="rounded-2xl border border-slate-100 p-8 text-slate-500">{c.loading}</div>;
  if (failed || !order) return (
    <div className="rounded-2xl border border-slate-100 p-8 text-center">
      <CircleAlert className="mx-auto h-10 w-10 text-rose-500" />
      <p className="mt-3 font-semibold text-slate-900">{c.missing}</p>
      <Link href="/account/orders" className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">{c.back}</Link>
    </div>
  );

  const paid = isPaid(order.payment.status || order.paymentStatus) || order.payment.method === "cash";
  const providerPaymentState = paymentTone(order.payment.status || order.paymentStatus, order.payment.authorized, order.payment.refundStatus);
  const paymentState = providerPaymentState === "refunded" || providerPaymentState === "refundPending"
    ? providerPaymentState
    : paid ? "paid" : providerPaymentState;
  const paymentProblem = paymentState === "failedPayment" || paymentState === "canceledPayment";
  const claimFailed = deliveryFailed(order.delivery.status || order.deliveryStatus);
  return (
    <div className="space-y-5">
      <Link href="/account/orders" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-700"><ArrowLeft className="h-4 w-4" />{c.back}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold text-slate-900">{c.title}</h1><p className="mt-1 text-sm text-slate-500">{order.id} · {order.date}</p></div>
        <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", orderStatusMeta[order.status].className)}>{t(`st.${order.status}`)}</span>
      </div>

      {!order.providerAvailable && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{c.unavailable}</div>}
      {claimFailed && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{c.deliveryAttention}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-100 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard className="h-5 w-5 text-brand-600" />{c.payment}</h2>
          <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">{order.payment.method === "cash" ? c.cash : c.card}</span><span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", paid ? "text-brand-700" : paymentProblem ? "text-rose-700" : "text-amber-700")}>{paid && <CheckCircle2 className="h-4 w-4" />}{c[paymentState]}</span></div>
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
