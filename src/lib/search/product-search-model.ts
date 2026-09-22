import type { Product } from "../types.ts";

/** Bump when normalization, alias or constraint semantics require a complete reindex. */
export const PRODUCT_SEARCH_MODEL_VERSION = "2026-08-27.2";

/** A search document is an identity index, never an authority for prices or stock. */
export interface ProductSearchDocument {
  id: string;
  sku: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  numbers: string[];
  forms: string[];
}

export type ProductSearchVariantKind = "original" | "layout" | "transliteration" | "alias";

export interface ParsedProductSearchQuery {
  original: string;
  normalized: string;
  /** Name terms only. Explicit dosage, package and form constraints are separate. */
  nameQuery: string;
  variants: { value: string; kind: ProductSearchVariantKind }[];
  numbers: string[];
  forms: string[];
}

const RU_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const LATIN_TO_RU: Record<string, string> = {
  shch: "щ", sch: "щ", zh: "ж", kh: "х", ts: "ц", ch: "ч", sh: "ш",
  yo: "е", jo: "е", ye: "е", je: "е", yu: "ю", ju: "ю", ya: "я", ja: "я",
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "и", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "и", z: "з",
};

const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU_KEYS = "йцукенгшщзхъфывапролджэячсмитьбюё";
const EN_TO_RU_KEYS = Object.fromEntries([...EN_KEYS].map((key, index) => [key, RU_KEYS[index]]));
const RU_TO_EN_KEYS = Object.fromEntries([...RU_KEYS].map((key, index) => [key, EN_KEYS[index]]));

const LATIN_HOMOGLYPHS: Record<string, string> = {
  a: "а", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
};
const RU_HOMOGLYPHS = Object.fromEntries(Object.entries(LATIN_HOMOGLYPHS).map(([latin, ru]) => [ru, latin]));

/** Only alternative spellings of the SAME label. Never brand -> ingredient/analogue. */
const SAME_NAME_ALIASES = [
  ["парацетамол", "paracetamol"],
  ["ибупрофен", "ibuprofen"],
  ["нурофен", "nurofen"],
  ["аспирин", "aspirin"],
  ["цитрамон", "citramon"],
  ["амоксициллин", "amoxicillin"],
  ["амоксиклав", "amoxiclav"],
  ["панадол", "panadol"],
  ["зодак", "zodak"],
  ["зиртек", "zyrtec"],
  ["супрастин", "suprastin"],
  ["фервекс", "fervex"],
  ["терафлю", "theraflu"],
  ["смекта", "smecta"],
  ["энтеросгель", "enterosgel"],
  ["називин", "nasivin"],
  ["отривин", "otrivin"],
  ["иватерм", "ivatherm"],
  ["пептид био", "peptide bio"],
] as const;

const FORM_WORDS: Record<string, readonly string[]> = {
  tablet: ["таб", "табл", "таблетка", "таблетки", "таблеток", "таблетках", "таблетку", "таблет", "tablet", "tablets", "tab", "tabs", "tabl", "tabletki"],
  capsule: ["капс", "капсула", "капсулы", "капсул", "капсулах", "капсулу", "capsule", "capsules", "caps", "kaps", "kapsuly"],
  syrup: ["сироп", "сиропа", "сиропы", "syrup", "sirop"],
  suspension: ["сусп", "суспензия", "суспензии", "суспензию", "suspension"],
  solution: ["рр", "раств", "раствор", "раствора", "растворы", "solution"],
  drops: ["кап", "капл", "капли", "капель", "капля", "drops", "drop", "kapli"],
  spray: ["спрей", "спрея", "спреи", "spray", "sprey"],
  aerosol: ["аэрозоль", "аэрозоля", "аэрозоли", "aerosol"],
  cream: ["крем", "крема", "кремы", "cream"],
  ointment: ["мазь", "мази", "ointment"],
  gel: ["гель", "геля", "гели", "gel"],
  powder: ["пор", "порошок", "порошка", "порошки", "порошков", "powder"],
  granules: ["гран", "гранулы", "гранул", "granules"],
  suppository: ["супп", "суппозиторий", "суппозитории", "суппозиториев", "свеча", "свечи", "свечей", "suppository", "suppositories"],
  ampoule: ["амп", "ампула", "ампулы", "ампул", "ампулах", "ampoule", "ampoules", "ampule", "ampules"],
  patch: ["пластырь", "пластыря", "пластыри", "пластырей", "patch", "patches"],
  lozenge: ["пастилка", "пастилки", "пастилок", "леденец", "леденцы", "леденцов", "lozenge", "lozenges"],
  shampoo: ["шампунь", "шампуня", "шампуни", "shampoo"],
  "route:eye": ["глазные", "глазной", "глазная", "глазных", "глазн", "гл", "офтальмологический", "ophthalmic"],
  "route:nasal": ["назальный", "назальная", "назальные", "назальных", "наз", "nasal"],
  "route:ear": ["ушные", "ушной", "ушная", "ушных", "ушн", "otic"],
  "route:rectal": ["ректальный", "ректальная", "ректальные", "ректальных", "рект", "rectal"],
  "route:vaginal": ["вагинальный", "вагинальная", "вагинальные", "вагинальных", "ваг", "vaginal"],
};
const FORM_BY_WORD = new Map(Object.entries(FORM_WORDS).flatMap(([form, words]) => words.map((word) => [word, form] as const)));
const COUNTABLE_FORMS = new Set(["tablet", "capsule", "ampoule", "suppository", "patch", "lozenge"]);

