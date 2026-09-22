"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, X } from "lucide-react";
import type { CartItem } from "@/lib/cart/CartContext";
import { useCart } from "@/lib/cart/CartContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/lib/ui/ToastContext";

const REMOVAL_REASONS = [
  { id: "not_needed", labelKey: "cart.removeReason.notNeeded" },
  { id: "added_by_mistake", labelKey: "cart.removeReason.addedByMistake" },
  { id: "different_pack", labelKey: "cart.removeReason.differentPack" },
  { id: "different_product", labelKey: "cart.removeReason.differentProduct" },
  { id: "price_or_delivery", labelKey: "cart.removeReason.priceOrDelivery" },
  { id: "other", labelKey: "cart.removeReason.other" },
] as const;

export function CartItemDeleteButton({
  item,
  index,
  compact = false,
}: {
  item: CartItem;
  index: number;
  compact?: boolean;
}) {
  const { remove, restore } = useCart();
  const { t } = useLang();
  const { push } = useToast();
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);

  useEffect(() => {
    if (!confirming) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirming(false);
        setSelectedReasons([]);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirming]);

  const openDialog = () => {
    setSelectedReasons([]);
    setConfirming(true);
  };

  const closeDialog = () => {
    setConfirming(false);
    setSelectedReasons([]);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const toggleReason = (reason: string) => {
    setSelectedReasons((current) => (
      current.includes(reason)
        ? current.filter((value) => value !== reason)
        : [...current, reason]
    ));
  };

  const removeWithUndo = () => {
    if (selectedReasons.length === 0) return;
    remove(item.product.id, [...selectedReasons].sort().join("|"));
    setConfirming(false);
    setSelectedReasons([]);
    push(t("cart.removed"), {
      duration: 5_000,
      action: {
        label: t("cart.undo"),
        onClick: () => restore(item, index),
      },
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-label={t("cart.removeRequest")}
        title={t("cart.removeRequest")}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        <Trash2 className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>

      {confirming && createPortal(
        <div
          className="fixed inset-0 z-[220] flex items-end justify-center sm:items-center sm:p-4"
        >
          <div
            aria-hidden="true"
            onMouseDown={closeDialog}
            className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[2px]"
          />

          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            className="relative z-10 flex max-h-[min(88dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl focus:outline-none sm:rounded-3xl"
          >
            <header className="relative border-b border-slate-100 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <button
                type="button"
                onClick={closeDialog}
                aria-label={t("cart.removeReason.close")}
                className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <X className="h-5 w-5" />
              </button>
              <h2 id={titleId} className="pr-10 font-display text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">
                {t("cart.removeReason.title")}
              </h2>
              <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-slate-500">
                {t("cart.removeReason.hint")}
              </p>
              <p className="mt-2 line-clamp-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{item.product.name}</p>
            </header>

            <fieldset className="min-h-0 overscroll-contain overflow-y-auto px-5 py-3 sm:px-6">
              <legend className="sr-only">{t("cart.removeReason.legend")}</legend>
              <div className="space-y-1.5">
                {REMOVAL_REASONS.map((reason) => {
                  const checked = selectedReasons.includes(reason.id);
                  return (
                    <label
                      key={reason.id}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-emerald-600 focus-within:ring-offset-2 ${
                        checked
                          ? "border-emerald-600 bg-emerald-50 text-slate-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReason(reason.id)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition ${
                          checked
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </span>
                      <span>{t(reason.labelKey)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <footer className="border-t border-slate-100 bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-6">
              <button
                type="button"
                onClick={removeWithUndo}
                disabled={selectedReasons.length === 0}
                className="h-12 w-full rounded-xl bg-red-600 px-4 font-bold text-white transition hover:bg-red-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                {t("cart.removeReason.confirm")}
              </button>
              <button
                type="button"
                onClick={closeDialog}
                className="mt-2 h-11 w-full rounded-xl font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {t("cart.removeReason.keep")}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
