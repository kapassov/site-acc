"use client";

import Link from "next/link";
import { X, ShoppingBag, Truck } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { ProductImage } from "@/components/ui/ProductImage";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { tenge } from "@/lib/format";
import { CartItemDeleteButton } from "@/components/cart/CartItemDeleteButton";

export function CartDrawer() {
  const { items, isOpen, close, subtotal, savings, count, setQty } = useCart();
  const { t, plural } = useLang();

  return (
    <div className={`fixed inset-0 z-[70] ${isOpen ? "" : "pointer-events-none"}`} aria-hidden={!isOpen}>
      <div onClick={close} className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`} />
      <aside className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-pop transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold text-slate-900">{t("cart.title")}</h2>
            {count > 0 && <span className="text-sm text-slate-400">{count} {plural(count)}</span>}
          </div>
          <button onClick={close} aria-label="×" className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">
            <X className="h-6 w-6" />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-slate-300"><ShoppingBag className="h-8 w-8" /></span>
            <p className="mt-4 font-semibold text-slate-800">{t("cart.empty.t")}</p>
            <Link href="/catalog" onClick={close} className="mt-5 inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700">
              {t("common.toCatalog")}
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ul className="space-y-4">
                {items.map(({ product, qty }, index) => (
                  <li key={product.id} className="flex gap-3">
                    <ProductImage product={product} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{product.brand}</p>
                          <p className="line-clamp-2 text-sm font-medium text-slate-800">{product.name}</p>
                        </div>
                        <CartItemDeleteButton compact item={{ product, qty }} index={index} />
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <QuantityStepper size="sm" qty={qty} onChange={(nv) => setQty(product.id, nv)} />
                        <span className="text-sm font-bold text-slate-900">{tenge(product.price * qty)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <footer className="border-t border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">
                <Truck className="h-4 w-4 shrink-0" /> {t("drw.benefit")}
              </div>
              {savings > 0 && (
                <div className="mt-3 flex justify-between text-sm">
                  <span className="text-slate-500">{t("drw.savings")}</span>
                  <span className="font-semibold text-accent-600">−{tenge(savings)}</span>
                </div>
              )}
              <div className="mt-2 flex items-end justify-between">
                <span className="text-slate-500">{t("drw.total")}</span>
                <span className="font-display text-2xl font-extrabold text-slate-900">{tenge(subtotal)}</span>
              </div>
              <div className="mt-4 grid gap-2">
                <Link href="/checkout" onClick={close} className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-700">
                  {t("sum.checkout")}
                </Link>
                <Link href="/cart" onClick={close} className="inline-flex h-11 items-center justify-center rounded-xl text-sm font-semibold text-brand-700 transition hover:bg-brand-50">
                  {t("drw.toCart")}
                </Link>
              </div>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
