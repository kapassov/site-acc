"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Store, Truck } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { ProductImage } from "@/components/ui/ProductImage";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { EmptyCart } from "@/components/cart/EmptyCart";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ConfirmCartDelete } from "@/components/cart/ConfirmCartDelete";
import { CartItemDeleteButton } from "@/components/cart/CartItemDeleteButton";
import { cartExtraCopy, type CartAlertKey, type CartFulfillment } from "@/lib/i18n/cart-extra";

export default function CartPage() {
  const { items, count, subtotal, savings, setQty, clear, legacyItemsRemoved, dismissLegacyNotice } = useCart();
  const { user, openLogin } = useAuth();
  const { lang, t } = useLang();
  const copy = cartExtraCopy[lang];
  const router = useRouter();
  const [selectedFulfillment, setFulfillment] = useState<CartFulfillment | null>(null);
  const hasPrescription = items.some((item) => item.product.prescription);
  const fulfillment = hasPrescription ? "pickup" : selectedFulfillment;
  const prescriptionNotice = {
    ru: "Рецептурные товары оформляются только самовывозом с оплатой наличными. При получении понадобится действующий рецепт.",
    kz: "Рецептімен берілетін тауарларды тек дәріханадан алып кетіп, қолма-қол төлеуге болады. Алғанда жарамды рецепт қажет.",
    en: "Prescription items are available only for pharmacy pickup with cash payment. Bring a valid prescription.",
  }[lang];
  const [checkoutIntent, setCheckoutIntent] = useState(false);
  const [cartAlert, setCartAlert] = useState<CartAlertKey | null>(null);
  const fulfillmentRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLElement>(null);

  const checkoutReady = count > 0 && fulfillment !== null;
  const checkoutHref = fulfillment ? `/checkout?delivery=${fulfillment}` : "/checkout";
  const checkoutLabel = fulfillment === "pickup" ? copy.actions.checkoutPickup : copy.actions.checkoutCourier;
  const mobileCta = count === 0 ? copy.actions.chooseProducts : fulfillment === null ? copy.actions.chooseFulfillment : checkoutLabel;

  useEffect(() => {
    if (user && checkoutIntent && checkoutReady) {
      router.push(checkoutHref);
    }
  }, [checkoutHref, checkoutIntent, checkoutReady, router, user]);

  const proceedToCheckout = () => {
    if (count === 0) {
      setCartAlert("items");
      itemsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!fulfillment) {
      setCartAlert("fulfillment");
      fulfillmentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!user) {
      setCheckoutIntent(true);
      setCartAlert("auth");
      openLogin();
      return;
    }
    setCartAlert(null);
    router.push(checkoutHref);
  };

  const migrationNotice = legacyItemsRemoved ? (
    <section role="status" aria-labelledby="cart-migration-title" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <h2 id="cart-migration-title" className="text-sm font-bold">{copy.migration.title}</h2>
        <p className="mt-1 text-sm leading-relaxed">{copy.migration.text}</p>
      </div>
      <button type="button" onClick={dismissLegacyNotice} className="mt-3 min-h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 sm:mt-0">
        {copy.migration.dismiss}
      </button>
    </section>
  ) : null;

  if (items.length === 0) return <EmptyCart notice={migrationNotice} />;

  return (
    <div className="relative z-0 mx-auto min-h-screen min-w-0 max-w-5xl px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-0 sm:px-6 md:pb-12 before:fixed before:inset-0 before:-z-10 before:bg-slate-50">
      <div className="-mx-3 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:-mx-6 md:mb-10 md:px-6">
        <Link href="/" aria-label={copy.back} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 active:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="font-semibold text-slate-800">{copy.back}</span>
      </div>

      <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900 md:mt-0 md:text-3xl">{t("cart.title")}</h1>

      {migrationNotice}
      {hasPrescription && <p role="note" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{prescriptionNotice}</p>}

      {cartAlert && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{copy.alerts[cartAlert]}</span>
        </div>
      )}

      <section ref={fulfillmentRef} aria-labelledby="fulfillment-title" className="mt-6 scroll-mt-24">
        <h2 id="fulfillment-title" className="font-display text-lg font-bold text-slate-900 md:text-xl">{copy.fulfillmentTitle}</h2>
        <div className="mt-3 grid gap-2">
          <FulfillmentCard
            active={fulfillment === "pickup"}
            invalid={cartAlert === "fulfillment"}
            onClick={() => { setFulfillment("pickup"); setCartAlert(null); }}
            icon={<Store className="h-5 w-5" />}
            title={copy.fulfillment.pickup.title}
            text={copy.fulfillment.pickup.description}
            price={copy.fulfillment.pickup.cardPrice}
          />
          {!hasPrescription && <FulfillmentCard
            active={fulfillment === "courier"}
            invalid={cartAlert === "fulfillment"}
            onClick={() => { setFulfillment("courier"); setCartAlert(null); }}
            icon={<Truck className="h-5 w-5" />}
            title={copy.fulfillment.courier.title}
            text={copy.fulfillment.courier.description}
            price={copy.fulfillment.courier.cardPrice}
          />}
        </div>
      </section>

      <div className="mt-7 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_350px] lg:items-start">
        <section ref={itemsRef} aria-labelledby="cart-items-title" className="min-w-0 scroll-mt-24">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="cart-items-title" className="font-display text-lg font-bold text-slate-900 md:text-xl">{t("cart.title")}</h2>
            <ConfirmCartDelete trigger="text" onConfirm={clear} label={t("cart.clear")} confirmLabel={t("cart.clearConfirm")} cancelLabel={t("cart.removeCancel")} />
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)]">
            {items.map(({ product, qty }, index) => (
              <article key={product.id} className={cn("relative grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:p-4", cartAlert === "items" && "bg-rose-50/50 ring-2 ring-inset ring-rose-200")}>
                <Link href={`/product/${product.slug}`} className="min-w-0 self-start">
                  <ProductImage product={product} className="h-[4.5rem] w-[4.5rem] overflow-hidden rounded-xl bg-slate-50 sm:h-24 sm:w-24" />
                </Link>
                <div className="min-w-0 pr-11 sm:pr-0">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">{product.brand}</p>
                  <Link href={`/product/${product.slug}`} className="mt-0.5 line-clamp-2 block min-w-0 text-sm font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere] transition hover:text-brand-700 sm:text-base">
                    {product.name}
                  </Link>
                  {product.volume && <p className="mt-1 text-xs text-slate-400">{product.volume}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 sm:hidden">
                    <span className="font-display text-base font-extrabold tabular-nums text-slate-900">{tenge(product.price * qty)}</span>
                    <QuantityStepper qty={qty} onChange={(next) => setQty(product.id, next)} size="sm" />
                  </div>
                </div>
                <div className="hidden items-center gap-3 sm:flex">
                  <div className="text-right">
                    <div className="font-display text-lg font-extrabold tabular-nums text-slate-900">{tenge(product.price * qty)}</div>
                    {product.oldPrice && <div className="text-xs text-slate-400 line-through">{tenge(product.oldPrice * qty)}</div>}
                  </div>
                  <QuantityStepper qty={qty} onChange={(next) => setQty(product.id, next)} size="sm" />
                  <CartItemDeleteButton compact item={{ product, qty }} index={index} />
                </div>
                <div className="absolute right-2 top-2 sm:right-3 sm:top-3">
                  <span className="sm:hidden"><CartItemDeleteButton compact item={{ product, qty }} index={index} /></span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <OrderSummary
            subtotal={subtotal}
            savings={savings}
            count={count}
            fulfillment={fulfillment ?? undefined}
            cta={(
              <button type="button" onClick={proceedToCheckout} className={cn("flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-xl px-3 font-semibold transition", checkoutReady ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                <span className="truncate">{checkoutReady ? checkoutLabel : mobileCta}</span><ArrowRight className="h-5 w-5 shrink-0" />
              </button>
            )}
          />

        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-slate-200 bg-white/96 px-3 pt-3 shadow-[0_-10px_30px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
        <button type="button" onClick={proceedToCheckout} className={cn("mx-auto flex min-h-13 w-full max-w-md min-w-0 items-center justify-between gap-3 rounded-xl px-4 font-semibold transition", checkoutReady ? "bg-brand-600 text-white active:bg-brand-700" : "bg-slate-200 text-slate-600 active:bg-slate-300")}>
          <span className="shrink-0 font-display text-base font-extrabold tabular-nums">{tenge(subtotal)}</span>
          <span className="min-w-0 truncate">{mobileCta}</span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

function FulfillmentCard({
  active,
  invalid,
  onClick,
  icon,
  title,
  text,
  price,
}: {
  active: boolean;
  invalid?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  text: string;
  price: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "grid min-h-[4.5rem] min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-2xl border bg-white p-3 text-left shadow-[0_12px_28px_-28px_rgba(15,23,42,0.5)] transition",
        active ? "border-brand-500 ring-1 ring-brand-500" : invalid ? "border-rose-300 ring-2 ring-rose-100" : "border-transparent hover:border-brand-300",
      )}
    >
      <span className={cn("grid h-9 w-9 place-items-center rounded-xl", active ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700")}>{active ? <Check className="h-5 w-5" /> : icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500">{text}</span>
      </span>
      <span className="shrink-0 pt-0.5 text-xs font-semibold text-slate-600">{price}</span>
    </button>
  );
}
