import type { ProductSearchMetadata } from "@/lib/search/search-metadata";

type SearchMatchType = ProductSearchMetadata["matchType"];
export type SearchFeedbackMeta = ProductSearchMetadata;

const MATCH_TYPES: SearchMatchType[] = ["exact", "typo", "layout", "transliteration", "alias", "none"];

/** Only display correction details supplied for this query, never infer a drug from the first card. */
export function readSearchFeedback(value: unknown, query: string): SearchFeedbackMeta | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SearchFeedbackMeta>;
  if (typeof candidate.query !== "string" || candidate.query.trim().toLocaleLowerCase("ru") !== query.trim().toLocaleLowerCase("ru")) return null;
  if (!MATCH_TYPES.includes(candidate.matchType as SearchMatchType)) return null;
  if (candidate.matchedQuery !== null && typeof candidate.matchedQuery !== "string") return null;
  if (typeof candidate.degraded !== "boolean") return null;
  return {
    query: candidate.query,
    matchedQuery: candidate.matchedQuery?.trim() || null,
    matchType: candidate.matchType as SearchMatchType,
    degraded: candidate.degraded,
  };
}

export function correctedSearchQuery(metadata: SearchFeedbackMeta | null): string | null {
  if (!metadata || metadata.degraded || metadata.matchType === "exact" || metadata.matchType === "none") return null;
  const corrected = metadata.matchedQuery?.trim();
  if (!corrected || corrected.toLocaleLowerCase("ru") === metadata.query.trim().toLocaleLowerCase("ru")) return null;
  return corrected;
}

/** An alias or transliteration can also be ambiguous: no canonical label means no asserted correction. */
export function hasUncertainSearchMatch(metadata: SearchFeedbackMeta | null): boolean {
  return Boolean(metadata && !metadata.degraded && metadata.matchType !== "exact" && metadata.matchType !== "none"
    && !correctedSearchQuery(metadata));
}

export function searchResultsHref(query: string, options: { city?: string; pharmacies?: string[]; exact?: boolean } = {}): string {
  const params = new URLSearchParams({ q: query.trim() });
  if (options.city) params.set("city", options.city);
  for (const pharmacy of options.pharmacies ?? []) params.append("pharmacy", pharmacy);
  if (options.exact) params.set("exact", "1");
  return `/search?${params.toString()}`;
}
