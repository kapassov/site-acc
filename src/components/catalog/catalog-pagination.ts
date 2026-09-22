import type { Product } from "@/lib/types";

type CatalogPageProgress = {
  freshProducts: Product[];
  nextOffset: number;
  hasMore: boolean;
};

export type CatalogPaginationItem = number | `ellipsis-${number}-${number}`;

/** Small stable window for catalogues with hundreds of pages. */
export function catalogPaginationItems(currentPage: number, totalPages: number): CatalogPaginationItem[] {
  const total = Math.max(0, Math.trunc(totalPages));
  if (total <= 1) return total === 1 ? [1] : [];
  const current = Math.min(total, Math.max(1, Math.trunc(currentPage)));
  const visible = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => visible.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => visible.add(page));
  const pages = [...visible].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const result: CatalogPaginationItem[] = [];
  for (const page of pages) {
    const previous = result.at(-1);
    const previousPage = typeof previous === "number" ? previous : undefined;
    if (previousPage != null && page - previousPage > 1) result.push(`ellipsis-${previousPage}-${page}`);
    result.push(page);
  }
  return result;
}

/**
 * Daribar can repeat products at page boundaries. A repeated or empty page must
 * stop infinite scroll instead of continuously requesting the remaining total.
 */
export function catalogPageProgress(
  existing: Product[],
  incoming: Product[],
  previousOffset: number,
  proposedNextOffset: number,
  providerHasMore: boolean,
): CatalogPageProgress {
  const seen = new Set(existing.map((product) => product.id || product.slug));
  const freshProducts = incoming.filter((product) => {
    const key = product.id || product.slug;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const offsetAdvanced = Number.isSafeInteger(proposedNextOffset) && proposedNextOffset > previousOffset;

  return {
    freshProducts,
    nextOffset: offsetAdvanced ? proposedNextOffset : previousOffset,
    hasMore: providerHasMore && offsetAdvanced && freshProducts.length > 0,
  };
}
