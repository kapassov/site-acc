"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu, X, ShoppingCart, Heart, User, Globe, Coins, Percent, ChevronRight,
  MessageSquare, Phone, Clock, UserRound, MapPin, Tags, Truck, LayoutGrid,
} from "lucide-react";
import type { CatNode, Category } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { SearchBar } from "./SearchBar";
import { useCart } from "@/lib/cart/CartContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFavorites } from "@/lib/favorites/FavoritesContext";
import { useScanner } from "@/lib/ui/ScannerContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { langs } from "@/lib/i18n/dict";
import { CitySelector } from "./CitySelector";
import { useCatalogData } from "@/lib/content/CatalogData";
import { catalogCategoryName } from "@/lib/i18n/catalog-categories";

const sections = [
  { key: "nav.sale", href: "/promotions", icon: Percent },
  { key: "nav.pharmacies", href: "/pharmacies", icon: MapPin },
  { key: "nav.brands", href: "/brands", icon: Tags },
  { key: "nav.delivery", href: "/delivery", icon: Truck },
];

const serviceLinks = [
  { key: "top.feedback", href: "/help", icon: MessageSquare },
];

// Stable Daribar category handles used during the first network round-trip.
// Live categories/tree replace this list as soon as either endpoint responds.
const immediateCategories: Category[] = [
  { id: "nav-bady", slug: "bady", name: "БАДы", count: 0, icon: "Pill", from: "#d8f3ea", to: "#bce8da" },
  { id: "nav-hygiene", slug: "gigiyena", name: "Гигиена", count: 0, icon: "ShowerHead", from: "#d7f2f7", to: "#bce7ef" },
  { id: "nav-cosmetics", slug: "kosmetika", name: "Косметика", count: 0, icon: "Sparkles", from: "#dfe8fb", to: "#c7d7f5" },
  { id: "nav-medicine", slug: "lekarstva-i-bady", name: "Лекарства", count: 0, icon: "HeartPulse", from: "#e8dcfb", to: "#d9c4f6" },
  { id: "nav-lenses", slug: "linzy", name: "Линзы", count: 0, icon: "Droplets", from: "#fde2ee", to: "#f8c9df" },
  { id: "nav-family", slug: "mama-i-malysh", name: "Мама и малыш", count: 0, icon: "Baby", from: "#ffedca", to: "#ffe0a3" },
  { id: "nav-medical", slug: "med-pribory-i-izdeliya", name: "Мед. приборы и изделия", count: 0, icon: "Stethoscope", from: "#d8f3ea", to: "#bce8da" },
  { id: "nav-sport", slug: "sport-i-fitnes", name: "Спорт и фитнес", count: 0, icon: "Sparkles", from: "#dfe8fb", to: "#c7d7f5" },
  { id: "nav-adult", slug: "intim", name: "Товары для взрослых", count: 0, icon: "Sparkles", from: "#fde2ee", to: "#f8c9df" },
];

function LangSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Globe className="h-3.5 w-3.5 text-slate-400" />
      {langs.map((l, idx) => (
        <span key={l.code} className="flex items-center gap-1.5">
          {idx > 0 && <span className="text-slate-300">·</span>}
          <button
            onClick={() => setLang(l.code)}
            className={cn("text-xs uppercase tracking-wide transition", lang === l.code ? "font-bold text-brand-700" : "text-slate-500 hover:text-slate-900")}
          >
            {l.label}
          </button>
        </span>
      ))}
    </div>
  );
}

function mobileCategoryDescription(handle: string, t: (key: string) => string) {
  if (handle === "lekarstva-i-bady") return t("category.description.medicines");
  if (handle === "bady" || handle === "vitaminy-i-mineraly") return t("category.description.supplements");
  if (handle === "gigiyena") return t("category.description.hygiene");
  if (handle === "kosmetika") return t("category.description.beauty");
  if (handle === "linzy") return t("category.description.lenses");
  if (handle === "mama-i-malysh") return t("category.description.family");
  return t("common.goToSection");
}

