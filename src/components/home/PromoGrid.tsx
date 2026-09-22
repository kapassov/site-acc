"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";

const promos = [
  { k: "k", href: "/search?q=SelfieLab", from: "#efe6ff", to: "#d7c2ff", img: "/promo/promo-kbeauty-photo.webp", position: "center", overlay: "from-[#eee4ff] via-[#eee4ff]/92 to-[#eee4ff]/10" },
  { k: "m", href: "/search?q=дет", from: "#ffe9f1", to: "#ffccdf", img: "/promo/promo-mom-baby-photo.webp", position: "center", overlay: "from-[#ffe5ee] via-[#ffe5ee]/92 to-[#ffe5ee]/10" },
  { k: "i", href: "/search?q=витамин", from: "#fff1d6", to: "#ffdfa3", img: "/promo/promo-immunity-photo.webp", position: "center", overlay: "from-[#ffedc8] via-[#ffedc8]/92 to-[#ffedc8]/10" },
];

export function PromoGrid() {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="mb-5 max-w-2xl sm:mb-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("home.campaigns.title")}</h2>
        <p className="mt-1.5 text-sm text-slate-500 sm:text-base">{t("home.campaigns.sub")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {promos.map((p) => (
          <Link
            key={p.k}
            href={p.href}
            className="group relative flex min-h-[190px] flex-col justify-between overflow-hidden rounded-2xl p-5 sm:min-h-[210px] sm:rounded-3xl sm:p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-card"
            style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
          >
            <Image
              src={p.img}
              alt=""
              fill
              sizes="(max-width: 767px) 100vw, 33vw"
              className="object-cover transition duration-500 group-hover:scale-[1.03]"
              style={{ objectPosition: p.position }}
            />
            <span className={`absolute inset-0 bg-gradient-to-r ${p.overlay}`} />
            <div className="relative z-10 max-w-[62%]">
              <h3 className="font-display text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{t(`promo.${p.k}.t`)}</h3>
              <p className="mt-2 text-sm text-slate-600">{t(`promo.${p.k}.s`)}</p>
            </div>
            <span className="relative z-10 mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur transition group-hover:bg-brand-600 group-hover:text-white">
              {t(`promo.${p.k}.cta`)} <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
