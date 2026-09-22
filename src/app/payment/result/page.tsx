"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CheckCircle2, Clock3, RotateCw, XCircle } from "lucide-react";

type PaymentResult = {
  status: string;
  state: "pending" | "paid" | "authorized" | "failed" | "refunded";
  final: boolean;
};

function ResultContent() {
  const params = useSearchParams();
  const order = params.get("order") || "";
  const token = params.get("token") || "";
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!order || !token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/kassa/status?order=${encodeURIComponent(order)}&token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(data.error || "payment_status_failed"));
        if (stopped) return;
        setResult(data as PaymentResult);
        setError("");
        if (!data.final) timer = setTimeout(poll, 2500);
      } catch {
        if (stopped) return;
        setError("Не удалось проверить оплату. Попробуйте обновить статус.");
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [order, token]);

  const paid = result?.state === "paid";
  const failed = result?.state === "failed";
  const refunded = result?.state === "refunded";
  const Icon = paid ? CheckCircle2 : failed || refunded ? XCircle : Clock3;
  const title = paid ? "Оплата прошла" : failed ? "Оплата не прошла" : refunded ? "Платёж возвращён" : "Проверяем оплату";
  const text = paid
    ? "Заказ оплачен. Статус сохранён и передан в обработку."
    : failed
      ? "Деньги не списаны. Вернитесь в корзину и попробуйте ещё раз."
      : refunded
        ? "Возврат зарегистрирован платёжной системой."
        : "Ожидаем подтверждение от Kassa.com. Обычно это занимает несколько секунд.";

  if (!order || !token) {
    return <ResultCard icon={XCircle} title="Некорректная ссылка" text="Откройте оплату заново из корзины." tone="error" />;
  }
  return (
    <ResultCard icon={Icon} title={title} text={error || text} tone={paid ? "success" : failed || refunded || error ? "error" : "pending"}>
      {!result?.final && <span className="inline-flex items-center gap-2 text-xs text-slate-500"><RotateCw className="h-3.5 w-3.5 animate-spin" /> Статус обновляется автоматически</span>}
    </ResultCard>
  );
}

function ResultCard({
  icon: Icon, title, text, tone, children,
}: {
  icon: typeof CheckCircle2;
  title: string;
  text: string;
  tone: "success" | "error" | "pending";
  children?: React.ReactNode;
}) {
  const color = tone === "success" ? "text-emerald-600 bg-emerald-50" : tone === "error" ? "text-rose-600 bg-rose-50" : "text-amber-600 bg-amber-50";
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-12">
      <section className="w-full rounded-3xl border border-slate-100 bg-white p-7 text-center shadow-sm">
        <span className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl ${color}`}><Icon className="h-8 w-8" /></span>
        <h1 className="mt-5 font-display text-2xl font-bold text-slate-950">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link href="/account/orders" className="flex h-12 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Мои заказы</Link>
          <Link href="/cart" className="flex h-12 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Вернуться в корзину</Link>
        </div>
      </section>
    </main>
  );
}

export default function PaymentResultPage() {
  return <Suspense fallback={<main className="p-8 text-center text-slate-500">Проверяем оплату…</main>}><ResultContent /></Suspense>;
}
