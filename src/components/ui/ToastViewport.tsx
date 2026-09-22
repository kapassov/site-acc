"use client";

import { Check } from "lucide-react";
import { useToast } from "@/lib/ui/ToastContext";

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex min-h-12 max-w-full items-center gap-3 rounded-2xl bg-slate-900 py-2.5 pl-3 pr-3 text-sm font-semibold text-white shadow-pop"
          style={{ animation: "toast-in 0.25s cubic-bezier(.22,1,.36,1)" }}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500"><Check className="h-3.5 w-3.5 text-white" /></span>
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="min-h-9 shrink-0 rounded-xl bg-white/12 px-3 font-bold text-brand-200 transition hover:bg-white/20 hover:text-white"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
