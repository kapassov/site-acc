"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Heart, ShoppingBag } from "lucide-react";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/cn";
import { tenge, discountPercent } from "@/lib/format";
import { ProductArt } from "@/components/ui/ProductArt";
import { Stars } from "@/components/ui/Stars";
import { useCart } from "@/lib/cart/CartContext";
import { useFavorites } from "@/lib/favorites/FavoritesContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { usePrice } from "@/lib/price/usePrice";
import { staticPagesCopy } from "@/lib/i18n/static-pages";
import { useCity } from "@/lib/location/CityContext";

/** Универсальная аптечная карточка: товар, наличие, цена и действие видны сразу. */
export function ProductCard({ product, boxed = false }: { product: Product; boxed?: boolean }) {
  const { add, items } = useCart();
  const { has, toggle } = useFavorites();
  const { lang, t } = useLang();
  const { city, ready: cityReady, needsSelection } = useCity();
  const copy = staticPagesCopy[lang];
  const fav = has(product.id);
  const cardRef = useRef<HTMLElement>(null);
  const stockRequest = useRef<AbortController | null>(null);
  const [priceInView, setPriceInView] = useState(!product.priceTBD);
  const [checkingStock, setCheckingStock] = useState(false);
  const [stockError, setStockError] = useState<"city" | "unavailable" | "failed" | null>(null);
  const stockCopy = {
    ru: { checking: "Проверяем наличие…", pending: "Проверим перед добавлением", city: "Сначала выберите город", unavailable: "Нет в наличии в вашем городе", failed: "Не удалось проверить остаток. Повторите" },
    kz: { checking: "Қалдық тексерілуде…", pending: "Қоспас бұрын тексереміз", city: "Алдымен қаланы таңдаңыз", unavailable: "Қалаңызда жоқ", failed: "Қалдықты тексеру мүмкін болмады. Қайталаңыз" },
    en: { checking: "Checking stock…", pending: "Checked before adding", city: "Choose a city first", unavailable: "Unavailable in your city", failed: "Could not check stock. Try again" },
  }[lang];
  const sale = discountPercent(product.price, product.oldPrice);
  const href = "/product/" + product.slug;
  const cartQty = items.find((item) => item.product.id === product.id)?.qty ?? 0;
  const showBrand = Boolean(product.brand) && !["-", "—", ""].includes(product.brand.trim());
  const confirmedOut = product.source === "medusa" && product.stockStale === false && !product.inStock;
  const historicalPrice = product.source === "medusa" && product.stockStale === true && !product.priceTBD && product.price > 0;
  const priceDate = product.stockSourceDate?.split("-").reverse().join(".");

  useEffect(() => {
    return () => stockRequest.current?.abort();
  }, [city, product.id]);

  // Реальная цена «от X ₸» по аптекам (calculated_price пуст) — лениво, как в приложении.
  useEffect(() => {
    if (!product.priceTBD) return;
    const node = cardRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setPriceInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setPriceInView(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [product.id, product.priceTBD]);

  const lazyMin = usePrice(product.id, Boolean(product.priceTBD && priceInView && !confirmedOut));
  const buyPrice: number | null = product.priceTBD ? (typeof lazyMin === "number" ? lazyMin : null) : product.price;
  const available = !confirmedOut && (product.priceTBD ? typeof lazyMin === "number" : product.inStock);
  // Catalogue stock is only a display hint. Daribar items get an exact live
  // city/SKU check on click, then the full basket is rechecked at checkout.
  const canAddToCart = Boolean(product.variantId && buyPrice && !confirmedOut);

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (buyPrice == null || checkingStock) return;
    if (product.source === "daribar") {
      if (!cityReady || needsSelection || !city.trim()) { setStockError("city"); return; }
      setCheckingStock(true);
      setStockError(null);
      const controller = new AbortController();
      stockRequest.current = controller;
      try {
        const response = await fetch(`/api/availability/${encodeURIComponent(product.id)}?city=${encodeURIComponent(city)}`,
          { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
        if (!response.ok) throw new Error("stock_check_failed");
        const payload = await response.json() as { pharmacies?: Array<{ quantity?: number; price?: number }> };
        if (controller.signal.aborted) return;
        const offers = Array.isArray(payload.pharmacies) ? payload.pharmacies : [];
        const priced = offers.filter((offer) => Number.isSafeInteger(offer.quantity) && Number(offer.quantity) >= 1
          && typeof offer.price === "number" && Number.isFinite(offer.price) && offer.price > 0);
        if (!priced.length) { setStockError("unavailable"); return; }
        const livePrice = Math.min(...priced.map((offer) => offer.price!));
        add({ ...product, price: livePrice, priceTBD: false });
      } catch {
        if (!controller.signal.aborted) setStockError("failed");
      } finally {
        if (stockRequest.current === controller) stockRequest.current = null;
        setCheckingStock(false);
      }
      return;
    }
    add(product.priceTBD ? { ...product, price: buyPrice, priceTBD: false } : product);
  };

  return (
    <article
      ref={cardRef}
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-slate-200/80 bg-white p-2 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card sm:rounded-2xl sm:p-3",
        boxed && "shadow-sm",
      )}
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-50/80 sm:rounded-xl">
        <Link href={href} className="absolute inset-0" aria-label={product.name}>
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image} alt={product.name} width={600} height={600} loading="lazy" decoding="async" className="h-full w-full object-contain p-3 transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.03] sm:p-4" />
          ) : (
            <ProductArt art={product.art} className="h-full w-full transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.03]" />
          )}
        </Link>

        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {sale != null && <span className="rounded-md bg-accent-500 px-1.5 py-1 text-[10px] font-bold leading-none text-white">−{sale}%</span>}
          {product.badges.includes("new") && <span className="rounded-md bg-slate-900 px-1.5 py-1 text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-white">{t("badge.new")}</span>}
          {product.badges.includes("hit") && <span className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-slate-800">{t("badge.hit")}</span>}
          {product.badges.includes("rx") && <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-amber-700">{t("badge.rx")}</span>}
        </div>

        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(product.id); }}
          aria-label={fav ? copy["product.removeFavorite"] : copy["product.addFavorite"]}
          aria-pressed={fav}
          className="absolute right-1 top-1 z-10 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900 sm:right-2 sm:top-2"
        >
          <Heart className={cn("h-[18px] w-[18px] transition", fav && "fill-slate-900 text-slate-900")} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-1 flex-col px-0.5 sm:mt-3">
        {showBrand && <p className="line-clamp-1 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-700">{product.brand}</p>}

        <h3 className={cn("min-h-9 line-clamp-2 text-[13px] font-medium leading-snug sm:min-h-10 sm:text-sm text-slate-900", showBrand && "mt-1")}>
          <Link href={href} className="transition-colors hover:text-brand-700">{product.name}</Link>
        </h3>
        {product.volume && <p className="mt-0.5 text-xs text-slate-400">{product.volume}</p>}

        {product.reviews > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Stars value={product.rating} />
            <span className="text-xs text-slate-400">({product.reviews})</span>
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium sm:mt-2.5 sm:text-xs">
          {product.prescription ? (
            <span className="text-amber-700">{t("card.rxOnly")}</span>
          ) : product.source === "daribar" ? (
            <span className="text-slate-500">{stockCopy.pending}</span>
          ) : available ? (
            <><span className="h-1.5 w-1.5 rounded-full bg-brand-600" /><span className="text-brand-700">{t("card.inStock")}</span></>
          ) : confirmedOut || lazyMin !== undefined ? (
            <><span className="h-1.5 w-1.5 rounded-full bg-slate-300" /><span className="text-slate-500">{t("card.out")}</span></>
          ) : null}
        </div>

        <div className="mt-auto flex min-h-9 items-end gap-2 pt-3">
          {product.priceTBD ? (
            typeof lazyMin === "number" ? (
              <span className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">{t("card.from")} {tenge(lazyMin)}</span>
            ) : (
              <span className="text-sm font-semibold text-slate-500">{confirmedOut ? t("card.out") : t("card.priceTBD")}</span>
            )
          ) : (
            <>
              <span className={cn("text-base font-bold tracking-tight sm:text-lg", sale != null ? "text-accent-600" : "text-slate-900")}>{tenge(product.price)}</span>
              {product.oldPrice && <span className="text-xs text-slate-400 line-through">{tenge(product.oldPrice)}</span>}
            </>
          )}
        </div>
        {historicalPrice && priceDate && <p className="mt-0.5 text-[10px] font-medium text-slate-400">{t("card.priceAsOf", { date: priceDate })}</p>}

        {canAddToCart ? (
          <button
            type="button"
            onClick={handleAdd}
            disabled={cartQty > 0 || checkingStock}
            aria-label={cartQty > 0 ? t("card.added") : t("pdp.addToCart")}
            className={cn(
              "mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold transition sm:mt-3 sm:rounded-xl sm:text-sm",
              cartQty > 0
                ? "cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "bg-brand-700 text-white hover:bg-brand-800",
            )}
          >
            {cartQty > 0 ? <><Check className="h-4 w-4" />{t("card.added")}</> : checkingStock ? stockCopy.checking : <><ShoppingBag className="h-4 w-4" />{t("pdp.addToCart")}</>}
          </button>
        ) : available ? (
          <Link href={href} className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 text-[13px] font-semibold sm:mt-3 sm:rounded-xl sm:text-sm text-brand-800 transition hover:bg-brand-100">
            {t("card.details")} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className={cn(
            "mt-2.5 flex h-11 w-full items-center justify-center rounded-lg text-[13px] font-semibold sm:mt-3 sm:rounded-xl sm:text-sm",
            "bg-slate-100 text-slate-500",
          )}>
            {confirmedOut || lazyMin !== undefined ? t("card.out") : t("card.priceTBD")}
          </div>
        )}
        {stockError && <p role="status" className="mt-1.5 text-xs text-amber-700">{stockCopy[stockError]}</p>}
      </div>
    </article>
  );
}
