"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/LanguageContext";

export function Logo({ light = false, className }: { light?: boolean; className?: string }) {
  const { t } = useLang();
  const green = light ? "#37c653" : "#1fa23a";
  const red = light ? "#ff7a70" : "#e53935";

  return (
    <Link
      href="/"
      aria-label={t("a11y.brandHome")}
      className={cn("inline-flex min-w-0 max-w-[232px] items-center leading-none sm:max-w-[220px] lg:max-w-none", className)}
      style={{ fontFamily: "var(--font-manrope), 'Arial Black', sans-serif" }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 flex-col items-start gap-px">
          <span className="text-[9px] font-black leading-none tracking-[0.02em] sm:text-[11px] lg:text-[13px]" style={{ color: green }}>DARIHANA</span>
          <span className="text-[9px] font-black leading-none tracking-[0.30em] sm:text-[11px] lg:text-[13px]" style={{ color: green }}>АПТЕКА</span>
        </span>
        <span className="truncate text-[21px] font-black leading-none tracking-[0.01em] sm:text-[24px] lg:text-[30px]">
          <span style={{ color: red }}>СО</span><span style={{ color: green }}>&nbsp;СКЛАДА</span>
        </span>
      </span>
    </Link>
  );
}
