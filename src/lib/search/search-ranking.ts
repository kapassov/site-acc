import type { Product } from "../types.ts";
import {
  createProductSearchDocument,
  matchesProductSearchConstraints,
  normalizeProductSearchText,
  parseProductSearchQuery,
  type ParsedProductSearchQuery,
  type ProductSearchDocument,
} from "./product-search-model.ts";

type SearchVariant = ParsedProductSearchQuery["variants"][number];
type SourceName = {
  name: string;
  normalized: string;
  words: string[];
  document?: ProductSearchDocument;
};

// Catalog snapshots reuse Product identities. Do not repeatedly build spelling variants for
// every pack on every keystroke; invalidate the cache if a caller changes its source title.
const sourceNames = new WeakMap<Product, SourceName>();

function sourceName(product: Product): SourceName {
  const cached = sourceNames.get(product);
  if (cached?.name === product.name) return cached;
  const parsed = parseProductSearchQuery(product.name);
  const value = {
    name: product.name,
    normalized: parsed.normalized,
    words: parsed.nameQuery.split(/\s+/u).filter(Boolean),
  };
  sourceNames.set(product, value);
  return value;
}

function validConstraints(product: Product, parsed: ParsedProductSearchQuery): boolean {
  if (!parsed.numbers.length && !parsed.forms.length) return true;
  const source = sourceName(product);
  source.document ??= createProductSearchDocument(product);
  return matchesProductSearchConstraints(source.document, parsed);
}

/**
 * Bounded surface Damerau-Levenshtein distance. This does not retrieve or invent candidates:
 * it checks Typesense hits against the spelling actually supplied by Daribar. In particular,
 * Cyrillic soft signs remain letters even when a search engine's locale tokenizer drops them.
 */
export function boundedProductNameDistance(left: string, right: string, max = 2): number {
  const bound = Math.min(2, Math.max(0, Math.trunc(max)));
  const over = bound + 1;
  if (left === right) return 0;
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > bound || a.length > 80 || b.length > 80) return over;
  if (!a.length || !b.length) return Math.min(over, Math.max(a.length, b.length));
  let previousPrevious: number[] | undefined;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = row;
    let minimum = row;
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && previousPrevious
        && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        current[column] = Math.min(current[column], previousPrevious[column - 2] + 1);
      }
      minimum = Math.min(minimum, current[column]);
    }
    if (minimum > bound) return over;
    previousPrevious = previous;
    previous = current;
  }
  return Math.min(over, previous[b.length]);
}

function allowedTypos(word: string, requested: 0 | 1 | 2): number {
  if (requested === 0 || /\d/u.test(word) || [...word].length < 5) return 0;
  return Math.min(requested, [...word].length < 9 ? 1 : 2);
}

function exactPrefix(word: string, needle: string, enabled: boolean): boolean {
  return enabled && needle.length >= 2 && !/\d/u.test(needle) && word.startsWith(needle);
}

/**
 * Defense after source-only Typesense passes: all query terms must survive literal source
 * spelling checks. A ranker/locale stemmer cannot remove a word, number or prescribed form.
 * Only an exact last-word prefix is allowed; fuzzy prefix expansion is deliberately absent.
 */
export function matchesSourceSearchName(
  product: Product,
  nameQuery: string,
  typos: 0 | 1 | 2,
  prefix = true,
): boolean {
  const parsed = parseProductSearchQuery(nameQuery);
  if (!validConstraints(product, parsed)) return false;
  const needles = parsed.nameQuery.split(/\s+/u).filter(Boolean);
  const words = sourceName(product).words;
  return needles.every((needle, index) => {
    const bound = allowedTypos(needle, typos);
    const lastPrefix = prefix && index === needles.length - 1;
    if (words.some((word) => word === needle
      || exactPrefix(word, needle, lastPrefix)
      || (bound > 0 && boundedProductNameDistance(word, needle, bound) <= bound))) return true;
    // Exact removal of a separator is harmless (но-шпа -> ношпа); never fuzzy-join words.
    return words.some((word, position) => position + 1 < words.length && `${word}${words[position + 1]}` === needle);
  });
}

function letterChanges(left: string, right: string): number {
  const counts = new Map<string, number>();
  for (const letter of left) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  for (const letter of right) counts.set(letter, (counts.get(letter) ?? 0) - 1);
  return [...counts.values()].reduce((sum, count) => sum + Math.abs(count), 0);
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference) return difference;
  }
  return 0;
}

type NameEvidence = { tier: number; distance: number; changedLetters: number; positions: number[] };

