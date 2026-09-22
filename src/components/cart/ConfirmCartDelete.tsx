"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

type ConfirmCartDeleteProps = {
  onConfirm: () => void;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  trigger?: "icon" | "text";
  iconSize?: "sm" | "md";
};

export function ConfirmCartDelete({
  onConfirm,
  label,
  confirmLabel,
  cancelLabel,
  trigger = "icon",
  iconSize = "md",
}: ConfirmCartDeleteProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const confirm = () => {
    setConfirming(false);
    onConfirm();
  };

  if (trigger === "text") {
    return confirming ? (
      <span role="group" aria-label={label} className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={confirm}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
        >
          {confirmLabel}
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-slate-500 transition hover:text-red-600"
      >
        {label}
      </button>
    );
  }

  const dimensions = iconSize === "sm" ? "h-8 w-8" : "h-9 w-9";
  const icon = iconSize === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setConfirming((value) => !value)}
        aria-label={label}
        aria-expanded={confirming}
        className={`grid ${dimensions} place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-red-600`}
      >
        <Trash2 className={icon} />
      </button>
      {confirming && (
        <span role="group" aria-label={label} className="absolute right-0 top-full z-20 mt-1 flex min-w-max gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">{cancelLabel}</button>
          <button type="button" onClick={confirm} className="rounded-lg bg-red-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-red-700">{confirmLabel}</button>
        </span>
      )}
    </span>
  );
}
