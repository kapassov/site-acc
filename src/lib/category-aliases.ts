/**
 * Legacy marketing slugs kept for old CMS content, indexed pages and links
 * shared before the real Medusa category handles became canonical.
 */
export const CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  vitamins: "lekarstva-i-bady-vitaminy-i-mikroelementy",
  medicines: "lekarstva-i-bady",
  "medical-products": "med-pribory-i-izdeliya",
  "face-care": "kosmetika",
  "body-care": "kosmetika",
  makeup: "kosmetika",
  "mom-baby": "mama-i-malysh",
  hygiene: "gigiyena",
  sun: "zagar-i-zashita-ot-solnca",
});

const MEDUSA_CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  bady: "lekarstva-i-bady",
  linzy: "lekarstva-i-bady-zabota-o-zrenii",
  "zagar-i-zashita-ot-solnca": "kosmetika-solntsezaschitnye-sredstva",
});

export function resolveCategoryHandle(handle: string): string {
  const normalized = handle.trim().toLowerCase();
  return CATEGORY_ALIASES[normalized] ?? normalized;
}

export function resolveMedusaCategoryHandle(handle: string): string {
  const legacyResolved = resolveCategoryHandle(handle);
  return MEDUSA_CATEGORY_ALIASES[legacyResolved] ?? legacyResolved;
}