const UNIT_NAMES: Record<string, string> = {
  mg: "mg", мг: "mg", milligram: "mg", milligrams: "mg", миллиграмм: "mg", миллиграмма: "mg", миллиграммов: "mg",
  mcg: "mcg", ug: "mcg", "μg": "mcg", "µg": "mcg", мкг: "mcg",
  g: "g", гр: "g", г: "g", грамм: "g", грамма: "g", граммов: "g",
  kg: "kg", кг: "kg", ml: "ml", мл: "ml", milliliter: "ml", milliliters: "ml", миллилитр: "ml", миллилитра: "ml", миллилитров: "ml",
  l: "l", л: "l", iu: "iu", ме: "iu", ед: "iu", "ед.": "iu", "%": "%",
  cm: "cm", см: "cm", mm: "mm", мм: "mm",
};
const UNIT_PATTERN = Object.keys(UNIT_NAMES).sort((left, right) => right.length - left.length).map(escapeRegex).join("|");
const DECIMAL_PATTERN = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const NUMBER_BOUNDARY = "(?![\\p{L}\\p{N}])";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toLatin(value: string): string {
  return value.replace(/[а-яё]/g, (letter) => RU_TO_LATIN[letter] ?? letter);
}

function toRussian(value: string): string {
  return value.replace(/shch|sch|zh|kh|ts|ch|sh|yo|jo|ye|je|yu|ju|ya|ja|[a-z]/g, (letters) => LATIN_TO_RU[letters] ?? letters);
}

function normalizeMixedScripts(word: string): string {
  const ruCount = word.match(/[а-яё]/g)?.length ?? 0;
  const latinCount = word.match(/[a-z]/g)?.length ?? 0;
  if (!ruCount || !latinCount) return word;
  if (ruCount >= latinCount) {
    return word.replace(/[a-z]+/g, (part) => [...part].every((letter) => LATIN_HOMOGLYPHS[letter])
      ? [...part].map((letter) => LATIN_HOMOGLYPHS[letter]).join("")
      : toRussian(part));
  }
  return word.replace(/[а-яё]+/g, (part) => [...part].every((letter) => RU_HOMOGLYPHS[letter])
    ? [...part].map((letter) => RU_HOMOGLYPHS[letter]).join("")
    : toLatin(part));
}

