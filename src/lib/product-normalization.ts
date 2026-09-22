type ProductIdentityInput = {
  name: string;
  brand?: string;
  barcode?: string;
  slug?: string;
};

const PEPTIDE_BIO_BRAND = "Пептид Био";
const PEPTIDE_BIO_ALIASES = new Set([
  "peptide bio",
  "peptid bio",
  "peptides",
  "пептид био",
  "пептидбио",
]);
const PEPTIDE_BIO_PRODUCTS = /(?:везилют|нормофтал|тестаген|кардиоген|панкраген|бронхоген|vezilyut|normoftal|testagen|kardiogen|pankragen|bronhogen)/i;
const PRODUCT_SLUG_REPAIRS = [
  {
    source: "aspirin-bayer-100mg",
    canonical: "now-eve-multivitaminy-dlya-zhenshchin-90",
    matches: /(?:\bnow\b.*\beve\b|eve.*мультивитамин|мультивитамин.*для женщин)/i,
  },
] as const;

function clean(value?: string): string {
  return String(value || "").trim();
}

function normalizePeptideBioName(name: string): string {
  return name
    .replace(/Peptide\s*Bio/gi, PEPTIDE_BIO_BRAND)
    .replace(/Peptid\s*Bio/gi, PEPTIDE_BIO_BRAND)
    .replace(/Пептид\s*Био/gi, PEPTIDE_BIO_BRAND);
}

export function normalizeProductIdentity(input: ProductIdentityInput): { name: string; brand: string } {
  const barcode = clean(input.barcode);
  const slug = clean(input.slug);
  const brand = clean(input.brand);
  const searchText = `${input.name} ${slug}`;
  const belongsToPeptideBio =
    PEPTIDE_BIO_PRODUCTS.test(searchText) &&
    (barcode.startsWith("460342300") || PEPTIDE_BIO_ALIASES.has(brand.toLowerCase()));

  let name = clean(input.name);
  let normalizedBrand = brand;

  if (barcode === "4603423001072") {
    name = "Панкраген Пептид Био капс. 200 мг №60";
    normalizedBrand = PEPTIDE_BIO_BRAND;
  } else if (belongsToPeptideBio) {
    name = normalizePeptideBioName(name);
    if (!name.includes(PEPTIDE_BIO_BRAND)) {
      name = name.replace(/^(\S+)/, `$1 ${PEPTIDE_BIO_BRAND}`);
    }
    normalizedBrand = PEPTIDE_BIO_BRAND;
  }

  return { name, brand: normalizedBrand };
}

export function canonicalProductSlug(name: string, slug: string): string {
  return PRODUCT_SLUG_REPAIRS.find((repair) => repair.source === slug && repair.matches.test(name))?.canonical || slug;
}

/** Convert a repaired public slug back to the original Medusa handle for lookups. */
export function sourceProductSlug(slug: string): string {
  return PRODUCT_SLUG_REPAIRS.find((repair) => repair.canonical === slug)?.source || slug;
}
