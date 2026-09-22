"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  ArrowRight,
  Baby,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleEllipsis,
  Cross,
  Dumbbell,
  Eye,
  HeartPulse,
  LayoutGrid,
  Pill,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import type { CatNode, Product } from "@/lib/types";
import type { CatalogFacets, PrescriptionFilter } from "@/lib/catalog-query";
import { catalogPromos, type Promo } from "@/lib/data/promos";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { tenge } from "@/lib/format";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics/client";
import { catalogPaginationItems } from "@/components/catalog/catalog-pagination";
import { useCity } from "@/lib/location/CityContext";
import { SearchFeedback } from "@/components/search/SearchFeedback";
import { readSearchFeedback, searchResultsHref, type SearchFeedbackMeta } from "@/components/search/search-feedback";
import { catalogCategoryName } from "@/lib/i18n/catalog-categories";

type Sort = "popular" | "price-asc" | "price-desc" | "rating" | "new";
const sortValues: Sort[] = ["popular", "price-asc", "price-desc"];
const CATALOG_PAGE_SIZE = 24;
const EMPTY_PHARMACY_CODES: string[] = [];
type CatalogFilterCopy = {
  price: string;
  rx: string;
  otc: string;
  brandSearch: string;
  showBrands: string;
  collapseBrands: string;
  moreBrands: string;
  noResults: string;
};

type CatalogPageResponse = {
  products?: unknown;
  count?: unknown;
  hasMore?: unknown;
  nextOffset?: unknown;
  page?: unknown;
  facets?: unknown;
  meta?: { search?: unknown };
};

type CatalogRequest = {
  q: string;
  city: string;
  exact: boolean;
  pharmacies: string[];
  category?: string;
  brands: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  sale: boolean;
  prescription: PrescriptionFilter;
  sort: Sort;
};

function serverSort(sort: Sort): string {
  if (sort === "price-asc") return "price_asc";
  if (sort === "price-desc") return "price_desc";
  return "relevance";
}

function catalogRequestParams(request: CatalogRequest, offset: number): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(CATALOG_PAGE_SIZE),
    offset: String(offset),
    prescription: request.prescription,
    sort: serverSort(request.sort),
  });
  if (request.q) params.set("q", request.q);
  params.set("city", request.city);
  if (request.exact) params.set("exact", "1");
  for (const pharmacy of request.pharmacies) params.append("pharmacy", pharmacy);
  if (request.category) params.set("category", request.category);
  for (const brand of request.brands) params.append("brand", brand);
  if (request.minPrice != null) params.set("price_min", String(request.minPrice));
  if (request.maxPrice != null) params.set("price_max", String(request.maxPrice));
  if (request.inStock) params.set("in_stock", "1");
  if (request.sale) params.set("sale", "1");
  return params;
}

function isCatalogFacets(value: unknown): value is CatalogFacets {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CatalogFacets>;
  return Array.isArray(candidate.brands)
    && Array.isArray(candidate.categories)
    && Boolean(candidate.price && typeof candidate.price === "object")
    && Boolean(candidate.availability && typeof candidate.availability === "object");
}

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Product>;
  return typeof candidate.id === "string" && typeof candidate.slug === "string" && typeof candidate.name === "string";
}

/** Путь от корня дерева до узла с данным handle (для крошек и авто-раскрытия). */
function findPath(nodes: CatNode[], handle: string): CatNode[] | null {
  for (const n of nodes) {
    if (n.handle === handle) return [n];
    const sub = findPath(n.children, handle);
    if (sub) return [n, ...sub];
  }
  return null;
}

/** Нормализованный ключ бренда: «NOW Foods»/«Now Foods» → один (регистр и пробелы). */
function brandKey(b: string): string {
  return b.trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "brand";
}

