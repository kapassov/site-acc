"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, Mail, Clock, Camera, Send, Apple, Play, ArrowRight, ChevronDown } from "lucide-react";
import { Logo } from "./Logo";
import { useLang } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/lib/ui/ToastContext";
import { usePush } from "@/components/push/PushProvider";
import { formatStaticCopy, staticPagesCopy } from "@/lib/i18n/static-pages";
import type { CatNode } from "@/lib/types";
import { medusaDirectory } from "@/lib/medusa-directory";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { catalogCategoryName } from "@/lib/i18n/catalog-categories";

export function Footer() {
  const pathname = usePathname();
  const compactOrderFlow = pathname.startsWith("/cart") || pathname.startsWith("/checkout") || pathname.startsWith("/payment");
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  const { push } = useToast();
  const { sendEvent } = usePush();
  const [categoryTree, setCategoryTree] = useState<CatNode[]>([]);
  const categoryGroups = useMemo(() => medusaDirectory(categoryTree), [categoryTree]);

  useEffect(() => {
    if (compactOrderFlow) return;
    const controller = new AbortController();
    fetch("/api/category-tree", { cache: "default", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("category_tree_failed")))
      .then((value: unknown) => {
        if (Array.isArray(value)) setCategoryTree(value as CatNode[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [compactOrderFlow]);

  const columns: { title: string; links: { label: string; href: string }[] }[] = [
    { title: t("f.col.buyers"), links: [
      { label: t("f.buyers.1"), href: "/delivery" },
      { label: t("f.buyers.2"), href: "/help" },
      { label: t("f.buyers.3"), href: "/account/bonuses" },
      { label: t("f.buyers.4"), href: "/help" },
      { label: t("f.buyers.5"), href: "/help" },
    ] },
    { title: t("f.col.company"), links: [
      { label: t("f.company.1"), href: "/about" },
      { label: t("f.company.2"), href: "/brands" },
      { label: t("f.company.3"), href: "/about" },
      { label: t("f.company.4"), href: "/pharmacies" },
      { label: t("f.company.5"), href: "/about" },
    ] },
  ];

  return (
    <footer className={`${compactOrderFlow ? "hidden" : ""} mt-20 bg-slate-900 text-slate-300`}>
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        {categoryGroups.length > 0 && (
          <section className="mb-12 border-b border-white/10 pb-10" aria-labelledby="footer-catalog-title">
            <div className="flex items-center justify-between gap-5">
              <h2 id="footer-catalog-title" className="font-display text-xl font-bold text-white sm:text-2xl">{t("f.col.catalog")}</h2>
              <Link href="/catalog" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-300 transition hover:text-white">
                {t("home.directory.all")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <nav className="mt-5" aria-label={t("f.col.catalog")}>
              <div className="divide-y divide-white/10 md:hidden">
                {categoryGroups.map((group) => (
                  <details key={group.id} className="group/footer-category">
                    <summary className="flex min-h-14 list-none items-center gap-3 py-2 text-left marker:content-none [&::-webkit-details-marker]:hidden">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-brand-300">
                        <CategoryIcon name={group.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 font-semibold text-white">{catalogCategoryName(group.handle, group.name, lang)}</span>
                      <ChevronDown className="h-4 w-4 text-slate-500 transition group-open/footer-category:rotate-180" aria-hidden="true" />
                    </summary>
                    <ul className="pb-3 pl-12">
                      <li><Link href={`/catalog/${group.handle}`} className="inline-flex min-h-10 items-center font-semibold text-brand-300">{t("home.directory.groupAll")}</Link></li>
                      {group.children.map((child) => (
                        <li key={child.id}><Link href={`/catalog/${child.handle}`} className="inline-flex min-h-10 items-center text-sm text-slate-400 transition hover:text-white">{catalogCategoryName(child.handle, child.name, lang)}</Link></li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>

              <div className="hidden gap-x-7 gap-y-8 md:grid md:grid-cols-3 lg:grid-cols-5">
                {categoryGroups.map((group) => (
                  <section key={group.id}>
                    <Link href={`/catalog/${group.handle}`} className="flex min-h-11 items-center gap-2 font-semibold text-white transition hover:text-brand-300">
                      <CategoryIcon name={group.icon} className="h-4 w-4 shrink-0 text-brand-300" />
                      <span>{catalogCategoryName(group.handle, group.name, lang)}</span>
                    </Link>
                    <ul className="mt-2 space-y-1">
                      {group.children.map((child) => (
                        <li key={child.id}><Link href={`/catalog/${child.handle}`} className="inline-flex min-h-8 items-center text-sm leading-5 text-slate-400 transition hover:text-white">{catalogCategoryName(child.handle, child.name, lang)}</Link></li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </nav>
          </section>
        )}

        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-2">
            <Logo light />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">{t("f.tagline")}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <StoreBadge icon={<Apple className="h-5 w-5" />} top={t("store.top.app")} bottom="App Store" onClick={() => { void sendEvent("app.download_interest", { store: "app-store", placement: "footer" }); push(formatStaticCopy(copy["toast.appSoon"], { store: "App Store" })); }} />
              <StoreBadge icon={<Play className="h-5 w-5" />} top={t("store.top.gp")} bottom="Google Play" onClick={() => { void sendEvent("app.download_interest", { store: "google-play", placement: "footer" }); push(formatStaticCopy(copy["toast.appSoon"], { store: "Google Play" })); }} />
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white">{col.title}</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-slate-400 transition hover:text-brand-300">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-6 border-t border-white/10 pt-8 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <a href="tel:+77000000000" className="flex items-center gap-2 font-semibold text-white">
              <Phone className="h-4 w-4 text-brand-400" /> +7 700 000 00 00
            </a>
            <p className="flex items-center gap-2 text-slate-400">
              <Mail className="h-4 w-4 text-brand-400" /> support@inkar.kz
            </p>
            <p className="flex items-center gap-2 text-slate-400">
              <Clock className="h-4 w-4 text-brand-400" /> {t("f.hours")}
            </p>
          </div>
          <div className="flex items-start gap-3 md:justify-end">
            <SocialIcon onClick={() => push(formatStaticCopy(copy["toast.socialSoon"], { network: "Instagram" }))}><Camera className="h-5 w-5" /></SocialIcon>
            <SocialIcon onClick={() => push(formatStaticCopy(copy["toast.socialSoon"], { network: "Telegram" }))}><Send className="h-5 w-5" /></SocialIcon>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("f.copy")}</p>
          <div className="flex items-center gap-2">
            <PayChip>
              <svg viewBox="0 8.1 24 7.8" className="h-3" role="img" aria-label="Visa">
                <path fill="#1434CB" d="M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z" />
              </svg>
            </PayChip>
            <PayChip>
              <svg viewBox="0 0 48 30" className="h-5" role="img" aria-label="Mastercard">
                <circle cx="19" cy="15" r="10" fill="#EB001B" />
                <circle cx="29" cy="15" r="10" fill="#F79E1B" />
                <path d="M24 7.5a10 10 0 0 0 0 15 10 10 0 0 0 0-15z" fill="#FF5F00" />
              </svg>
            </PayChip>
          </div>
        </div>
      </div>
    </footer>
  );
}

function StoreBadge({ icon, top, bottom, onClick }: { icon: React.ReactNode; top: string; bottom: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-xl border border-white/15 px-3.5 py-2 text-left transition hover:border-white/40">
      <span className="text-white">{icon}</span>
      <span className="leading-tight">
        <span className="block text-[10px] text-slate-400">{top}</span>
        <span className="block text-sm font-semibold text-white">{bottom}</span>
      </span>
    </button>
  );
}

function SocialIcon({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid h-10 w-10 place-items-center rounded-full bg-white/5 text-slate-300 transition hover:bg-brand-600 hover:text-white">
      {children}
    </button>
  );
}

/** Белый чип под реальный логотип платёжной системы (на тёмном футере). */
function PayChip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-7 items-center justify-center rounded-md bg-white px-2.5">{children}</span>;
}