/** Normalizes typography and mixed-script lookalikes, not spelling or drug identity. */
export function normalizeProductSearchText(value: string): string {
  return value
    .replace(/№/g, " # ")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/(\d),(?=\d)/g, "$1.")
    .replace(/[−–—]/g, "-")
    .replace(/[×✕]/g, "x")
    .replace(/[\p{L}]+/gu, normalizeMixedScripts)
    .replace(/(^|[^\p{L}\p{N}])(?:no|n|номер)\s*[.°]?\s*(?=\d)/gu, "$1#")
    .replace(/пептид\s*био/gu, "пептид био")
    .replace(/peptide\s*bio/gu, "peptide bio")
    // Separate a labelled vitamin/code from an attached form before count parsing.
    .replace(/(\d)([\p{L}]+)/gu, (match, digit: string, word: string) => FORM_BY_WORD.has(word) ? `${digit} ${word}` : match)
    .replace(/(^|[^\p{L}\p{N}])(?:spf|спф)[\s-]*(\d+)/gu, "$1spf$2")
    .replace(/(^|[^\p{L}\p{N}])(?:b|в)[\s-]*(\d+)(?![\p{L}\p{N}])/gu, "$1b$2")
    .replace(/(^|[^\p{L}\p{N}])(?:d|д)[\s-]*(\d+)(?![\p{L}\p{N}])/gu, "$1d$2")
    .replace(/р\s*\/\s*р/gu, "рр")
    .replace(/[^\p{L}\p{N}.%/# +\-]/gu, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decimal string canonicalization avoids floating point rounding or dose conversion. */
function canonicalNumber(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  const decimal = fraction.replace(/0+$/, "");
  return decimal ? `${integer}.${decimal}` : integer;
}

function extractConstraints(normalized: string): { numbers: string[]; forms: string[]; nameQuery: string } {
  const numbers = new Set<string>();
  const forms = new Set<string>();
  let name = normalized;
  const addBare = (value: string) => numbers.add(`n:${canonicalNumber(value)}`);

  // A concentration is a single constraint. 100 mg / 5 ml is NOT 100 mg / ml.
  const concentration = new RegExp(`(${DECIMAL_PATTERN})\\s*(${UNIT_PATTERN})\\s*\\/\\s*(${DECIMAL_PATTERN})?\\s*(${UNIT_PATTERN})${NUMBER_BOUNDARY}`, "gu");
  name = name.replace(concentration, (_, numerator: string, firstUnit: string, denominator: string | undefined, lastUnit: string) => {
    const bottom = denominator ?? "1";
    numbers.add(`${UNIT_NAMES[firstUnit]}/${UNIT_NAMES[lastUnit]}:${canonicalNumber(numerator)}/${canonicalNumber(bottom)}`);
    addBare(numerator);
    if (denominator) addBare(denominator);
    return " ";
  });

  // A trailing unit applies to every part of a labelled compound (875 + 125 mg).
  const unitNumber = new RegExp(`(${DECIMAL_PATTERN}(?:\\s*\\+\\s*${DECIMAL_PATTERN})*)\\s*(${UNIT_PATTERN})${NUMBER_BOUNDARY}`, "gu");
  name = name.replace(unitNumber, (_, values: string, unit: string) => {
    for (const value of values.split(/\s*\+\s*/)) {
      numbers.add(`${UNIT_NAMES[unit]}:${canonicalNumber(value)}`);
      addBare(value);
    }
    return " ";
  });

  name = name.replace(new RegExp(`#\\s*(${DECIMAL_PATTERN})${NUMBER_BOUNDARY}`, "gu"), (_, value: string) => {
    numbers.add(`count:${canonicalNumber(value)}`);
    addBare(value);
    return " ";
  });

  name = name.replace(new RegExp(`(${DECIMAL_PATTERN})\\s*(штуки|штук|штука|шт|pieces|pcs|дозы|доз|доза|doses)${NUMBER_BOUNDARY}`, "gu"), (_, value: string, unit: string) => {
    numbers.add(`${/^(?:доз|doses)/u.test(unit) ? "doses" : "count"}:${canonicalNumber(value)}`);
    addBare(value);
    return " ";
  });

  // "20 таблеток" describes pack count plus form, not a 20 mg dose.
  name = name.replace(new RegExp(`(${DECIMAL_PATTERN})\\s*([\\p{L}]+)${NUMBER_BOUNDARY}`, "gu"), (match, value: string, word: string, offset: number, full: string) => {
    // In B12/D3 the number belongs to the name, not to "12 capsules" / "3 tablets".
    if (/[\p{L}\p{N}.]/u.test(full[offset - 1] ?? "")) return match;
    const form = FORM_BY_WORD.get(word);
    if (!form || !COUNTABLE_FORMS.has(form)) return match;
    numbers.add(`count:${canonicalNumber(value)}`);
    addBare(value);
    forms.add(form);
    return " ";
  });

  // Keep B12, D3, SPF50 etc as exact name tokens. Pack #12 must not satisfy B12.
  name = name.replace(/[\p{L}\p{N}]+/gu, (token) => {
    if (/\p{L}/u.test(token) && /\d/u.test(token)) {
      numbers.add(`alnum:${toLatin(token)}`);
      for (const number of token.match(/\d+/g) ?? []) addBare(number);
    }
    return token;
  });

  name = name.replace(new RegExp(DECIMAL_PATTERN, "g"), (value, offset: number, full: string) => {
    const before = full[offset - 1] ?? "";
    const after = full[offset + value.length] ?? "";
    if (/[\p{L}\p{N}]/u.test(before + after)) return value;
    addBare(value);
    return " ";
  });

  name = name.replace(/[\p{L}]+/gu, (word) => {
    const form = FORM_BY_WORD.get(word);
    if (!form) return word;
    forms.add(form);
    return " ";
  });

  return {
    numbers: [...numbers].sort(),
    forms: [...forms].sort(),
    nameQuery: name.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(),
  };
}

function replaceAliases(value: string, to: "ru" | "latin"): string {
  let result = value;
  for (const [ru, latin] of SAME_NAME_ALIASES) {
    const from = to === "ru" ? latin : ru;
    const replacement = to === "ru" ? ru : latin;
    result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(from)}(?=$|[^\\p{L}\\p{N}])`, "gu"), `$1${replacement}`);
  }
  return result;
}

function nameVariants(value: string): ParsedProductSearchQuery["variants"] {
  const variants: ParsedProductSearchQuery["variants"] = [];
  const seen = new Set<string>();
  const add = (candidate: string, kind: ProductSearchVariantKind) => {
    const normalized = normalizeProductSearchText(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      variants.push({ value: normalized, kind });
    }
  };
  add(value, "original");
  // Short names are ambiguous: do not expand them into unrelated keyboard/translit candidates.
  if ((value.match(/\p{L}/gu)?.length ?? 0) < 4) return variants;

  add(replaceAliases(value, "ru"), "alias");
  add(replaceAliases(value, "latin"), "alias");
  if (/[а-я]/u.test(value)) add(toLatin(value), "transliteration");
  if (/[a-z]/u.test(value)) add(toRussian(value), "transliteration");
  // Preserve the verified label spelling while transliterating the rest of a full title.
  if (/[а-я]/u.test(value)) add(toLatin(replaceAliases(value, "latin")), "alias");
  if (/[a-z]/u.test(value)) add(toRussian(replaceAliases(value, "ru")), "alias");
  return variants;
}

function keyboardNameVariant(original: string, constraints: ReturnType<typeof extractConstraints>): string | null {
  const name = constraints.nameQuery;
  if ((name.match(/\p{L}/gu)?.length ?? 0) < 4) return null;
  const hasLatin = /[a-z]/u.test(name);
  const hasRussian = /[а-я]/u.test(name);
  if (hasLatin === hasRussian) return null;
  const keyboard = hasLatin ? EN_TO_RU_KEYS : RU_TO_EN_KEYS;
  // Work BEFORE punctuation cleanup: comma is the Russian "б" key, not a separator.
  const source = original.replace(/№/g, " # ").normalize("NFKC").toLocaleLowerCase("ru");
  const candidate = source.replace(/[\p{L}`[\];',.]+/gu, (part, offset: number, full: string) => {
    if (!/\p{L}/u.test(part)) return part;
    const token = part.replace(/\.$/, "");
    // Explicit quantities/forms are not keyboard guesses. Keep their exact constraints.
    if (UNIT_NAMES[token] || FORM_BY_WORD.has(token)) return part;
    if (/^(?:n|no)$/u.test(token) && /^\s*\d/u.test(full.slice(offset + part.length))) return part;
    return [...part].map((key) => keyboard[key] ?? key).join("");
  });
  const extracted = extractConstraints(normalizeProductSearchText(candidate));
  if (JSON.stringify(extracted.numbers) !== JSON.stringify(constraints.numbers)
    || JSON.stringify(extracted.forms) !== JSON.stringify(constraints.forms)) return null;
  return extracted.nameQuery && extracted.nameQuery !== name ? extracted.nameQuery : null;
}