export function CatalogView({
  products,
  tree,
  activeHandle,
  totalCount,
  initialPageVerified = false,
  initialPage = 1,
  initialFacets = null,
  heading,
  crumbs,
  searchQuery = "",
  exactSearch = false,
  pharmacyCodes = EMPTY_PHARMACY_CODES,
}: {
  products: Product[];
  tree: CatNode[];
  activeHandle?: string;
  totalCount?: number;
  initialPageVerified?: boolean;
  initialPage?: number;
  initialFacets?: CatalogFacets | null;
  heading?: string;
  crumbs?: { label: string; href?: string }[];
  searchQuery?: string;
  exactSearch?: boolean;
  pharmacyCodes?: string[];
}) {
  const { t, plural, lang } = useLang();
  const { city, ready: cityReady } = useCity();
  const loadText = {
    more: t("catalog.loadMore"),
    loading: t("catalog.loadingProducts"),
    error: t("catalog.loadError"),
    retry: t("common.tryAgain"),
  };
  const filterText: CatalogFilterCopy = {
    price: t("catalog.price"),
    rx: t("catalog.rx"),
    otc: t("catalog.otc"),
    brandSearch: t("catalog.brandSearch"),
    showBrands: t("catalog.allBrands"),
    collapseBrands: t("catalog.collapse"),
    moreBrands: t("catalog.loadMore"),
    noResults: t("catalog.noResults"),
  };
  const [pageProducts, setPageProducts] = useState<Product[]>(products);
  const [knownTotalCount, setKnownTotalCount] = useState(totalCount);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(totalCount == null && products.length === 0);
  const [requestError, setRequestError] = useState<{ key: string; phase: "initial" | "more" } | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [resultRequestKey, setResultRequestKey] = useState<string | null>(null);
  const [searchMetadata, setSearchMetadata] = useState<SearchFeedbackMeta | null>(null);
  const [facets, setFacets] = useState<CatalogFacets | null>(initialFacets);
  const [fallbackCategories, setFallbackCategories] = useState<CatNode[]>([]);
  const [availableBrands, setAvailableBrands] = useState<CatalogFacets["brands"]>(initialFacets?.brands ?? []);
  const [availablePriceBounds, setAvailablePriceBounds] = useState<{ min: number; max: number } | null>(() => (
    initialFacets?.price.min != null && initialFacets.price.max != null
      ? { min: initialFacets.price.min, max: initialFacets.price.max }
      : null
  ));
  const activeRequestRef = useRef("");
  const initialRequestRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const catalogTopRef = useRef<HTMLDivElement>(null);
  const facetsRequestKeyRef = useRef("");
  const loadedProducts = pageProducts;
  // The stable presentation taxonomy is preferred; API facets remain a safe
  // fallback for search-only embeddings that do not pass the navigation tree.
  const navigationTree = tree.length > 0 ? tree : fallbackCategories;
  // Путь к активной категории + множество раскрытых узлов.
  const path = useMemo(() => (activeHandle ? findPath(navigationTree, activeHandle) : null), [navigationTree, activeHandle]);
  const activeSourceName = heading ?? path?.[path.length - 1]?.name;
  const activeName = activeHandle && activeSourceName
    ? catalogCategoryName(activeHandle, activeSourceName, lang)
    : activeSourceName;
  const openSet = useMemo(() => new Set((path ?? []).map((n) => n.handle)), [path]);
  const activeNode = path?.[path.length - 1];
  const categoryRailParent = activeNode?.children.length
    ? activeNode
    : path && path.length > 1
      ? path[path.length - 2]
      : null;
  const categoryRailItems = categoryRailParent?.children ?? navigationTree;
  const categoryRailRoot = categoryRailParent
    ? { label: catalogCategoryName(categoryRailParent.handle, categoryRailParent.name, lang), href: `/catalog/${categoryRailParent.handle}`, active: activeHandle === categoryRailParent.handle }
    : { label: t("catalog.all"), href: "/catalog", active: !activeHandle };

  const fallbackBrands = useMemo(() => {
    const seen = new Map<string, string>(); // нормализованный ключ → первое встретившееся написание
    for (const p of loadedProducts) {
      const orig = (p.brand || "").trim();
      if (orig && !seen.has(brandKey(orig))) seen.set(brandKey(orig), orig);
    }
    return [...seen.entries()]
      .map(([key, name]) => ({ key, name, count: 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [loadedProducts]);
  const fallbackBounds = useMemo(() => {
    const prices = loadedProducts.map((p) => p.price).filter((n) => n > 0); // priceTBD → price=0; без фильтра max=0 → ползунок «0 ₸ до 0 ₸»
    return { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 50000 };
  }, [loadedProducts]);
  const brandOptions = availableBrands.length > 0 ? availableBrands : fallbackBrands;
  const bounds = availablePriceBounds ?? fallbackBounds;

  const [selBrands, setSelBrands] = useState<Set<string>>(new Set());
  const [priceFloor, setPriceFloor] = useState<number | null>(null);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const priceMax = Math.max(bounds.min, Math.min(priceCap ?? bounds.max, bounds.max));
  const priceMin = Math.min(priceMax, Math.max(bounds.min, priceFloor ?? bounds.min));
  const [onlySale, setOnlySale] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);
  const [prescription, setPrescription] = useState<PrescriptionFilter>("all");
  const [sort, setSort] = useState<Sort>("popular");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTrackingReady = useRef(false);

  const activeFilterCount = selBrands.size + Number(priceFloor != null || priceCap != null) + Number(onlySale) + Number(onlyStock) + Number(prescription !== "all");
  const requestKey = useMemo(() => JSON.stringify({
    q: searchQuery.trim(),
    city,
    exact: exactSearch,
    pharmacies: [...pharmacyCodes].sort(),
    category: activeHandle,
    brands: [...selBrands].sort(),
    minPrice: priceFloor == null ? null : priceMin,
    maxPrice: priceCap == null ? null : priceMax,
    inStock: onlyStock,
    sale: onlySale,
    prescription,
    sort,
  } satisfies CatalogRequest), [activeHandle, city, exactSearch, onlySale, onlyStock, pharmacyCodes, prescription, priceCap, priceFloor, priceMax, priceMin, searchQuery, selBrands, sort]);
  const request = useMemo(() => JSON.parse(requestKey) as CatalogRequest, [requestKey]);
  const loadError = requestError?.key === requestKey;
  const initialLoadError = loadError && requestError?.phase === "initial";
  const awaitingSearch = Boolean(searchQuery.trim()) && resultRequestKey !== requestKey;
  const loadingResults = refreshing || (awaitingSearch && !loadError);

  useEffect(() => {
    if (!activeHandle) return;
    trackEvent("category_viewed", { category: activeHandle });
  }, [activeHandle]);

  useEffect(() => {
    if (!filterTrackingReady.current) {
      filterTrackingReady.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      trackEvent("filter_applied", {
        category: activeHandle ?? null,
        activeFilters: activeFilterCount,
        sort,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeFilterCount, activeHandle, requestKey, sort]);

  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);

  useEffect(() => {
    return () => loadMoreControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!cityReady) return;
    activeRequestRef.current = requestKey;
    loadMoreControllerRef.current?.abort();
    // Server-rendered catalogue/category pages already contain a verified first
    // page and total. Do not immediately request the same page again: that race
    // used to disable pagination and display "Loading" over finished cards.
    const firstClientRequest = initialRequestRef.current;
    if (firstClientRequest) {
      initialRequestRef.current = false;
      if (initialPageVerified && totalCount != null && city === "Алматы" && !searchQuery) return;
    }
    const requestedOffset = firstClientRequest ? (Math.max(1, initialPage) - 1) * CATALOG_PAGE_SIZE : 0;
    const controller = new AbortController();
    const loadingFrame = window.requestAnimationFrame(() => {
      if (!controller.signal.aborted && activeRequestRef.current === requestKey) {
        setRefreshing(true);
        setRequestError(null);
      }
    });

    void (async () => {
      try {
        const requestParams = catalogRequestParams(request, requestedOffset);
        requestParams.set("facets", "0");
        const response = await fetch(`/api/catalog?${requestParams.toString()}`, {
          cache: "default",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`catalog_page_${response.status}`);
        const payload = await response.json() as CatalogPageResponse;
        if (!Array.isArray(payload.products)) throw new Error("catalog_page_invalid");
        if (controller.signal.aborted || activeRequestRef.current !== requestKey) return;

        const nextProducts = payload.products.filter(isProduct);
        const responseCount = typeof payload.count === "number" && Number.isSafeInteger(payload.count) && payload.count >= 0
          ? payload.count
          : nextProducts.length;
        const responsePage = typeof payload.page === "number" && Number.isSafeInteger(payload.page) && payload.page >= 1
          ? payload.page
          : Math.floor(requestedOffset / CATALOG_PAGE_SIZE) + 1;

        setPageProducts(nextProducts);
        setKnownTotalCount(responseCount);
        setCurrentPage(responsePage);
        setSearchMetadata(readSearchFeedback(payload.meta?.search, request.q));
        setResultRequestKey(requestKey);
        if (isCatalogFacets(payload.facets)) {
          setFacets(payload.facets);
          if (tree.length === 0) {
            setFallbackCategories(payload.facets.categories.map((category) => ({
              id: category.id,
              name: category.name,
              handle: category.slug,
              children: [],
            })));
          }
          if (request.brands.length === 0) setAvailableBrands(payload.facets.brands);
          if (request.minPrice == null && request.maxPrice == null && payload.facets.price.min != null && payload.facets.price.max != null) {
            setAvailablePriceBounds({ min: payload.facets.price.min, max: payload.facets.price.max });
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && activeRequestRef.current === requestKey && !(error instanceof DOMException && error.name === "AbortError")) {
          setRequestError({ key: requestKey, phase: "initial" });
        }
      } finally {
        window.cancelAnimationFrame(loadingFrame);
        if (!controller.signal.aborted && activeRequestRef.current === requestKey) setRefreshing(false);
      }
    })();

    return () => {
      window.cancelAnimationFrame(loadingFrame);
      controller.abort();
    };
  }, [city, cityReady, initialPage, initialPageVerified, request, requestKey, retryAttempt, searchQuery, totalCount, tree.length]);

  // Product pages must never wait for the expensive global aggregates. Load
  // filter metadata after the first paint on desktop, or only when the mobile
  // filter drawer is actually opened.
  useEffect(() => {
    if (!cityReady || facetsRequestKeyRef.current === requestKey) return;
    if (!filtersOpen && !window.matchMedia("(min-width: 1280px)").matches) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = catalogRequestParams(request, 0);
      params.set("limit", "1");
      params.set("facets", "1");
      fetch(`/api/catalog?${params.toString()}`, { cache: "default", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog_facets_failed")))
        .then((payload: CatalogPageResponse) => {
          if (controller.signal.aborted || !isCatalogFacets(payload.facets)) return;
          facetsRequestKeyRef.current = requestKey;
          setFacets(payload.facets);
          if (tree.length === 0) setFallbackCategories(payload.facets.categories.map((category) => ({ id: category.id, name: category.name, handle: category.slug, children: [] })));
          if (request.brands.length === 0) setAvailableBrands(payload.facets.brands);
          if (request.minPrice == null && request.maxPrice == null && payload.facets.price.min != null && payload.facets.price.max != null) {
            setAvailablePriceBounds({ min: payload.facets.price.min, max: payload.facets.price.max });
          }
        })
        .catch(() => undefined);
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cityReady, filtersOpen, request, requestKey, tree.length]);

  // Never show products from the previous query/city under a new search heading.
  const filtered = awaitingSearch ? [] : loadedProducts;

  const toggleBrand = (b: string) =>
    setSelBrands((prev) => {
      const n = new Set(prev);
      if (n.has(b)) n.delete(b); else n.add(b);
      return n;
    });
  const reset = () => { setSelBrands(new Set()); setPriceFloor(null); setPriceCap(null); setOnlySale(false); setOnlyStock(false); setPrescription("all"); };

  const activeFilters = [
    ...[...selBrands].map((brandKeyValue) => ({
      key: `brand-${brandKeyValue}`,
      label: brandOptions.find((brand) => brand.key === brandKeyValue)?.name ?? brandKeyValue,
      onRemove: () => toggleBrand(brandKeyValue),
    })),
    ...(priceFloor != null || priceCap != null ? [{
      key: "price",
      label: `${filterText.price}: ${tenge(priceMin)}–${tenge(priceMax)}`,
      onRemove: () => { setPriceFloor(null); setPriceCap(null); },
    }] : []),
    ...(onlyStock ? [{ key: "stock", label: t("catalog.inStock"), onRemove: () => setOnlyStock(false) }] : []),
    ...(onlySale ? [{ key: "sale", label: t("catalog.onlySale"), onRemove: () => setOnlySale(false) }] : []),
    ...(prescription !== "all" ? [{
      key: "prescription",
      label: prescription === "rx" ? filterText.rx : filterText.otc,
      onRemove: () => setPrescription("all"),
    }] : []),
  ];

  const totalPages = knownTotalCount == null ? 0 : Math.ceil(knownTotalCount / CATALOG_PAGE_SIZE);

  const loadPage = useCallback(async (targetPage: number) => {
    const safePage = Math.min(totalPages, Math.max(1, Math.trunc(targetPage)));
    if (!safePage || safePage === currentPage || loadingMoreRef.current || loadingMore || loadingResults) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setRequestError(null);
    const expectedRequest = requestKey;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    try {
      const requestedOffset = (safePage - 1) * CATALOG_PAGE_SIZE;
      const params = catalogRequestParams(request, requestedOffset);
      params.set("facets", "0");
      const response = await fetch(`/api/catalog?${params.toString()}`, { cache: "default", signal: controller.signal });
      if (!response.ok) throw new Error(`catalog_page_${response.status}`);
      const payload = await response.json() as CatalogPageResponse;
      if (!Array.isArray(payload.products)) throw new Error("catalog_page_invalid");
      if (controller.signal.aborted || activeRequestRef.current !== expectedRequest) return;

      const nextProducts = payload.products.filter(isProduct);
      const responseTotal = typeof payload.count === "number" && Number.isSafeInteger(payload.count) && payload.count >= 0
        ? payload.count
        : knownTotalCount;
      if (!nextProducts.length && safePage > 1) throw new Error("catalog_page_empty");
      setPageProducts(nextProducts);
      setKnownTotalCount(responseTotal);
      setCurrentPage(safePage);
      const url = new URL(window.location.href);
      if (safePage === 1) url.searchParams.delete("page");
      else url.searchParams.set("page", String(safePage));
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      window.requestAnimationFrame(() => catalogTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      if (!controller.signal.aborted && activeRequestRef.current === expectedRequest) setRequestError({ key: expectedRequest, phase: "more" });
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [currentPage, knownTotalCount, loadingMore, loadingResults, request, requestKey, totalPages]);

  // Счётчик в шапке: реальный total категории Medusa до пагинации.
  const displayCount = knownTotalCount ?? filtered.length;

  const filters = (
    <div className="space-y-7">
      <FilterGroup title={t("drawer.categories")}>
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/catalog"
              aria-current={!activeHandle ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 items-center rounded-xl px-3 py-2 text-sm transition before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
                !activeHandle ? "bg-brand-50 font-semibold text-brand-900 before:bg-brand-700" : "text-slate-600 before:bg-transparent hover:bg-slate-50",
              )}
            >
              <LayoutGrid className="mr-2.5 h-4 w-4 shrink-0 text-brand-700" />
              {t("catalog.all")}
            </Link>
          </li>
          {navigationTree.map((n) => (
            <TreeNode key={n.id} node={n} activeHandle={activeHandle} openSet={openSet} depth={0} />
          ))}
          {navigationTree.length === 0 && refreshing && <CategoryNavSkeleton />}
        </ul>
      </FilterGroup>

      {brandOptions.length > 1 && (
        <FilterGroup title={t("catalog.brand")}>
          <BrandFilter
            options={brandOptions}
            selected={selBrands}
            onToggle={toggleBrand}
            copy={filterText}
          />
        </FilterGroup>
      )}

      <FilterGroup title={t("catalog.price")}>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={bounds.min} max={priceMax} step={50} value={priceFloor ?? ""} placeholder={String(bounds.min)} onChange={(e) => setPriceFloor(e.target.value === "" ? null : Number(e.target.value))} aria-label={t("catalog.minPrice")} className="h-11 min-w-0 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400" />
          <input type="number" min={priceMin} max={bounds.max} step={50} value={priceCap ?? ""} placeholder={String(bounds.max)} onChange={(e) => setPriceCap(e.target.value === "" ? null : Number(e.target.value))} aria-label={t("catalog.maxPrice")} className="h-11 min-w-0 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400" />
        </div>
        <input type="range" min={bounds.min} max={bounds.max} step={50} value={priceMax} onChange={(e) => setPriceCap(Number(e.target.value))} className="h-11 w-full accent-slate-900" />
        <div className="mt-1 flex justify-between text-sm text-slate-500">
          <span>{tenge(priceMin)}</span>
          <span className="font-semibold text-slate-800">{t("catalog.priceTo")} {tenge(priceMax)}</span>
        </div>
      </FilterGroup>

      <FilterGroup title={t("catalog.availability")}>
        <Checkbox checked={onlyStock} onChange={() => setOnlyStock((v) => !v)} label={`${t("catalog.inStock")}${facets ? ` (${facets.availability.inStock})` : ""}`} />
      </FilterGroup>

      <FilterGroup title={t("catalog.promos")}>
        <Checkbox checked={onlySale} onChange={() => setOnlySale((v) => !v)} label={t("catalog.onlySale")} />
      </FilterGroup>

      <FilterGroup title={t("catalog.prescription")}>
        <select value={prescription} onChange={(event) => setPrescription(event.target.value as PrescriptionFilter)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400">
          <option value="all">{t("catalog.prescriptionAll")}</option>
          <option value="rx">{t("catalog.rx")}</option>
          <option value="otc">{t("catalog.otc")}</option>
        </select>
      </FilterGroup>

      <button onClick={reset} className="inline-flex min-h-11 items-center text-sm font-medium text-slate-500 transition hover:text-accent-600">{t("common.reset")}</button>
    </div>
  );

  return (
    <div ref={catalogTopRef} className="mx-auto max-w-7xl scroll-mt-32 px-4 py-3 sm:px-6 sm:py-6">
      <div className="hidden sm:block">
        <Breadcrumbs
          items={crumbs ?? [
            { label: t("common.home"), href: "/" },
            { label: t("common.catalog"), href: "/catalog" },
            ...(path ?? []).map((n, i) => ({ label: catalogCategoryName(n.handle, n.name, lang), href: i < (path!.length - 1) ? `/catalog/${n.handle}` : undefined })),
          ]}
        />
      </div>

      <div className="mt-1 sm:mt-4">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl">
          {searchQuery ? `${t("search.results")} «${searchQuery}»` : activeName ?? t("catalog.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 sm:text-base" aria-live="polite">
          {loadingResults && filtered.length === 0
            ? loadText.loading
            : initialLoadError && filtered.length === 0 ? t("search.error")
            : <>{displayCount} {plural(displayCount)}</>}
        </p>
        {searchQuery && !loadingResults && !initialLoadError && (
          <SearchFeedback
            metadata={searchMetadata}
            exact={exactSearch}
            originalHref={searchResultsHref(searchQuery, { city, pharmacies: pharmacyCodes, exact: true })}
            relaxedHref={searchResultsHref(searchQuery, { city, pharmacies: pharmacyCodes })}
          />
        )}
      </div>

      {categoryRailItems.length > 0 && (
        <>
          <MobileCategoryPicker
            label={t("drawer.categories")}
            currentLabel={activeName ?? categoryRailRoot.label}
            root={categoryRailRoot}
            items={categoryRailItems}
            activeHandle={activeHandle}
          />
          <CategoryRail
            label={t("drawer.categories")}
            root={categoryRailRoot}
            items={categoryRailItems}
            activeHandle={activeHandle}
          />
        </>
      )}

      <div className="sticky top-[106px] z-40 -mx-4 mt-3 border-y border-slate-100 bg-white/95 px-4 py-2 shadow-[0_10px_20px_-22px_rgba(15,23,42,0.75)] backdrop-blur-xl sm:-mx-6 sm:top-[68px] sm:px-6 lg:top-[100px] xl:static xl:mx-0 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-expanded={filtersOpen} className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-base font-medium text-slate-700 transition hover:border-brand-300 sm:text-sm xl:hidden">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("catalog.filters")}</span>
            {activeFilterCount > 0 && (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-700 px-1 text-[11px] font-bold text-white" aria-label={`${t("catalog.filters")}: ${activeFilterCount}`}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <SortSelect value={sort} onChange={setSort} options={sortValues.map((v) => ({ value: v, label: t(`sort.${v}`) }))} />
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="mt-3 flex min-w-0 items-center gap-2">
          <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={filter.onRemove}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-50 px-3 text-sm font-medium text-brand-800 transition hover:bg-brand-100"
                aria-label={`${filter.label}: ${t("common.reset")}`}
              >
                <span>{filter.label}</span>
                <X className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <button type="button" onClick={reset} className="h-9 shrink-0 px-1 text-sm font-semibold text-slate-500 transition hover:text-accent-600">
            {t("common.reset")}
          </button>
        </div>
      )}
      <div className="mt-4 grid items-start gap-5 sm:mt-6 xl:grid-cols-[272px_minmax(0,1fr)] xl:gap-6">
        <aside className="hidden xl:block">
          <DesktopFilterPanel title={t("catalog.filters")} activeFilterCount={activeFilterCount}>
            {filters}
          </DesktopFilterPanel>
        </aside>

        <div>
          {loadingResults && filtered.length === 0 ? (
            <CatalogGridSkeleton />
          ) : initialLoadError && filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center" role="alert">
              <p className="font-semibold text-slate-800">{searchQuery ? t("search.error") : loadText.error}</p>
              <button type="button" onClick={() => setRetryAttempt((attempt) => attempt + 1)} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">
                {loadText.retry}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-20 text-center">
              <p className="font-semibold text-slate-800">{t("catalog.empty")}</p>
              <p className="mt-1 text-sm text-slate-500">{t(searchQuery ? "search.emptyHelp" : "catalog.emptySub")}</p>
              {searchQuery ? (
                <Link href="/catalog" className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white transition hover:bg-brand-800">
                  {t("catalog.allProducts")}
                </Link>
              ) : (
                <button onClick={reset} className="mt-4 text-sm font-semibold text-slate-900 underline-offset-4 hover:underline">{t("common.reset")}</button>
              )}
            </div>
          ) : (
            <div className={cn("grid grid-flow-row-dense grid-cols-2 gap-3 transition-opacity sm:gap-4 md:grid-cols-3", loadingMore && "pointer-events-none opacity-55")} aria-busy={loadingMore}>
              {filtered.map((p, i) => {
                // Реклама вперемешку: чаще вертикальные вставки (размером с одну карточку товара), реже — горизонтальные (на 2 колонки).
                const showPromo = (i + 1) % 5 === 0 && filtered.length - (i + 1) >= 2;
                const slot = Math.floor(i / 5);
                const promo = showPromo ? catalogPromos[slot % catalogPromos.length] : null;
                const tall = slot % 4 !== 0; // 3 из 4 вставок вертикальные, 1 из 4 — горизонтальная
                return (
                  <Fragment key={p.id}>
                    <ProductCard product={p} />
                    {promo && <PromoCell promo={promo} tall={tall} />}
                  </Fragment>
                );
              })}
            </div>
          )}
          {knownTotalCount != null && !(initialLoadError && filtered.length === 0) && !awaitingSearch && totalPages > 1 && (
            <CatalogPagination
              currentPage={currentPage}
              totalPages={totalPages}
              loading={loadingMore || loadingResults}
              error={loadError ? loadText.error : null}
              previousLabel={t("common.previous")}
              nextLabel={t("common.next")}
              paginationLabel={t("catalog.pagination")}
              pageLabel={t("catalog.page")}
              onPageChange={(page) => void loadPage(page)}
            />
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-[70] xl:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-filter-title">
          <button type="button" className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)} aria-label={t("catalog.closeFilters")} />
          <div className="absolute right-0 top-0 flex h-full h-dvh w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex min-w-0 items-center gap-2">
                <h2 id="mobile-filter-title" className="truncate font-display text-lg font-bold">{t("catalog.filters")}</h2>
                {activeFilterCount > 0 && <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-brand-100 px-1.5 text-xs font-bold text-brand-800">{activeFilterCount}</span>}
              </div>
              <button onClick={() => setFiltersOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label={t("catalog.filters")}><X className="h-6 w-6" /></button>
            </div>
            <div className="catalog-scrollbar min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{filters}</div>
            <div className="border-t border-slate-100 p-4 [padding-bottom:calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pt-5 sm:[padding-bottom:calc(1.25rem+env(safe-area-inset-bottom))]">
              <button onClick={() => setFiltersOpen(false)} className="h-12 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white">
                {t("catalog.show")} {displayCount} {plural(displayCount)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogPagination({
  currentPage,
  totalPages,
  loading,
  error,
  previousLabel,
  nextLabel,
  paginationLabel,
  pageLabel,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  previousLabel: string;
  nextLabel: string;
  paginationLabel: string;
  pageLabel: string;
  onPageChange: (page: number) => void;
}) {
  const items = catalogPaginationItems(currentPage, totalPages);
  const control = "inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav className="mt-7 border-t border-slate-200 pt-6" aria-label={paginationLabel}>
      {error && <p role="alert" className="mb-3 text-center text-sm text-rose-600">{error}</p>}
      <div className="flex items-center justify-between gap-2 sm:justify-center" aria-live="polite">
        <button type="button" className={control} disabled={loading || currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} aria-label={previousLabel}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          <span className="ml-1 hidden sm:inline">{previousLabel}</span>
        </button>
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {items.map((item) => typeof item === "number" ? (
            <button
              key={item}
              type="button"
              disabled={loading}
              aria-current={item === currentPage ? "page" : undefined}
              aria-label={`${pageLabel} ${item}`}
              onClick={() => onPageChange(item)}
              className={cn(control, "shrink-0 px-2", item === currentPage && "border-brand-700 bg-brand-700 text-white hover:text-white")}
            >
              {item}
            </button>
          ) : <span key={item} className="grid h-11 min-w-7 place-items-center text-slate-400" aria-hidden="true">…</span>)}
        </div>
        <button type="button" className={control} disabled={loading || currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} aria-label={nextLabel}>
          <span className="mr-1 hidden sm:inline">{nextLabel}</span>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-slate-500">{currentPage} / {totalPages}</p>
    </nav>
  );
}

function CategoryIcon({ node, className }: { node: CatNode; className?: string }) {
  const key = `${node.handle} ${node.name}`.toLocaleLowerCase("ru");
  if (/мама|малыш|дет|baby|mama/.test(key)) return <Baby className={className} />;
  if (/космет|красот|уход|beaut/.test(key)) return <Sparkles className={className} />;
  if (/гигиен|hygien/.test(key)) return <ShieldCheck className={className} />;
  if (/линз|глаз|оптик|lens/.test(key)) return <Eye className={className} />;
  if (/спорт|фитнес|sport|fitness/.test(key)) return <Dumbbell className={className} />;
  if (/прибор|издел|медтех|device/.test(key)) return <Stethoscope className={className} />;
  if (/лекар|препарат|medicin/.test(key)) return <Cross className={className} />;
  if (/бад|витамин|supplement/.test(key)) return <Pill className={className} />;
  if (/взросл|интим|adult/.test(key)) return <HeartPulse className={className} />;
  if (/здоров|профилак|health/.test(key)) return <Activity className={className} />;
  return <CircleEllipsis className={className} />;
}

function CategoryNavSkeleton() {
  const { t } = useLang();
  return (
    <li className="space-y-2 px-1 py-2" aria-label={t("catalog.loadingCategories")}>
      {[78, 64, 88, 70, 82, 58].map((width, index) => (
        <div key={`${width}-${index}`} className="flex h-9 animate-pulse items-center gap-2.5 rounded-lg px-2">
          <span className="h-4 w-4 rounded bg-slate-100" />
          <span className="h-3 rounded bg-slate-100" style={{ width: `${width}%` }} />
        </div>
      ))}
    </li>
  );
}

function CatalogGridSkeleton() {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3" aria-label={t("catalog.loadingCards")} aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="rounded-xl border border-slate-200/80 bg-white p-2 sm:rounded-2xl sm:p-3">
          <div className="aspect-square animate-pulse rounded-lg bg-slate-100 sm:rounded-xl" />
          <div className="mt-3 h-3 w-2/5 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-4 w-full animate-pulse rounded bg-slate-100" />
          <div className="mt-1.5 h-4 w-4/5 animate-pulse rounded bg-slate-100" />
          <div className="mt-5 h-5 w-2/5 animate-pulse rounded bg-slate-100" />
          <div className="mt-3 h-11 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Узел дерева категорий в сайдбаре: ссылка + раскрытие детей. Активный путь раскрыт по умолчанию. */
function TreeNode({ node, activeHandle, openSet, depth }: { node: CatNode; activeHandle?: string; openSet: Set<string>; depth: number }) {
  const { t, lang } = useLang();
  const isActive = node.handle === activeHandle;
  const hasChildren = node.children.length > 0;
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override === null ? openSet.has(node.handle) : override;

  return (
    <li>
      <div className={cn("relative flex items-center rounded-xl transition", isActive ? "bg-brand-50 text-brand-900" : "hover:bg-slate-50")}>
        {isActive && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-700" />}
        <Link
          href={`/catalog/${node.handle}`}
          aria-current={isActive ? "page" : undefined}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-2.5 truncate py-2 pr-2 text-sm transition", isActive ? "font-semibold text-brand-900" : depth === 0 ? "text-slate-700" : "text-slate-500")}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          {depth === 0 ? (
            <CategoryIcon node={node} className={cn("h-4 w-4 shrink-0", isActive ? "text-brand-700" : "text-slate-400")} />
          ) : (
            <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isActive ? "bg-brand-600" : "bg-slate-300")} />
          )}
          <span className="truncate">{catalogCategoryName(node.handle, node.name, lang)}</span>
        </Link>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setOverride(!open)}
            aria-label={open ? t("catalog.collapse") : t("catalog.expand")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} activeHandle={activeHandle} openSet={openSet} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Рекламный баннер-ячейка в сетке каталога (на 2 колонки), в духе Sephora. */
function PromoCell({ promo, tall = false }: { promo: Promo; tall?: boolean }) {
  const { t } = useLang();
  const translationPrefix = `catalog.promo.${promo.id}`;
  return (
    <Link
      href={promo.href}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 text-white",
        promo.className,
        // Вертикальная вставка = одна ячейка (растягивается в высоту карточки товара);
        // горизонтальная — на две колонки.
        tall ? "" : "col-span-2",
      )}
    >
      <Image
        src={promo.img}
        alt=""
        fill
        sizes={tall ? "(max-width: 767px) 50vw, 33vw" : "(max-width: 767px) 100vw, 66vw"}
        className="object-cover transition duration-500 group-hover:scale-105"
        style={{ objectPosition: promo.position ?? "center" }}
      />
      <span className={cn("absolute inset-0 bg-gradient-to-r", promo.overlay ?? "from-slate-950/90 via-slate-950/65 to-slate-950/10")} />
      <div className="relative z-10">
        {promo.eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">{t(`${translationPrefix}.eyebrow`)}</p>}
        <h3 className="mt-2 font-display text-2xl font-extrabold leading-tight">{t(`${translationPrefix}.title`)}</h3>
        {promo.subtitle && <p className="mt-1.5 text-sm text-white/90">{t(`${translationPrefix}.subtitle`)}</p>}
      </div>
      <span className="relative z-10 mt-5 inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-900 transition-all group-hover:gap-2.5">
        {t(`${translationPrefix}.cta`)} <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function CategoryRail({
  label,
  root,
  items,
  activeHandle,
}: {
  label: string;
  root: { label: string; href: string; active: boolean };
  items: CatNode[];
  activeHandle?: string;
}) {
  const { t, lang } = useLang();
  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const update = () => {
      setCanScrollLeft(rail.scrollLeft > 4);
      setCanScrollRight(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4);
    };
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const target = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, target), behavior: "instant" });
    }
    update();

    const observer = new ResizeObserver(update);
    observer.observe(rail);
    rail.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", update);
    };
  }, [activeHandle, items]);

  const scrollByPage = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(240, rail.clientWidth * 0.72), behavior: "smooth" });
  };

  const linkClass = (active: boolean) => cn(
    "inline-flex h-10 shrink-0 snap-start items-center rounded-xl border px-3.5 text-sm font-semibold transition-colors",
    active
      ? "border-brand-700 bg-brand-700 text-white shadow-[0_5px_14px_-9px_rgba(11,111,60,0.9)]"
      : "border-slate-200/90 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800",
  );

  return (
    <div className="relative mt-4 hidden sm:block">
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        disabled={!canScrollLeft}
        aria-label={t("catalog.scrollLeft")}
        className={cn(
          "absolute left-1 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md transition",
          canScrollLeft ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <nav
        ref={railRef}
        aria-label={label}
        className={cn(
          "no-scrollbar flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:px-0",
          canScrollLeft && "catalog-rail-fade-left",
          canScrollRight && "catalog-rail-fade-right",
        )}
      >
        <Link href={root.href} aria-current={root.active ? "page" : undefined} className={linkClass(root.active)}>
          {root.label}
        </Link>
        {items.map((category) => {
          const active = category.handle === activeHandle;
          return (
            <Link
              key={category.id}
              href={`/catalog/${category.handle}`}
              aria-current={active ? "page" : undefined}
              className={linkClass(active)}
            >
              {catalogCategoryName(category.handle, category.name, lang)}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={() => scrollByPage(1)}
        disabled={!canScrollRight}
        aria-label={t("catalog.scrollRight")}
        className={cn(
          "absolute right-1 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md transition",
          canScrollRight ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function MobileCategoryPicker({
  label,
  currentLabel,
  root,
  items,
  activeHandle,
}: {
  label: string;
  currentLabel: string;
  root: { label: string; href: string; active: boolean };
  items: CatNode[];
  activeHandle?: string;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const matchedItems = normalizedQuery
    ? items.filter((category) => catalogCategoryName(category.handle, category.name, lang).toLocaleLowerCase().includes(normalizedQuery))
    : items;
  const preferredPopular = [
    /лекар|препарат|medicin/,
    /витамин|бад|supplement/,
    /мама|малыш|дет|baby|mama/,
  ]
    .flatMap((pattern) => items.filter((category) => pattern.test(`${category.handle} ${category.name}`.toLocaleLowerCase("ru"))).slice(0, 1))
    .filter((category, index, matches) => matches.findIndex((match) => match.id === category.id) === index);
  const popularItems = preferredPopular.length > 0 ? preferredPopular.slice(0, 3) : items.slice(0, 3);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.getElementById("mobile-category-dialog");
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0);
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
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleDialogKeys);
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDialogKeys);
      previousFocus?.focus();
    };
  }, [open]);

  const openPicker = () => {
    setQuery("");
    setOpen(true);
  };

  return (
    <div className="mt-4 sm:hidden">
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-category-dialog"
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 text-left transition hover:border-brand-200 active:scale-[0.99]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <LayoutGrid className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{label}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{currentLabel}</span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div id="mobile-category-dialog" className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] top-0 z-[75]" role="dialog" aria-modal="true" aria-labelledby="mobile-category-title">
          <button type="button" onClick={() => setOpen(false)} aria-label={t("catalog.closeCategories")} className="absolute inset-0 cursor-default bg-slate-950/55" />
          <section className="absolute inset-x-0 bottom-0 flex max-h-[72dvh] flex-col overflow-hidden rounded-t-[1.25rem] bg-white shadow-2xl">
            <div className="mx-auto mt-2 h-1 w-12 shrink-0 rounded-full bg-slate-300" />
            <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-2">
              <h2 id="mobile-category-title" className="font-display text-2xl font-extrabold tracking-tight text-slate-950">{label}</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t("catalog.closeCategories")} className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 focus-visible:border-brand-300 focus-visible:text-brand-700 focus-visible:outline-none">
                <X className="h-5 w-5" />
              </button>
            </header>

            <label className="relative mx-5 block shrink-0">
              <span className="sr-only">{t("catalog.findCategory")}</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-700" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("catalog.findCategory")}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500"
              />
            </label>

            <div className="catalog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5">
              {!normalizedQuery && popularItems.length > 0 && (
                <section aria-labelledby="mobile-category-popular-title">
                  <h3 id="mobile-category-popular-title" className="text-sm font-bold text-slate-900">{t("catalog.oftenChosen")}</h3>
                  <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                    {popularItems.map((category) => (
                      <Link key={`popular-${category.id}`} href={`/catalog/${category.handle}`} onClick={() => setOpen(false)} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-50 px-2.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-100">
                        <CategoryIcon node={category} className="h-4 w-4" />
                        {catalogCategoryName(category.handle, category.name, lang)}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <nav aria-label={label} className={cn(!normalizedQuery && popularItems.length > 0 && "mt-5")}>
                <h3 className="text-sm font-bold text-slate-900">{t("catalog.allCategories")}</h3>
                <div className="mt-2 overflow-hidden border-y border-slate-100">
                  <Link
                    href={root.href}
                    onClick={() => setOpen(false)}
                    aria-current={root.active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 items-center gap-3 border-b border-slate-100 px-1 py-2.5 transition",
                      root.active ? "bg-brand-50/70 text-brand-900" : "text-slate-800 hover:bg-slate-50",
                    )}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><LayoutGrid className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1 text-sm font-bold">{root.label}</span>
                    {root.active ? <Check className="h-5 w-5 shrink-0 text-brand-700" /> : <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />}
                  </Link>
                  {matchedItems.map((category) => {
                    const active = category.handle === activeHandle;
                    return (
                      <Link
                        key={category.id}
                        href={`/catalog/${category.handle}`}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-14 items-center gap-3 border-b border-slate-100 px-1 py-2.5 text-slate-800 transition last:border-b-0 hover:bg-slate-50",
                          active && "bg-brand-50/70 text-brand-900",
                        )}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><CategoryIcon node={category} className="h-[18px] w-[18px]" /></span>
                        <span className="min-w-0 flex-1 text-sm font-bold leading-tight">{catalogCategoryName(category.handle, category.name, lang)}</span>
                        {active ? <Check className="h-5 w-5 shrink-0 text-brand-700" /> : <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />}
                      </Link>
                    );
                  })}
                </div>
                {normalizedQuery && matchedItems.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{t("catalog.noCategories")}</p>}
                <Link href="/catalog" onClick={() => setOpen(false)} className="mt-2 flex min-h-12 items-center gap-3 rounded-xl px-1 text-sm font-bold text-brand-700 transition hover:bg-brand-50">
                  <span className="flex-1">{t("common.openFullCatalog")}</span>
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </nav>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function DesktopFilterPanel({ title, activeFilterCount, children }: { title: string; activeFilterCount: number; children: React.ReactNode }) {
  return (
    <div className="sticky top-24 rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_32px_-28px_rgba(15,23,42,0.5)]">
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
        <h2 className="font-display text-sm font-bold text-slate-900">{title}</h2>
        {activeFilterCount > 0 && (
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-100 px-1.5 text-xs font-bold text-brand-800">
            {activeFilterCount}
          </span>
        )}
      </div>
      <div className="px-4 py-5">{children}</div>
    </div>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" onClick={onChange} aria-pressed={checked} className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-1 py-2 text-left text-sm text-slate-700 transition hover:text-slate-900">
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border transition", checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

function BrandFilter({
  options,
  selected,
  onToggle,
  copy,
}: {
  options: CatalogFacets["brands"];
  selected: Set<string>;
  onToggle: (key: string) => void;
  copy: CatalogFilterCopy;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(40);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matched = useMemo(() => {
    const filteredOptions = normalizedQuery
      ? options.filter((brand) => brand.name.toLocaleLowerCase().includes(normalizedQuery))
      : options;
    return [...filteredOptions].sort((a, b) => Number(selected.has(b.key)) - Number(selected.has(a.key)));
  }, [normalizedQuery, options, selected]);
  const visible = expanded ? matched.slice(0, visibleLimit) : matched.slice(0, 8);

  return (
    <div>
      {expanded && (
        <label className="relative mb-2 block">
          <span className="sr-only">{copy.brandSearch}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleLimit(40);
            }}
            placeholder={copy.brandSearch}
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:bg-white sm:text-sm"
          />
        </label>
      )}
      <div className="space-y-0.5">
        {visible.map((brand) => (
          <Checkbox key={brand.key} checked={selected.has(brand.key)} onChange={() => onToggle(brand.key)} label={`${brand.name}${brand.count > 0 ? ` (${brand.count})` : ""}`} />
        ))}
        {expanded && matched.length === 0 && <p className="px-1 py-3 text-sm text-slate-500">{copy.noResults}</p>}
        {expanded && matched.length > visibleLimit && (
          <button
            type="button"
            onClick={() => setVisibleLimit((limit) => limit + 40)}
            className="min-h-10 w-full rounded-lg text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            {copy.moreBrands} ({matched.length - visibleLimit})
          </button>
        )}
      </div>
      {options.length > 8 && (
        <button
          type="button"
          onClick={() => {
            setExpanded((value) => !value);
            if (expanded) setQuery("");
          }}
          className="mt-2 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand-700 transition hover:text-brand-900"
        >
          {expanded ? copy.collapseBrands : `${copy.showBrands} (${options.length})`}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

function SortSelect({ value, onChange, options }: { value: Sort; onChange: (s: Sort) => void; options: { value: Sort; label: string }[] }) {
  return (
    <div className="relative min-w-0">
      <select value={value} onChange={(e) => onChange(e.target.value as Sort)} className="h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-base font-medium text-slate-700 outline-none transition hover:border-brand-300 focus:border-brand-400 sm:w-auto sm:rounded-xl sm:pl-4 sm:pr-10 sm:text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
