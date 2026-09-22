"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";

/** Брендовый экран загрузки: виден при входе на сайт, затем плавно исчезает. */
export function SiteLoader() {
  const [fade, setFade] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFade(true), 950);
    const t2 = setTimeout(() => setGone(true), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-[200] flex flex-col items-center justify-center bg-gradient-to-br from-brand-600 to-brand-800 transition-opacity duration-500",
        fade && "pointer-events-none opacity-0",
      )}
    >
      <span className="grid h-20 w-20 animate-pulse place-items-center rounded-3xl bg-white shadow-pop">
        <svg viewBox="0 0 100 100" className="h-11 w-11 text-brand-600">
          <path d="M35 0 H65 V35 H100 V65 H65 V100 H35 V65 H0 V35 H35 Z" fill="currentColor" />
        </svg>
      </span>
      <p className="mt-6 text-2xl font-extrabold tracking-tight text-white" style={{ fontFamily: "var(--font-montserrat)" }}>
        Аптека со склада
      </p>
      <span className="mt-5 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-white/80" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
    </div>
  );
}
