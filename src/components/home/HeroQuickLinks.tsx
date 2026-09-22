"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useContent } from "@/lib/content/ContentContext";
import { cmsTr } from "@/lib/content/cmsI18n";
import { useLang } from "@/lib/i18n/LanguageContext";
import { staticPagesCopy } from "@/lib/i18n/static-pages";
import { CollectionIcon } from "@/components/ui/CollectionIcon";

const CARD_STYLES: Record<string, { background: string; text: string }> = {
  ql1: { background: "#e8f6ed", text: "#17643d" },
  ql2: { background: "#fff0f2", text: "#8b2944" },
  ql3: { background: "#fff6dc", text: "#755311" },
  ql4: { background: "#e8f5f3", text: "#145f56" },
};

export function HeroQuickLinks() {
  const { content } = useContent();
  const { lang } = useLang();
  const copy = staticPagesCopy[lang];
  const links = content.quickLinks.filter((item) => item.on).slice(0, 4);

  if (!links.length) return null;

  return (
    <nav
      aria-label={copy["quick.aria"]}
      className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:h-[360px] lg:grid-rows-2"
    >
      {links.map((item) => {
        const label = cmsTr(lang, item.id, "label", item.label);
        const cardStyle = CARD_STYLES[item.id] ?? { background: "#eef7f2", text: "#17643d" };

        return (
          <Link
            key={item.id}
            href={item.href}
            className="group relative min-h-[108px] overflow-hidden rounded-2xl border border-slate-200/70 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card sm:min-h-[118px] lg:min-h-0"
            style={{ backgroundColor: cardStyle.background }}
          >
            {item.img ? (
              <Image
                src={item.img}
                alt=""
                fill
                sizes="(max-width: 1023px) 50vw, 174px"
                className="object-cover transition duration-500 ease-out group-hover:scale-[1.025]"
              />
            ) : (
              <span className="absolute right-4 top-4 opacity-40" style={{ color: cardStyle.text }}>
                <CollectionIcon name={item.icon} className="h-10 w-10" />
              </span>
            )}

            <span className="absolute left-3 top-3 z-10 max-w-[46%] text-[11px] font-extrabold uppercase leading-[1.14] tracking-[0.02em] sm:left-4 sm:top-4 sm:text-xs" style={{ color: cardStyle.text }}>
              {label}
            </span>
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow-sm transition group-hover:translate-x-0.5 sm:left-4"
              style={{ color: cardStyle.text }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
