"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/LanguageContext";
import { correctedSearchQuery, hasUncertainSearchMatch, type SearchFeedbackMeta } from "./search-feedback";

export function SearchFeedback({
  metadata,
  originalHref,
  relaxedHref,
  exact = false,
  compact = false,
  onNavigate,
}: {
  metadata: SearchFeedbackMeta | null;
  originalHref: string;
  relaxedHref?: string;
  exact?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLang();
  const corrected = correctedSearchQuery(metadata);
  const similar = !exact && hasUncertainSearchMatch(metadata);
  if (!metadata?.degraded && !corrected && !similar && !exact) return null;

  return (
    <div className={compact ? "border-b border-slate-100 px-3 py-2.5 text-xs text-slate-600" : "mt-3 rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm text-slate-600"} role="status">
      {metadata?.degraded && <p>{t("search.degraded")}</p>}
      {exact ? (
        <p>{t("search.exactMode")}</p>
      ) : corrected ? (
        <p>{t("search.corrected")} <strong className="font-semibold text-slate-900">«{corrected}»</strong></p>
      ) : similar ? (
        <p>{t("search.similar")}</p>
      ) : null}
      {(corrected || similar || (exact && relaxedHref)) && (
        <Link
          href={exact && relaxedHref ? relaxedHref : originalHref}
          onClick={onNavigate}
          className="mt-1 inline-flex min-h-9 items-center font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-700 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-brand-700"
        >
          {exact ? t("search.enableTypos") : t("search.original")}
        </Link>
      )}
    </div>
  );
}