export function Header() {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tree, setTree] = useState<CatNode[]>([]);
  const [catalogMenuTree, setCatalogMenuTree] = useState<CatNode[]>([]);
  const [catalogMenuCategories, setCatalogMenuCategories] = useState<Category[]>(immediateCategories);
  const [mobileMenuCategories, setMobileMenuCategories] = useState<Category[]>(immediateCategories);
  const [hovered, setHovered] = useState(0);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = (delay: number) => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, delay);
    };
    const load = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 6_000);
      try {
        const response = await fetch("/api/category-tree", { cache: "default", signal: controller.signal });
        const payload = response.ok ? await response.json() : [];
        if (!Array.isArray(payload) || payload.length === 0) throw new Error("empty_tree");
        if (alive) setTree(payload);
        failures = 0;
        schedule(10 * 60_000);
      } catch {
        failures += 1;
        schedule(Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5)));
      } finally {
        clearTimeout(timeout);
        controller = null;
      }
    };
    const reconnect = () => schedule(0);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") reconnect();
    };

    void load();
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.getElementById("mobile-site-menu");
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
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
    window.addEventListener("keydown", handleDialogKeys);
    const focusFrame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleDialogKeys);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileOpen]);
  const { count, open } = useCart();
  const pathname = usePathname();
  const compactOrderFlow = pathname.startsWith("/cart") || pathname.startsWith("/checkout") || pathname.startsWith("/payment");
  const { user, openLogin } = useAuth();
  const { count: favCount } = useFavorites();
  const { open: openBonus } = useScanner();
  const { lang, setLang, t, plural } = useLang();
  const { categories } = useCatalogData();
  // The lightweight category tree arrives before the full 100-product client
  // catalogue. Use it immediately so a freshly opened mobile menu is never empty.
  const navCategories = categories.length > 0 ? categories : tree.length > 0 ? tree.map((node, index) => {
    const palette = [
      ["#d8f3ea", "#bce8da"], ["#dfe8fb", "#c7d7f5"], ["#fde2ee", "#f8c9df"],
      ["#ffedca", "#ffe0a3"], ["#e8dcfb", "#d9c4f6"], ["#d7f2f7", "#bce7ef"],
    ][index % 6];
    return { id: node.id, slug: node.handle, name: node.name, count: 0, icon: "Sparkles", from: palette[0], to: palette[1] };
  }) : immediateCategories;

  const navItem = "relative inline-flex shrink-0 items-center gap-1 py-3 text-[13px] font-medium text-slate-700 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-brand-600 after:transition-transform hover:text-brand-700 hover:after:scale-x-100";
  const action = "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-slate-700 transition hover:text-brand-700";
  const badge = "absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white";
  const priorityOrder = ["lekarstva-i-bady", "bady", "med-pribory-i-izdeliya"];
  const prioritySlugs = new Set(priorityOrder);
  const priorityCategories = priorityOrder.flatMap((slug) => navCategories.filter((cat) => cat.slug === slug));
  const remainingCategories = navCategories.filter((cat) => !prioritySlugs.has(cat.slug));
  const toggleCatalogMenu = () => {
    if (!catalogOpen) {
      // Keep the rendered links stable until the menu is closed. Live Daribar
      // responses can arrive during a pointer press and must not replace its DOM.
      setCatalogMenuTree(tree);
      setCatalogMenuCategories(navCategories);
      setHovered(0);
    }
    setCatalogOpen((open) => !open);
  };
  const openMobileMenu = () => {
    setMobileMenuCategories(navCategories);
    setMobileOpen(true);
  };
  const closeCatalogAfterNavigation = () => window.setTimeout(() => setCatalogOpen(false), 0);
  const closeMobileAfterNavigation = () => window.setTimeout(() => setMobileOpen(false), 0);
  const visibleMobileCategories = mobileMenuCategories.slice(0, 6);
  const mobilePopularOrder = ["lekarstva-i-bady", "bady", "mama-i-malysh"];
  const popularMobileCategories = mobilePopularOrder.flatMap((slug) => mobileMenuCategories.filter((cat) => cat.slug === slug));

  return (
    <header className={cn(compactOrderFlow && "hidden", "sticky top-0 z-50 border-b border-brand-100/80 bg-white/95 shadow-[0_8px_28px_-24px_rgba(15,70,40,0.55)] backdrop-blur-xl")}>
      {/* ── thin top row (desktop) ── */}
      <div className="hidden border-b border-slate-100 bg-slate-50/80 lg:block">
        <div className="mx-auto flex h-7 max-w-7xl items-center gap-4 px-6">
          <div className="shrink-0"><CitySelector /></div>
          <nav aria-label={t("top.services")} className="no-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
            {serviceLinks.map(({ key, href, icon: Icon }) => (
              <Link key={key} href={href} className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-600 transition hover:text-brand-700">
                <Icon className="h-3.5 w-3.5 text-slate-400" /> {t(key)}
              </Link>
            ))}
            <a href="tel:+77000000000" className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-700 transition hover:text-brand-700">
              <Phone className="h-3.5 w-3.5 text-slate-400" /> +7 700 000 00 00
            </a>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-600">
              <Clock className="h-3.5 w-3.5 text-slate-400" /> {t("top.hours")}
            </span>
            {user ? (
              <Link href="/account" className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-700 transition hover:text-brand-700">
                <UserRound className="h-3.5 w-3.5 text-slate-400" /> {t("act.account")}
              </Link>
            ) : (
              <button onClick={openLogin} className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-700 transition hover:text-brand-700">
                <UserRound className="h-3.5 w-3.5 text-slate-400" /> {t("top.login")}
              </button>
            )}
          </nav>
          <div className="shrink-0"><LangSwitcher /></div>
        </div>
      </div>

      {/* ── main row ── */}
      <div className="mx-auto max-w-7xl px-3 py-1.5 sm:px-6 sm:py-2">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button onClick={openMobileMenu} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 xl:hidden" aria-label={t("a11y.openMenu")} aria-expanded={mobileOpen} aria-controls="mobile-site-menu">
            <Menu className="h-6 w-6" />
          </button>

          <Logo className="min-w-0 shrink" />

          <button
            onClick={toggleCatalogMenu}
            className="hidden h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-5 font-semibold text-white shadow-sm transition hover:bg-brand-700 xl:inline-flex"
          >
            {catalogOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />} {t("nav.catalog")}
          </button>

          <SearchBar className="hidden flex-1 sm:block" />

          <button
            onClick={openBonus}
            className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 font-semibold text-brand-700 transition hover:border-brand-200 hover:bg-brand-100 xl:inline-flex"
          >
            <Coins className="h-5 w-5" /> {t("header.bonus")}
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-5">
            <Link href="/favorites" className={cn(action, "hidden lg:flex")}>
              <span className="relative"><Heart className="h-6 w-6" />{favCount > 0 && <span className={badge}>{favCount}</span>}</span>
              <span className="sr-only xl:not-sr-only xl:text-[11px]">{t("act.favorites")}</span>
            </Link>
            {user ? (
              <Link href="/account" className={cn(action, "hidden lg:flex")}>
                <User className="h-6 w-6" />
                <span className="sr-only xl:not-sr-only xl:text-[11px]">{t("act.account")}</span>
              </Link>
            ) : (
              <button onClick={openLogin} className={cn(action, "hidden lg:flex")}>
                <User className="h-6 w-6" />
                <span className="sr-only xl:not-sr-only xl:text-[11px]">{t("act.login")}</span>
              </button>
            )}
            <button onClick={open} className={cn(action, "rounded-xl hover:bg-slate-100 sm:rounded-none sm:hover:bg-transparent")} aria-label={t("act.cart")}>
              <span className="relative"><ShoppingCart className="h-6 w-6" />{count > 0 && <span className={badge}>{count}</span>}</span>
              <span className="sr-only xl:not-sr-only xl:text-[11px]">{t("act.cart")}</span>
            </button>
          </div>
        </div>

        {/* mobile search */}
        <div className="mt-1.5 sm:hidden"><SearchBar /></div>
      </div>

      {/* ── category navigation (desktop) ── */}
      <div className="hidden border-y border-slate-100 bg-white/95 xl:block">
        <nav aria-label={t("a11y.productCategories")} className="no-scrollbar mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto px-6">
          <Link href="/promotions" className={cn(navItem, "font-semibold text-accent-600 after:bg-accent-500 hover:text-accent-600")}><Percent className="h-3.5 w-3.5" /> {t("nav.sale")}</Link>
          {priorityCategories.map((cat) => (
            <Link key={cat.slug} href={`/catalog/${cat.slug}`} className={navItem}>{catalogCategoryName(cat.slug, cat.name, lang)}</Link>
          ))}
          {remainingCategories.map((cat) => (
            <Link key={cat.slug} href={`/catalog/${cat.slug}`} className={navItem}>{catalogCategoryName(cat.slug, cat.name, lang)}</Link>
          ))}
          <Link href="/catalog" className="ml-1 inline-flex shrink-0 items-center border-l border-slate-200 py-3 pl-5 text-[13px] font-semibold text-brand-700 transition hover:text-brand-900">{t("common.viewAll")}</Link>
        </nav>
      </div>

      {/* ── Catalog mega menu ── */}
      {catalogOpen && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setCatalogOpen(false)} aria-label={t("common.close")} tabIndex={-1} />
          <div className="absolute inset-x-0 top-full z-50 border-b border-slate-100 bg-white shadow-pop">
            <div className="mx-auto max-w-7xl px-6 py-6">
              {catalogMenuTree.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-[260px_1fr]">
                  {/* верхние категории — наведение раскрывает подкатегории справа */}
                  <ul className="space-y-0.5 md:border-r md:border-slate-100 md:pr-4">
                    {catalogMenuTree.map((c, i) => (
                      <li key={c.id} onMouseEnter={() => setHovered(i)}>
                        <Link
                          href={`/catalog/${c.handle}`}
                          onClick={closeCatalogAfterNavigation}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                            i === hovered ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50",
                          )}
                        >
                          <span className="truncate">{catalogCategoryName(c.handle, c.name, lang)}</span>
                          {c.children.length > 0 && <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="max-h-[74vh] min-h-[200px] overflow-y-auto pr-1">
                    <Link
                      href={`/catalog/${(catalogMenuTree[hovered] || catalogMenuTree[0]).handle}`}
                      onClick={closeCatalogAfterNavigation}
                      className="font-display text-base font-bold text-slate-900 transition hover:text-brand-700"
                    >
                      {catalogCategoryName((catalogMenuTree[hovered] || catalogMenuTree[0]).handle, (catalogMenuTree[hovered] || catalogMenuTree[0]).name, lang)}
                    </Link>
                    {(catalogMenuTree[hovered] || catalogMenuTree[0]).children.length > 0 ? (
                      // Подкатегория = жирный заголовок-ссылка, под ней — категории 3-го уровня.
                      <div className="mt-4 gap-x-6 [column-fill:balance] sm:columns-2 lg:columns-3">
                        {(catalogMenuTree[hovered] || catalogMenuTree[0]).children.map((s) => (
                          <div key={s.id} className="mb-4 break-inside-avoid">
                            <Link
                              href={`/catalog/${s.handle}`}
                              onClick={closeCatalogAfterNavigation}
                              className="block text-sm font-semibold text-slate-900 transition hover:text-brand-700"
                            >
                              {catalogCategoryName(s.handle, s.name, lang)}
                            </Link>
                            {s.children.length > 0 && (
                              <ul className="mt-1.5 space-y-1">
                                {s.children.map((g) => (
                                  <li key={g.id}>
                                    <Link
                                      href={`/catalog/${g.handle}`}
                                      onClick={closeCatalogAfterNavigation}
                                      className="block truncate text-[13px] text-slate-500 transition hover:text-brand-700"
                                    >
                                      {catalogCategoryName(g.handle, g.name, lang)}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-400">{t("category.goToNamed", { name: catalogCategoryName((catalogMenuTree[hovered] || catalogMenuTree[0]).handle, (catalogMenuTree[hovered] || catalogMenuTree[0]).name, lang) })}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {catalogMenuCategories.map((cat) => (
                    <Link key={cat.slug} href={`/catalog/${cat.slug}`} onClick={closeCatalogAfterNavigation} className="flex items-center gap-3 rounded-xl p-3 transition hover:bg-slate-50">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}>
                        <CategoryIcon name={cat.icon} className="h-5 w-5 text-slate-700" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-slate-800">{catalogCategoryName(cat.slug, cat.name, lang)}</span>
                        {cat.count > 0 && <span className="text-xs text-slate-400">{cat.count} {plural(cat.count)}</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Mobile menu ── */}
      {mobileOpen && !compactOrderFlow && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[200] xl:hidden">
          <button type="button" className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} aria-label={t("a11y.closeMenu")} />
          <div id="mobile-site-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-site-menu-title" className="fixed inset-y-0 left-0 flex h-dvh w-[min(92vw,390px)] max-w-full flex-col overflow-hidden bg-white shadow-2xl [padding-top:env(safe-area-inset-top)]">
            <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-2.5">
              <Logo className="max-w-[210px]" />
              <button ref={mobileCloseRef} onClick={() => setMobileOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:border-brand-200 focus-visible:bg-brand-50 focus-visible:text-brand-700 focus-visible:outline-none" aria-label={t("a11y.closeMenu")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="catalog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
              <section aria-labelledby="mobile-personal-title">
                <p id="mobile-personal-title" className="text-sm font-bold text-slate-900">{t("common.personal")}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Link href="/favorites" onClick={closeMobileAfterNavigation} className="relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 px-1 text-[11px] font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700">
                    <span className="relative shrink-0"><Heart className="h-5 w-5" />{favCount > 0 && <span className={badge}>{favCount}</span>}</span>
                    <span className="max-w-full truncate">{t("act.favorites")}</span>
                  </Link>
                  <button onClick={() => { setMobileOpen(false); openBonus(); }} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 px-1 text-[11px] font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700">
                    <Coins className="h-5 w-5" /> {t("header.bonus")}
                  </button>
                  {user ? (
                    <Link href="/account" onClick={closeMobileAfterNavigation} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-brand-600 px-1 text-[11px] font-semibold text-white transition hover:bg-brand-700">
                      <User className="h-5 w-5 shrink-0" /> <span className="max-w-full truncate">{t("act.account")}</span>
                    </Link>
                  ) : (
                    <button onClick={() => { setMobileOpen(false); openLogin(); }} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-brand-600 px-1 text-[11px] font-semibold text-white transition hover:bg-brand-700">
                      <User className="h-5 w-5 shrink-0" /> <span>{t("act.login")}</span>
                    </button>
                  )}
                </div>
              </section>

              <section className="mt-5" aria-labelledby="mobile-language-title">
                <p id="mobile-language-title" className="text-sm font-bold text-slate-900">{t("drawer.lang")}</p>
                <div className="mt-2 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
                  {langs.map((l) => (
                    <button key={l.code} onClick={() => setLang(l.code)} className={cn("min-h-10 rounded-lg px-3 text-xs font-bold transition", lang === l.code ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800")} aria-pressed={lang === l.code}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </section>

              <div className="mt-5 flex items-start justify-between gap-4 border-t border-slate-100 pt-5">
                <div>
                  <h2 id="mobile-site-menu-title" className="font-display text-2xl font-extrabold tracking-tight text-slate-950">{t("nav.catalog")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("common.healthCatalog")}</p>
                </div>
                <div className="min-w-0 max-w-[145px] shrink-0"><CitySelector full /></div>
              </div>

              <SearchBar className="mt-4" onNavigate={closeMobileAfterNavigation} placeholder={t("common.searchCatalog")} />

              {popularMobileCategories.length > 0 && (
                <section className="mt-5" aria-labelledby="mobile-popular-title">
                  <p id="mobile-popular-title" className="text-sm font-bold text-slate-900">{t("common.popular")}</p>
                  <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                    {popularMobileCategories.map((cat) => (
                      <Link key={cat.slug} href={`/catalog/${cat.slug}`} onClick={closeMobileAfterNavigation} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-50 px-2.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-100">
                        <CategoryIcon name={cat.icon} className="h-4 w-4" />
                        {catalogCategoryName(cat.slug, cat.name, lang)}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-5" aria-labelledby="mobile-categories-title">
                <p id="mobile-categories-title" className="text-sm font-bold text-slate-900">{t("drawer.categories")}</p>
                <nav className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {visibleMobileCategories.map((cat) => (
                    <Link key={cat.slug} href={`/catalog/${cat.slug}`} onClick={closeMobileAfterNavigation} className="group flex min-h-[62px] min-w-0 items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 text-slate-800 transition last:border-b-0 hover:bg-brand-50/60">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-100">
                        <CategoryIcon name={cat.icon} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold leading-tight">{catalogCategoryName(cat.slug, cat.name, lang)}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{mobileCategoryDescription(cat.slug, t)}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-brand-600" />
                    </Link>
                  ))}
                </nav>
                <Link href="/catalog" onClick={closeMobileAfterNavigation} className="mt-2 flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50">
                  <LayoutGrid className="h-5 w-5" />
                  <span className="flex-1">{t("common.openFullCatalog")}</span>
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </section>

              <section className="mt-5" aria-labelledby="mobile-sections-title">
                <p id="mobile-sections-title" className="text-sm font-bold text-slate-900">{t("drawer.sections")}</p>
                <nav className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {sections.map((n) => {
                    const Icon = n.icon;
                    return (
                      <Link key={n.key} href={n.href} onClick={closeMobileAfterNavigation} className="flex min-h-12 items-center gap-3 border-b border-slate-100 px-3.5 text-sm font-semibold text-slate-700 transition last:border-b-0 hover:bg-slate-50 hover:text-brand-800">
                        <Icon className="h-[18px] w-[18px] shrink-0 text-brand-600" />
                        <span className="flex-1">{t(n.key)}</span>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </Link>
                    );
                  })}
                </nav>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}
