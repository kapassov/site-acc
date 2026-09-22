"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { useContent, type Banner } from "@/lib/content/ContentContext";
import { cmsTr } from "@/lib/content/cmsI18n";
import { useLang } from "@/lib/i18n/LanguageContext";
import { formatStaticCopy, staticPagesCopy } from "@/lib/i18n/static-pages";
import { HeroQuickLinks } from "@/components/home/HeroQuickLinks";

const RESPONSIVE_HERO_ARTWORK: Record<string, { source: string; desktop: string }> = {
  b5: {
    source: "/promo/banner-home-first-aid-products-v2.webp",
    desktop: "/promo/banner-home-first-aid-wide-v3.webp",
  },
  b4: {
    source: "/promo/category-medical-products.webp",
    desktop: "/promo/banner-medical-devices-wide-v3.webp",
  },
  b6: {
    source: "/promo/banner-vitamins-products-v2.webp",
    desktop: "/promo/banner-vitamins-wide-v3.webp",
  },
  "bp-selfielab": {
    source: "/promo/banner-selfielab.webp",
    desktop: "/promo/banner-selfielab-wide-v2.webp",
  },
  "bp-ivatherm": {
    source: "/promo/banner-ivatherm.webp",
    desktop: "/promo/banner-ivatherm-wide-v2.webp",
  },
};

