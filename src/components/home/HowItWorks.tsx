"use client";

import { Stethoscope, Sparkles, ArrowRight } from "lucide-react";
import { useLang } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/cn";
import { staticPagesCopy } from "@/lib/i18n/static-pages";

const steps = [
  { t: "hw.s1.t", d: "hw.s1.d" },
  { t: "hw.s2.t", d: "hw.s2.d" },
  { t: "hw.s3.t", d: "hw.s3.d" },
];

export function HowItWorks() {
  const { lang, t } = useLang();
  const copy = staticPagesCopy[lang];
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="text-center">
        <span className="inline-block rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">{t("hw.eyebrow")}</span>
        <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{t("hw.title")}</h2>
      </div>

      <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-2">
        <div className="relative min-h-[340px] overflow-hidden rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15" />
          <Stethoscope className="absolute left-6 top-6 h-12 w-12 text-white/70" />
          <div className="absolute inset-x-6 bottom-6 rounded-2xl bg-white p-4 shadow-pop">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-white"><Stethoscope className="h-4 w-4" /></span>
              <span className="text-sm font-semibold text-slate-900">Saumi</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{copy["howItWorks.exampleQuery"]}</p>
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-700"><Sparkles className="h-3.5 w-3.5" /> {copy["howItWorks.exampleResult"]}</div>
          </div>
        </div>

        <div className="rounded-3xl bg-brand-50/70 p-6 sm:p-8">
          <ol className="relative space-y-7 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-brand-200 before:content-['']">
            {steps.map((s, i) => (
              <li key={i} className="relative pl-8">
                <span className={cn("absolute left-0 top-1 h-4 w-4 rounded-full ring-4 ring-brand-50", i === 0 ? "bg-lime-400" : "bg-brand-600")} />
                <span className="inline-block rounded bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">{t("hw.step")} {i + 1}</span>
                <h3 className="mt-2 font-display text-lg font-bold text-slate-900">{t(s.t)}</h3>
                <p className="mt-1 text-sm text-slate-500">{t(s.d)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-6 text-center">
        <a
          href="#saumi-input"
          onClick={() => {
            const el = document.getElementById("saumi-input") as HTMLInputElement | null;
            el?.focus({ preventScroll: true });
          }}
          className="inline-flex h-13 items-center gap-2 rounded-full bg-brand-600 px-8 font-semibold text-white transition hover:bg-brand-700"
        >
          {t("hw.cta")} <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}
