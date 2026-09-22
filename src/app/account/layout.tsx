"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Package, Gift, MapPin, Heart, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { cn } from "@/lib/cn";
import { accountExtraCopy } from "@/lib/i18n/account-extra";

const nav = [
  { href: "/account", key: "acc.nav.overview", icon: User, exact: true },
  { href: "/account/orders", key: "acc.nav.orders", icon: Package, exact: false },
  { href: "/account/bonuses", key: "acc.nav.bonuses", icon: Gift, exact: false },
  { href: "/favorites", key: "acc.nav.favorites", icon: Heart, exact: false },
  { href: "/account/addresses", key: "acc.nav.addresses", icon: MapPin, exact: false },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, openLogin, logout } = useAuth();
  const { lang, t } = useLang();
  const copy = accountExtraCopy[lang];
  const pathname = usePathname();

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600"><User className="h-8 w-8" /></span>
        <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">{t("acc.gateT")}</h1>
        <p className="mt-2 text-slate-500">{t("acc.gateS")}</p>
        <button onClick={openLogin} className="mt-6 inline-flex h-12 items-center rounded-xl bg-brand-600 px-7 font-semibold text-white transition hover:bg-brand-700">
          {t("acc.gateBtn")}
        </button>
      </div>
    );
  }

  const displayName = user.name.trim() || copy.customerFallback;
  const initials = displayName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hasLoyalty = typeof user.bonus === "number" && Boolean(user.level);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Breadcrumbs items={[{ label: t("common.home"), href: "/" }, { label: t("acc.title") }]} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600 font-bold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{displayName}</p>
                <p className="text-sm text-slate-500">{user.phone}</p>
              </div>
            </div>
            {hasLoyalty ? (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm">
                <span className="font-medium text-brand-800">{user.level}</span>
                <span className="font-semibold text-brand-700">{user.bonus!.toLocaleString(copy.locale)} {t("sum.points")}</span>
              </div>
            ) : null}
          </div>

          <nav className="mt-3 space-y-1">
            {nav.map((item) => {
              if (item.href === "/account/bonuses" && !hasLoyalty) return null;
              const Icon = item.icon;
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50")}>
                  <Icon className="h-5 w-5" /> {t(item.key)}
                </Link>
              );
            })}
            <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-accent-600">
              <LogOut className="h-5 w-5" /> {t("acc.logout")}
            </button>
          </nav>
        </aside>

        <div>{children}</div>
      </div>
    </div>
  );
}