export function Hero() {
  const { content } = useContent();
  const { lang } = useLang();
  const copy = staticPagesCopy[lang];
  const banners = content.banners.filter((b) => b.on).slice(0, 5);
  const n = banners.length;
  const [i, setI] = useState(0);
  const [tick, setTick] = useState(0); // нонс: перезапуск автоплея при ручной навигации
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [userPaused, setUserPaused] = useState(false); // явная пауза кнопкой — для тача (нет hover)
  const paused = hover || focus || userPaused; // WCAG 2.2.2 (Pause, Stop, Hide)

  useEffect(() => {
    if (n <= 1 || paused) return;
    if (typeof navigator !== "undefined" && navigator.userAgent.includes("AptekaSoSkladaAndroid")) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tm = setInterval(() => setI((p) => (p + 1) % n), 6000);
    return () => clearInterval(tm);
  }, [n, tick, paused]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- кламп индекса к последнему валидному слайду
  useEffect(() => { if (i >= n && n > 0) setI(n - 1); }, [i, n]);

  const active = n ? Math.min(i, n - 1) : 0;
  const goto = (next: number) => { setI(((next % n) + n) % n); setTick((t) => t + 1); };

  return (
    <section data-testid="home-hero" className="mx-auto max-w-[1360px] px-4 pt-2.5 sm:px-6 sm:pt-6">
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
        {/* ── Билборд (рекламная карусель) ── */}
        <div className="min-w-0">
          <div
            data-testid="hero-carousel"
            className="grid aspect-[16/9] overflow-hidden rounded-2xl bg-[#edf6f1] ring-1 ring-slate-200/70 sm:h-[360px] sm:aspect-auto sm:rounded-[20px]"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocusCapture={() => setFocus(true)}
            onBlurCapture={() => setFocus(false)}
          >
            {n ? (
              banners.map((b, idx) => (
                <SlideView
                  key={b.id}
                  b={b}
                  active={idx === active}
                  shouldLoad={n <= 3 || idx === active || Math.abs(idx - active) === 1 || Math.abs(idx - active) === n - 1}
                />
              ))
            ) : (
              <div className="col-start-1 row-start-1 h-full w-full bg-emerald-700" />
            )}

          </div>

          {n > 1 && (
            <div className="relative flex h-9 items-center justify-center">
              <button
                onClick={() => setUserPaused((p) => !p)}
                aria-label={userPaused ? copy["hero.play"] : copy["hero.pause"]}
                aria-pressed={userPaused}
                className="absolute left-0 grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {userPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              <div className="flex items-center justify-center gap-2">
                {banners.map((b, idx) => (
                  <button key={b.id} onClick={() => goto(idx)} aria-label={formatStaticCopy(copy["hero.slide"], { current: idx + 1, total: n })} aria-current={idx === active ? "true" : undefined} className={cn("h-2 rounded-full bg-slate-300 transition-all", idx === active ? "w-7 bg-emerald-600" : "w-2 hover:bg-slate-400")} />
                ))}
              </div>
              <div className="absolute right-0 hidden items-center gap-1 sm:flex">
                <button onClick={() => goto(active - 1)} aria-label={copy["hero.previous"]} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => goto(active + 1)} aria-label={copy["hero.next"]} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <HeroQuickLinks />
      </div>
    </section>
  );
}

function SlideView({ b, active, shouldLoad }: { b: Banner; active: boolean; shouldLoad: boolean }) {
  const { lang } = useLang();
  const copy = staticPagesCopy[lang];
  const eyebrow = cmsTr(lang, b.id, "eyebrow", b.eyebrow);
  const title = cmsTr(lang, b.id, "title", b.title);
  const sub = cmsTr(lang, b.id, "sub", b.sub);
  const cta = cmsTr(lang, b.id, "cta", b.cta);
  const [vidFailed, setVidFailed] = useState(false);
  const showVideo = Boolean(b.video) && shouldLoad && !vidFailed;
  const artworkOnly = !eyebrow && !title && !sub && !cta;
  const responsiveArtwork = RESPONSIVE_HERO_ARTWORK[b.id];
  const hasResponsiveArtwork = responsiveArtwork?.source === b.img;
  const desktopArtwork = hasResponsiveArtwork ? responsiveArtwork.desktop : b.img;
  const darkCampaign = b.id === "b4";
  const compactCampaignTitle = b.id === "b5";
  const artworkLabel = b.id === "bp-selfielab"
    ? formatStaticCopy(copy["hero.brandProducts"], { brand: "SelfieLab AHA-BHA-PHA" })
    : b.id === "bp-ivatherm"
      ? formatStaticCopy(copy["hero.brandProducts"], { brand: "Ivatherm" })
      : copy["hero.openOffer"];

  return (
    <div
      className={cn("relative col-start-1 row-start-1 grid h-full w-full overflow-hidden transition-opacity duration-700 ease-[cubic-bezier(.22,1,.36,1)]", active ? "opacity-100" : "pointer-events-none opacity-0")}
      inert={!active}
    >
      <div className="col-start-1 row-start-1 h-full w-full" style={{ backgroundColor: b.from }} />
      {!artworkOnly && b.img && shouldLoad && (
        hasResponsiveArtwork ? (
          <>
            <Image src={b.img} alt="" fill priority={active} sizes="(max-width: 839px) 100vw, 1px" className="col-start-1 row-start-1 h-full w-full object-cover min-[840px]:hidden" />
            <Image src={desktopArtwork} alt="" fill priority={active} sizes="(max-width: 1023px) 100vw, calc(100vw - 408px)" className="col-start-1 row-start-1 hidden h-full w-full object-cover min-[840px]:block" />
          </>
        ) : (
          <Image src={b.img} alt="" fill priority={active} sizes="(max-width: 1023px) 100vw, 952px" className="col-start-1 row-start-1 h-full w-full object-cover" />
        )
      )}
      {/* Брендовые макеты используют отдельные пропорции: 16:9 на телефоне и широкий арт на больших экранах. */}
      {artworkOnly && b.img && (
        <>
          <Image
            src={b.img}
            alt=""
            fill
            priority={active}
            sizes="(max-width: 839px) 100vw, 1px"
            className="col-start-1 row-start-1 h-full w-full object-cover min-[840px]:hidden"
          />
          <Image
            src={desktopArtwork}
            alt=""
            fill
            priority={active}
            sizes="(max-width: 1023px) 100vw, calc(100vw - 408px)"
            className="col-start-1 row-start-1 hidden h-full w-full object-cover min-[840px]:block"
          />
        </>
      )}
      {/* Видео поверх базы; при ошибке загрузки снимаем — остаётся фото/градиент. */}
      {showVideo && (
        <>
          <video
            src={b.video}
            poster={b.img || undefined}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVidFailed(true)}
            className="col-start-1 row-start-1 h-full w-full object-cover"
          />
        </>
      )}

      {!artworkOnly && (
        <div className="relative z-10 col-start-1 row-start-1 flex h-full items-center">
          {darkCampaign && <div className="absolute inset-0 bg-gradient-to-r from-[#032d27]/80 via-[#032d27]/35 to-transparent" />}
          <div className={cn("relative flex max-w-[68%] flex-col items-start px-5 text-left min-[430px]:max-w-[60%] sm:max-w-[54%] sm:px-9 lg:px-12", b.img || showVideo ? "" : "max-w-md")}>
            {eyebrow && <span className={cn("text-[10px] font-bold uppercase tracking-[0.14em] sm:text-xs", darkCampaign ? "text-emerald-200" : "text-emerald-700")}>{eyebrow}</span>}
            <h2 className={cn("mt-1.5 whitespace-pre-line font-display text-[22px] font-extrabold leading-[1.02] tracking-tight sm:mt-2 sm:text-4xl sm:leading-[0.98]", compactCampaignTitle ? "lg:text-[36px]" : "lg:text-[42px]", darkCampaign ? "text-white" : "text-slate-950")}>
              {title}
            </h2>
            {sub && <p className={cn("mt-2 hidden max-w-[17rem] text-[13px] leading-snug min-[430px]:block sm:mt-3 sm:max-w-xs sm:text-[15px]", darkCampaign ? "text-emerald-50/85" : "text-slate-600")}>{sub}</p>}
            {cta && (
              <Link href={b.href || "/catalog"} className={cn("mt-3 inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[10px] font-bold uppercase tracking-wider transition sm:mt-5 sm:h-11 sm:px-6 sm:text-xs", darkCampaign ? "bg-white text-emerald-900 hover:bg-emerald-50" : "bg-emerald-700 text-white hover:bg-emerald-800")}>
                {cta} <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      )}
      {/* Готовый баннер с вшитым текстом: вся плашка — ссылка на бренд. */}
      {artworkOnly && b.href && <Link href={b.href} aria-label={artworkLabel} className="z-20 col-start-1 row-start-1 h-full w-full" />}
    </div>
  );
}