export function parseProductSearchQuery(input: string): ParsedProductSearchQuery {
  const original = input.trim();
  const normalized = normalizeProductSearchText(original);
  const constraints = extractConstraints(normalized);
  // Typed numeric/form constraints take precedence over the broad bare numeric keys.
  const qualified = new Set<string>();
  for (const constraint of constraints.numbers) {
    if (!constraint.startsWith("n:")) {
      for (const value of constraint.split(":")[1]?.match(/\d+(?:\.\d+)?/g) ?? []) qualified.add(`n:${canonicalNumber(value)}`);
    }
  }
  const variants = nameVariants(constraints.nameQuery);
  const keyboard = keyboardNameVariant(original, constraints);
  if (keyboard && !variants.some((variant) => variant.value === keyboard)) variants.push({ value: keyboard, kind: "layout" });
  // Keyboard punctuation can turn a long word into isolated initials (ыъыъ -> s s).
  // Such fragments cannot identify the entered name. Filter query alternatives only;
  // source documents/aliases keep their existing index model and literal initials work.
  const hasLongNameWord = /[\p{L}\p{N}]{4,}/u.test(constraints.nameQuery);
  const searchableVariants = variants.filter(variant => variant.kind === "original" || !hasLongNameWord
    || /[\p{L}\p{N}]{2,}/u.test(variant.value));
  return {
    original,
    normalized,
    nameQuery: constraints.nameQuery,
    variants: searchableVariants,
    numbers: constraints.numbers.filter((number) => !qualified.has(number)),
    forms: constraints.forms,
  };
}