function nameEvidence(words: string[], needles: string[]): NameEvidence {
  let allExact = true;
  let allLiteral = true;
  let distance = 0;
  let changedLetters = 0;
  const positions: number[] = [];
  for (let index = 0; index < needles.length; index += 1) {
    const needle = needles[index];
    let best = [4, 3, 1_000, words.length];
    words.forEach((word, position) => {
      const exact = word === needle;
      const prefix = exactPrefix(word, needle, index === needles.length - 1);
      const edits = exact || prefix ? 0 : boundedProductNameDistance(word, needle);
      const next = [exact ? 0 : prefix ? 1 : 2, edits, exact || prefix ? 0 : letterChanges(word, needle), position];
      if (compare(next, best) < 0) best = next;
    });
    allExact &&= best[0] === 0;
    allLiteral &&= best[0] <= 1;
    distance += best[1];
    changedLetters += best[2];
    positions.push(best[3]);
  }
  const samePhrase = words.length === needles.length && words.every((word, index) => word === needles[index]);
  return {
    tier: samePhrase ? 0 : allExact ? 1 : allLiteral ? 2 : 3,
    distance,
    changedLetters,
    positions,
  };
}

function scriptMismatch(words: string[], needles: string[], positions: number[]): number {
  return needles.reduce((sum, needle, index) => {
    const word = words[positions[index]] ?? "";
    return sum + Number((/[а-я]/u.test(needle) && /[a-z]/u.test(word))
      || (/[a-z]/u.test(needle) && /[а-я]/u.test(word)));
  }, 0);
}

/**
 * Reorders only already-retrieved source products. No popularity/medical assumptions, custom
 * query exceptions or invented aliases are used. A transposition has the
 * same edit distance as a substitution but preserves letters: this is a soft ranking signal,
 * never grounds for hiding the other medicine or announcing a single confident corrected name.
 * Daribar availability is only a final tie-break after all source name relevance signals.
 */
export function rankProductSearchCandidates<T extends Product>(
  products: readonly T[],
  query: string | ParsedProductSearchQuery,
  variant?: SearchVariant,
): T[] {
  const parsed = typeof query === "string" ? parseProductSearchQuery(query) : query;
  const originalWords = parsed.nameQuery.split(/\s+/u).filter(Boolean);
  const needles = normalizeProductSearchText(variant?.value ?? parsed.nameQuery).split(/\s+/u).filter(Boolean);
  const eligible = products.filter((product) => validConstraints(product, parsed));
  if (!needles.length || eligible.length < 2) return [...eligible];
  const ranked = eligible.map((product, index) => {
    const source = sourceName(product);
    const original = nameEvidence(source.words, originalWords);
    const evidence = nameEvidence(source.words, needles);
    const exactOriginal = original.tier <= 1;
    const unrequestedCombination = needles.length < 2 && !parsed.original.includes("+")
      && /[\p{L}]{4,}\s*[+/]\s*[\p{L}]{4,}/u.test(source.normalized);
    const matchedPositions = new Set(evidence.positions.filter((position) => position < source.words.length));
    const score = [
      exactOriginal ? 0 : 1,
      evidence.tier,
      evidence.distance,
      evidence.changedLetters,
      Number(unrequestedCombination),
      scriptMismatch(source.words, needles, evidence.positions),
      Math.min(...evidence.positions),
      Math.max(0, source.words.length - matchedPositions.size),
      product.inStock && !product.priceTBD && Number.isFinite(product.price) && product.price > 0 ? 0 : 1,
    ];
    const firstMatched = evidence.distance <= 2 ? Math.min(...evidence.positions) : 0;
    // This is a grouping key from the source title, not a suggested replacement for the query.
    const family = source.words.slice(firstMatched, firstMatched + Math.max(1, needles.length)).join(" ") || source.normalized;
    return { product, index, score, family, exactOriginal };
  }).sort((left, right) => compare(left.score, right.score) || left.index - right.index);

  // With an ambiguous typo, the first screen should not contain 20 packs of one candidate and
  // conceal the second valid name. Keep one of up to three source families, then all other packs.
  // A literal medication name is never diversified with less relevant medicine families.
  if (ranked.some((entry) => entry.exactOriginal)) return ranked.map((entry) => entry.product);
  const head: typeof ranked = [];
  const families = new Set<string>();
  for (const entry of ranked) {
    if (families.has(entry.family)) continue;
    families.add(entry.family);
    head.push(entry);
    if (head.length === 3) break;
  }
  const selected = new Set(head.map((entry) => entry.index));
  return [...head, ...ranked.filter((entry) => !selected.has(entry.index))].map((entry) => entry.product);
}
