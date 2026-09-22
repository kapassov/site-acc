import type { Product } from "./types.ts";

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function normalizeProductName(value: string): string {
  return value
    .replaceAll("№", " ")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    // Medusa identity normalization may format this family as either
    // "ПептидБио" or "Пептид Био". Search must treat both as one name.
    .replace(/пептид\s*био/gu, "пептидбио")
    .replace(/peptide\s*bio/gu, "peptidebio")
    .match(TOKEN_RE)
    ?.join(" ") ?? "";
}

function maxDistance(token: string): number {
  if (/^\d+$/.test(token) || token.length <= 3) return 0;
  if (token.length <= 5) return 1;
  if (token.length <= 9) return 2;
  return 3;
}

/** Damerau-Levenshtein distance with adjacent transpositions. */
export function typoDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const rows = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + substitution,
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

/**
 * Lower is better; null means that the title does not match. Search is
 * intentionally title-only so brand/description metadata cannot create noise.
 */
export function productNameSearchScore(title: string, query: string): number | null {
  const normalizedTitle = normalizeProductName(title);
  const normalizedQuery = normalizeProductName(query);
  if (!normalizedTitle || !normalizedQuery) return null;
  if (normalizedTitle === normalizedQuery) return 0;

  const exactAt = normalizedTitle.indexOf(normalizedQuery);
  if (exactAt >= 0) return 10 + exactAt + Math.max(0, normalizedTitle.length - normalizedQuery.length) / 100;

  const titleTokens = normalizedTitle.split(" ");
  const queryTokens = normalizedQuery.split(" ");
  let distanceTotal = 0;
  for (const queryToken of queryTokens) {
    let best = Number.POSITIVE_INFINITY;
    for (const titleToken of titleTokens) {
      if (Math.abs(titleToken.length - queryToken.length) > maxDistance(queryToken)) continue;
      best = Math.min(best, typoDistance(queryToken, titleToken));
      if (best === 0) break;
    }
    if (best > maxDistance(queryToken)) return null;
    distanceTotal += best;
  }

  return 100 + distanceTotal * 10 + Math.abs(titleTokens.length - queryTokens.length);
}

export function searchProductsByName(products: Product[], query: string, limit = 40): Product[] {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 40));
  return products
    .map((product) => ({ product, score: productNameSearchScore(product.name, query) }))
    .filter((entry): entry is { product: Product; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score
      || left.product.name.localeCompare(right.product.name, "ru", { sensitivity: "base" })
      || left.product.id.localeCompare(right.product.id))
    .slice(0, boundedLimit)
    .map((entry) => entry.product);
}