const vowelSourceNames = new WeakMap<Product, { name: string; words: string[] }>();

/**
 * Last-resort spelling recovery from a complete source catalog, not a medical synonym.
 * Long Russian names can have three confused unstressed vowels while preserving every
 * consonant. The normal edit-distance search runs first. This narrower recovery only
 * accepts one source lead-name identity, before filtering by dose, form or availability.
 * It does not change indexed fields, aliases or the search document model version.
 */
export function resolveSourceVowelCorrection(nameQuery: string, products: readonly Product[]): string | null {
  if (!/^[а-я]{9,40}$/u.test(nameQuery)) return null;
  const vowelClass = (word: string) => word.replace(/[ао]/gu, "а").replace(/[еи]/gu, "е");
  const signature = vowelClass(nameQuery);
  if ((nameQuery.match(/[бвгджзйклмнпрстфхцчшщ]/gu)?.length ?? 0) < 4) return null;
  let corrected: string | null = null;
  for (const product of products) {
    if (product.source !== "daribar" || !product.sku) continue;
    let cached = vowelSourceNames.get(product);
    if (!cached || cached.name !== product.name) {
      cached = { name: product.name, words: normalizeProductSearchText(product.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean) };
      vowelSourceNames.set(product, cached);
    }
    // An existing literal name must not be replaced, even if its dose is unavailable.
    if (cached.words.includes(nameQuery)) return null;
    const candidate = cached.words[0] || "";
    if (candidate.length !== nameQuery.length || vowelClass(candidate) !== signature) continue;
    const changes = [...nameQuery].reduce((count, letter, index) => count + Number(letter !== candidate[index]), 0);
    // A closer source label makes a three-change guess ambiguous; normal search owns it.
    if (changes < 3) return null;
    if (changes !== 3) continue;
    if (corrected && corrected !== candidate) return null;
    corrected = candidate;
  }
  return corrected;
}

export function createProductSearchDocument(product: Product): ProductSearchDocument {
  const normalized_name = normalizeProductSearchText(product.name);
  const constraints = extractConstraints(normalized_name);
  return {
    id: product.id,
    sku: product.sku ?? "",
    name: product.name,
    normalized_name,
    aliases: nameVariants(normalized_name).filter((variant) => variant.kind !== "original").map((variant) => variant.value),
    numbers: constraints.numbers,
    forms: constraints.forms,
  };
}

/** Repeat this guard after Daribar hydration; a stale search index may not change a dose/form. */
export function matchesProductSearchConstraints(
  product: Product | ProductSearchDocument,
  parsed: Pick<ParsedProductSearchQuery, "numbers" | "forms">,
): boolean {
  const document = "normalized_name" in product ? product : createProductSearchDocument(product);
  const numbers = new Set(document.numbers);
  const forms = new Set(document.forms);
  return parsed.numbers.every((number) => numbers.has(number)) && parsed.forms.every((form) => forms.has(form));
}
