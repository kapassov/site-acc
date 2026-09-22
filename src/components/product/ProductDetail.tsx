"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Heart, ShoppingCart, Truck, Store, Check, ChevronDown, ClipboardList, MapPin } from "lucide-react";
import type { Product } from "@/lib/types";
import type { PriceInfo } from "@/lib/price-info";
import { ProductImage } from "@/components/ui/ProductImage";
import { Stars } from "@/components/ui/Stars";
import { ProductBadgeChip } from "@/components/ui/Badge";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { useCart } from "@/lib/cart/CartContext";
import { useFavorites } from "@/lib/favorites/FavoritesContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { tenge, discountPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics/client";
import { PharmacyAvailability } from "./PharmacyAvailability";

export function ProductDetail({
  product: initialProduct,
  related,
  variants,
  categoryName,
  categorySlug,
  prices: initialPrices,
}: {
  product: Product;
  related: Product[];
  variants?: Product[];
  categoryName?: string;
  categorySlug?: string;
  prices?: PriceInfo | null;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [prices, setPrices] = useState<PriceInfo | null | undefined>(initialPrices);
  const { add, items } = useCart();
  const { has, toggle } = useFavorites();
  const { t, plural } = useLang();
  const fav = has(product.id);
  const [qty, setQty] = useState(1);
  const [openFaq, setOpenFaq] = useState(-1);
  const [selImg, setSelImg] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [showStickyPurchase, setShowStickyPurchase] = useState(false);
  const [liveAvailability, setLiveAvailability] = useState<boolean | null>(null);
  const purchaseActionsRef = useRef<HTMLDivElement>(null);
  const hasRichInitial = Boolean(
    initialProduct.description
    || initialProduct.faq?.length
    || initialProduct.keyFacts?.length
    || (initialProduct.images?.length ?? 0) > 1,
  );

  useEffect(() => {
    trackEvent("product_viewed", {
      productId: initialProduct.id,
      category: initialProduct.categorySlug,
      brand: initialProduct.brand,
      price: initialProduct.priceTBD ? null : initialProduct.price,
    });
  }, [initialProduct.brand, initialProduct.categorySlug, initialProduct.id, initialProduct.price, initialProduct.priceTBD]);

  useEffect(() => {
    if (hasRichInitial) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/product/${encodeURIComponent(initialProduct.slug)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("product_detail_failed"))))
        .then((payload) => {
          if (payload?.product?.id === initialProduct.id) setProduct(payload.product as Product);
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [hasRichInitial, initialProduct.id, initialProduct.slug]);

  useEffect(() => {
    // The Postgres catalogue can already provide a cached minimum price while
    // the per-pharmacy list is still loaded separately. Always hydrate that
    // list when SSR did not provide it, otherwise a priced product silently
    // loses the "Prices in pharmacies" section.
    if (initialPrices) return;
    const controller = new AbortController();
    fetch(`/api/price/${encodeURIComponent(initialProduct.id)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("product_price_failed"))))
      .then((payload) => setPrices({
        min: typeof payload?.min === "number" ? payload.min : null,
        max: typeof payload?.max === "number" ? payload.max : null,
        count: Number(payload?.count || 0),
        pharmacies: Array.isArray(payload?.pharmacies) ? payload.pharmacies : [],
      }))
      .catch(() => setPrices(null));
    return () => controller.abort();
  }, [initialPrices, initialProduct.id]);

  const sale = discountPercent(product.price, product.oldPrice);
  // Эффективная цена за единицу: реальная (calculated) или минимальная по аптекам.
  const unitPrice: number | null = product.priceTBD ? prices?.min ?? null : product.price;
  // A dated catalogue price is still useful while the live Daribar request is
  // in flight.  Treating the initial `null` as `false` made the product page
  // flash "Out of stock" for 10-20 seconds even though checkout could confirm
  // stock moments later.  A definitive live `false` still wins; until then we
  // retain the catalogue availability and checkout remains the final gate.
  const available = product.stockStale === true
    ? liveAvailability ?? (product.priceTBD ? (prices?.count ?? 0) > 0 : product.inStock)
    : product.priceTBD ? (prices?.count ?? 0) > 0 : product.inStock;
  const canBuy = available && Boolean(product.variantId) && unitPrice != null && unitPrice > 0;
  const cartQty = items.find((item) => item.product.id === product.id)?.qty ?? 0;
  const storefrontCategory = categorySlug && !["site", "root", "website"].includes(categorySlug.toLowerCase());
  const addItem = () => { if (canBuy) add({ ...product, price: unitPrice!, priceTBD: false }, qty); };

  useEffect(() => {
    const node = purchaseActionsRef.current;
    if (!node || !canBuy || product.prescription || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickyPurchase(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    }, { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canBuy, product.prescription]);

  const gallerySource = product.images && product.images.length > 0 ? product.images : product.image ? [product.image] : [];
  const gallery = gallerySource.filter((url) => !failedImages.includes(url));
  const mainImg = gallery[selImg] ?? product.image;
  const usableMainImg = mainImg && !failedImages.includes(mainImg) ? mainImg : undefined;
  // короткая метка фасовки (дозировка + кол-во) для селектора вариантов
  const variantLabel = (name: string): string => {
    const dose = name.match(/\d+[.,]?\d*\s*(мкг|мг|мл|г|л)(?![а-яёa-z])/i)?.[0];
    const qty = name.match(/№\s?\d+/i)?.[0];
    const label = [dose, qty].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return label || name;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6 sm:py-6">
      <div className="hidden sm:block">
        <Breadcrumbs
        items={[
          { label: t("common.home"), href: "/" },
          { label: t("common.catalog"), href: "/catalog" },
          ...(storefrontCategory ? [{ label: categoryName ?? categorySlug, href: `/catalog/${categorySlug}` }] : []),
          { label: product.name },
        ]}
      />
      </div>

      <div className="grid min-w-0 gap-x-8 gap-y-4 sm:mt-6 sm:gap-y-10 lg:grid-cols-2 lg:items-start">
        {/* ── галерея (слева, верх) ── */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="relative">
            {usableMainImg ? (
              <div className="relative h-[clamp(200px,56vw,230px)] w-full overflow-hidden rounded-2xl bg-slate-50 sm:h-auto sm:rounded-3xl">
                <span aria-hidden="true" className="hidden w-full pt-[100%] sm:block" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={usableMainImg}
                  alt={product.name}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  onError={() => {
                    setFailedImages((current) => current.includes(usableMainImg) ? current : [...current, usableMainImg]);
                    setSelImg(0);
                  }}
                  className="absolute inset-0 h-full w-full object-contain p-3 sm:p-6"
                />
              </div>
            ) : (
              <ProductImage product={{ ...product, image: undefined }} className="h-[clamp(200px,56vw,230px)] w-full overflow-hidden rounded-2xl sm:h-auto sm:aspect-square sm:rounded-3xl" />
            )}
            <div className="absolute left-4 top-4 flex flex-col gap-1.5">
              {sale != null && <ProductBadgeChip badge="sale" sale={sale} />}
              {product.badges.filter((b) => b !== "sale").map((b) => <ProductBadgeChip key={b} badge={b} />)}
            </div>
          </div>
          {gallery.length > 1 && (
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:mt-3 sm:gap-2 sm:pb-1">
              {gallery.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setSelImg(i)}
                  aria-label={t("a11y.productPhoto", { number: i + 1 })}
                  className={cn(
                    "h-11 w-11 shrink-0 overflow-hidden rounded-lg border-2 bg-slate-50 transition sm:h-16 sm:w-16 sm:rounded-xl",
                    i === selImg ? "border-brand-500" : "border-slate-100 hover:border-slate-300",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain p-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── информация + характеристики + похожие (справа, на всю высоту) ── */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:text-sm">{product.brand}</p>
          <h1 className="mt-0.5 font-display text-[19px] font-extrabold leading-[1.15] tracking-tight text-slate-900 sm:mt-1 sm:text-3xl">{product.name}</h1>

          {(product.reviews > 0 || product.volume) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-3">
              {product.reviews > 0 && (
                <>
                  <span className="flex items-center gap-1.5"><Stars value={product.rating} /><span className="text-sm font-medium text-slate-700">{product.rating.toFixed(1)}</span></span>
                  <span className="text-sm text-slate-400">{product.reviews} {plural(product.reviews, "reviews")}</span>
                </>
              )}
              {product.volume && <span className="text-sm text-slate-500">{product.volume}</span>}
            </div>
          )}

          {/* Селектор фасовки — тот же товар в разных объёмах/граммовках */}
          {variants && variants.length > 1 && (
            <div className="mt-3 sm:mt-4">
              <p className="text-xs font-medium text-slate-500 sm:text-sm">{t("pdp.variant")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 sm:mt-2 sm:gap-2">
                {variants.map((v) => {
                  const active = v.id === product.id;
                  const label = variantLabel(v.name);
                  return active ? (
                    <span key={v.id} className="inline-flex items-center rounded-lg border-2 border-brand-500 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 sm:rounded-xl sm:px-3.5 sm:py-2 sm:text-sm">{label}</span>
                  ) : (
                    <Link key={v.id} href={`/product/${v.slug}`} className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700 sm:rounded-xl sm:px-3.5 sm:py-2 sm:text-sm">{label}</Link>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2 sm:mt-5 sm:gap-3">
            {product.priceTBD ? (
              canBuy ? (
                <span className="font-display text-2xl font-extrabold text-slate-900 sm:text-3xl">{t("card.from")} {tenge(unitPrice!)}</span>
              ) : (
                <span className="font-display text-2xl font-extrabold text-slate-500">{t("card.priceTBD")}</span>
              )
            ) : (
              <>
                <span className="font-display text-2xl font-extrabold text-slate-900 sm:text-3xl">{tenge(product.price)}</span>
                {product.oldPrice && <span className="pb-1 text-lg text-slate-400 line-through">{tenge(product.oldPrice)}</span>}
                {sale != null && <span className="mb-1 rounded-full bg-accent-50 px-2.5 py-1 text-sm font-semibold text-accent-600">−{sale}%</span>}
              </>
            )}
          </div>
          {canBuy && <p className="mt-0.5 text-xs font-medium text-brand-700 sm:mt-1.5 sm:text-sm">{t("pdp.cashback")}: +{tenge(Math.round(unitPrice! * 0.05))}</p>}

          {product.prescription ? (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <ClipboardList className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="font-semibold text-amber-900">{t("pdp.rxOnly")}</p>
                <p className="mt-1 text-sm leading-relaxed text-amber-800">{t("pdp.rxOnlySub")}</p>
                <Link href="/pharmacies" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white transition hover:bg-amber-700">
                  <MapPin className="h-4 w-4" /> {t("pdp.rxFind")}
                </Link>
              </div>
              <button onClick={() => toggle(product.id)} aria-label={fav ? t("a11y.removeFavorite") : t("a11y.addFavorite")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-200 bg-white text-slate-500 transition hover:text-accent-500">
                <Heart className={cn("h-5 w-5", fav && "fill-accent-500 text-accent-500")} />
              </button>
            </div>
          ) : (
            <>
              {product.priceTBD && prices == null ? (
                <div className="mt-4 text-sm font-medium text-slate-500">{t("card.priceTBD")}</div>
              ) : available ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-700 sm:mt-4 sm:gap-2 sm:text-sm">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-100"><Check className="h-3.5 w-3.5" /></span>
                  {t("card.inStock")}
                </div>
              ) : (
                <div className="mt-2 text-xs font-medium text-slate-400 sm:mt-4 sm:text-sm">{t("card.out")}</div>
              )}

              <div ref={purchaseActionsRef} className="mt-3 flex min-w-0 items-center gap-2 sm:mt-6 sm:gap-3">
                <span className="shrink-0 sm:hidden">
                  <QuantityStepper qty={qty} onChange={(n) => setQty(Math.max(1, n))} size="sm" />
                </span>
                <span className="hidden shrink-0 sm:inline-flex">
                  <QuantityStepper qty={qty} onChange={(n) => setQty(Math.max(1, n))} />
                </span>
                <button
                  onClick={addItem}
                  disabled={!canBuy || cartQty > 0}
                  className={cn(
                    "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition sm:h-12 sm:gap-2 sm:rounded-xl sm:px-4 sm:text-base",
                    cartQty > 0 ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-brand-600 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300",
                  )}
                >
                  {cartQty > 0 ? <Check className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" /> : <ShoppingCart className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />}
                  <span className="min-w-0 truncate sm:hidden">{cartQty > 0 ? t("card.added") : canBuy ? t("pdp.addToCart") : t("card.priceTBD")}</span>
                  <span className="hidden min-w-0 truncate sm:inline">{cartQty > 0 ? t("card.added") : canBuy ? `${t("pdp.addToCart")} · ${tenge(unitPrice! * qty)}` : t("card.priceTBD")}</span>
                </button>
                <button onClick={() => toggle(product.id)} aria-label={fav ? t("a11y.removeFavorite") : t("a11y.addFavorite")} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-accent-200 hover:text-accent-500 sm:h-12 sm:w-12 sm:rounded-xl">
                  <Heart className={cn("h-4 w-4 sm:h-5 sm:w-5", fav && "fill-accent-500 text-accent-500")} />
                </button>
              </div>
            </>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Truck className="h-5 w-5" />} title={t("pdp.info.delivery.t")} text={t("pdp.info.delivery.s")} />
            <InfoCard icon={<Store className="h-5 w-5" />} title={t("pdp.info.pickup.t")} text={t("pdp.info.pickup.s")} />
          </div>
          {product.stockStale === true && !product.priceTBD && product.stockSourceDate && (
            <p className="mt-1 text-xs font-medium text-slate-400">{t("card.priceAsOf", { date: product.stockSourceDate.split("-").reverse().join(".") })}</p>
          )}

          {product.source === "medusa" && <PharmacyAvailability productId={product.id} onAvailabilityChange={setLiveAvailability} />}

          {/* Цены в аптеках — реальные розничные цены сети per-аптека (calculated_price пуст) */}
          {prices && prices.pharmacies.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-soft sm:p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-slate-900">{t("pdp.pharmaPrices")}</h2>
                {prices.min != null && (
                  <span className="text-sm font-bold text-brand-700">
                    {prices.max != null && prices.max !== prices.min ? `${tenge(prices.min)}–${tenge(prices.max)}` : tenge(prices.min)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("pdp.pharmaSub")}</p>
              <ul className="mt-3 divide-y divide-slate-100">
                {prices.pharmacies.slice(0, 6).map((ph) => (
                  <li key={ph.id} className="flex items-center gap-3 py-2.5">
                    <Store className="h-4 w-4 shrink-0 text-brand-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{ph.name}</p>
                      {ph.city && <p className="text-xs text-slate-400">{ph.city}</p>}
                    </div>
                    <span className="font-display text-sm font-bold text-slate-900">{tenge(ph.price)}</span>
                  </li>
                ))}
              </ul>
              {prices.count > 6 && prices.min != null && (
                <p className="mt-2 text-xs text-slate-500">{t("card.from")} {tenge(prices.min)} · +{prices.count - 6} {t("pdp.morePharma")}</p>
              )}
            </div>
          )}

          {/* Краткие характеристики из карточки товара Daribar */}
          {(product.keyFacts?.length || product.manufacturer || product.country || product.mnn || product.atc || product.prescription || product.barcode) && (
            <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-soft sm:p-5">
              <h2 className="font-display text-base font-bold text-slate-900">{t("pdp.specs.title")}</h2>
              {product.keyFacts && product.keyFacts.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {product.keyFacts.map((fact, i) => (
                    <li key={i} className="flex gap-2 text-[15px] leading-relaxed text-slate-600">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(product.mnn || product.atc || product.prescription || (!product.keyFacts?.length && (product.manufacturer || product.country || product.barcode))) && (
                <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                  {product.mnn && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.mnn")}</dt><dd className="text-right font-medium text-slate-900">{product.mnn}</dd></div>}
                  {product.atc && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.atc")}</dt><dd className="text-right font-medium text-slate-900">{product.atc}</dd></div>}
                  {product.prescription && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.rx")}</dt><dd className="text-right font-medium text-slate-900">{t("pdp.spec.rxYes")}</dd></div>}
                  {!product.keyFacts?.length && product.manufacturer && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.manufacturer")}</dt><dd className="text-right font-medium text-slate-900">{product.manufacturer}</dd></div>}
                  {!product.keyFacts?.length && product.country && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.country")}</dt><dd className="text-right font-medium text-slate-900">{product.country}</dd></div>}
                  {!product.keyFacts?.length && product.barcode && <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500">{t("pdp.spec.barcode")}</dt><dd className="text-right font-medium text-slate-900">{product.barcode}</dd></div>}
                </dl>
              )}
            </div>
          )}

          {/* Похожие товары — под краткими характеристиками */}
          {related.length > 0 && (
            <div className="mt-6">
              <h2 className="font-display text-lg font-bold text-slate-900">{t("pdp.related")}</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {related.slice(0, 6).map((r) => (
                  <Link key={r.id} href={`/product/${r.slug}`} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 transition hover:border-slate-300 hover:shadow-soft">
                    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain p-1.5" />
                      ) : (
                        <ProductImage product={r} className="h-full w-full" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.brand}</p>
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{r.name}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{r.priceTBD ? t("card.priceTBD") : tenge(r.price)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── описание + FAQ (слева, под фото — заполняют пустоту) ── */}
        {(product.description || (product.faq && product.faq.length > 0)) && (
          <div className="lg:col-start-1 lg:row-start-2">
            {product.description && (
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">{t("pdp.tab.desc")}</h2>
                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-600">{product.description}</p>
              </div>
            )}

            {product.faq && product.faq.length > 0 && (
              <div className={product.description ? "mt-10" : ""}>
                <h2 className="font-display text-xl font-bold text-slate-900">{t("pdp.faq.title")}</h2>
                <div className="mt-4 space-y-2.5">
                  {product.faq.map((item, i) => {
                    const on = i === openFaq;
                    return (
                      <div key={i} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-soft">
                        <button onClick={() => setOpenFaq(on ? -1 : i)} aria-expanded={on} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
                          <span className="font-semibold text-slate-900">{item.q}</span>
                          <ChevronDown className={cn("h-5 w-5 shrink-0 text-slate-400 transition-transform", on && "rotate-180")} />
                        </button>
                        {on && <p className="px-5 pb-5 text-[15px] leading-relaxed text-slate-600">{item.a}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {showStickyPurchase && canBuy && !product.prescription && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[55] border-t border-slate-200 bg-white/96 px-3 py-2.5 shadow-[0_-10px_30px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-500">{product.name}</p>
              <p className="font-display text-lg font-extrabold text-slate-900">{tenge(unitPrice! * qty)}</p>
            </div>
            <button
              type="button"
              onClick={addItem}
              disabled={cartQty > 0}
              className={cn(
                "inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold",
                cartQty > 0 ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-brand-600 text-white active:bg-brand-700",
              )}
            >
              {cartQty > 0 ? <><Check className="h-4 w-4" />{t("card.added")}</> : <><ShoppingCart className="h-4 w-4" />{t("pdp.addToCart")}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{text}</p>
      </div>
    </div>
  );
}
