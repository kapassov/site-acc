"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LayoutGrid, MapPin, ShoppingCart, UserRound } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/cn";
import { staticPagesCopy } from "@/lib/i18n/static-pages";

const catalogPrefixes = ["/catalog", "/product", "/search", "/brands"];
const hiddenPrefixes = ["/cart", "/checkout", "/payment", "/admin", "/ai"];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { count } = useCart();
  const { user, openLogin } = useAuth();
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];

  if (hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;

  const items = [
    { href: "/", label: t("common.home"), icon: House, active: pathname === "/" },
    {
      href: "/catalog",
      label: t("nav.catalog"),
      icon: LayoutGrid,
      active: catalogPrefixes.some((prefix) => pathname.startsWith(prefix)),
    },
    { href: "/pharmacies", label: t("nav.pharmacies"), icon: MapPin, active: pathname.startsWith("/pharmacies") },
    { href: "/cart", label: t("act.cart"), icon: ShoppingCart, active: pathname.startsWith("/cart"), badge: count },
  ];

  const itemClass = (active: boolean) => cn(
    "relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 pb-1 pt-1.5 text-[10px] font-medium leading-none transition-colors focus-visible:bg-brand-50/80 focus-visible:outline-none",
    active ? "text-brand-700" : "text-slate-500 hover:text-slate-800",
  );

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.25rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={copy["nav.main"]}
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200/90 bg-white/95 shadow-[0_-10px_28px_-22px_rgba(15,23,42,.5)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto grid h-[calc(4.25rem+env(safe-area-inset-bottom))] max-w-lg grid-cols-5 px-1 [padding-bottom:env(safe-area-inset-bottom)]">
          {items.map(({ href, label, icon: Icon, active, badge }) => (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              <span className={cn("absolute top-0 h-0.5 w-6 rounded-full bg-brand-600 transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              <span className="relative grid h-7 w-8 place-items-center">
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.8} />
                {badge ? (
                  <span className="absolute -right-1 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          ))}

          {user ? (
            <Link href="/account" aria-current={pathname.startsWith("/account") ? "page" : undefined} className={itemClass(pathname.startsWith("/account"))}>
              <span className={cn("absolute top-0 h-0.5 w-6 rounded-full bg-brand-600 transition-opacity", pathname.startsWith("/account") ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              <span className="grid h-7 w-8 place-items-center"><UserRound className="h-[22px] w-[22px]" strokeWidth={pathname.startsWith("/account") ? 2.25 : 1.8} /></span>
              <span className="max-w-full truncate">{t("acc.profile")}</span>
            </Link>
          ) : (
            <button type="button" onClick={openLogin} className={itemClass(false)} aria-label={t("act.login")}>
              <span className="grid h-7 w-8 place-items-center"><UserRound className="h-[22px] w-[22px]" strokeWidth={1.8} /></span>
              <span className="max-w-full truncate">{t("acc.profile")}</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
