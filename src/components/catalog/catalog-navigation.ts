import type { CatNode } from "@/lib/types";
import { CATALOG_DIRECTORY } from "../../lib/catalog-directory.ts";

/**
 * Stable storefront navigation for the Daribar catalogue.
 *
 * Daribar does not expose the Medusa category tree used by the old storefront.
 * Keeping this small presentation model next to the catalogue UI prevents every
 * page render from waiting for the retired catalogue providers.
 */
export const CATALOG_NAVIGATION_TREE: CatNode[] = [
  { id: "catalog-bady", handle: "bady", name: "БАДы", children: [] },
  { id: "catalog-gigiyena", handle: "gigiyena", name: "Гигиена", children: [] },
  { id: "catalog-kosmetika", handle: "kosmetika", name: "Косметика", children: [] },
  { id: "catalog-lekarstva", handle: "lekarstva-i-bady", name: "Лекарства", children: [] },
  { id: "catalog-linzy", handle: "linzy", name: "Линзы", children: [] },
  { id: "catalog-mama", handle: "mama-i-malysh", name: "Мама и малыш", children: [] },
  { id: "catalog-medical", handle: "med-pribory-i-izdeliya", name: "Мед. приборы и изделия", children: [] },
  { id: "catalog-sport", handle: "sport-i-fitnes", name: "Спорт и фитнес", children: [] },
  { id: "catalog-adult", handle: "intim", name: "Товары для взрослых", children: [] },
  { id: "catalog-other", handle: "drugoe", name: "Другие", children: [] },
];

// Kept addressable for existing seasonal, footer and CMS links without adding
// another permanent item to the compact primary navigation.
const LINKED_CATALOG_CATEGORIES: CatNode[] = [
  { id: "catalog-sun", handle: "zagar-i-zashita-ot-solnca", name: "Солнцезащита", children: [] },
  ...CATALOG_DIRECTORY.flatMap((group): CatNode[] => [
    { id: group.id, handle: group.handle, name: group.name, children: [] },
    ...group.children.map((child) => ({
      id: child.id,
      handle: child.handle,
      name: child.name,
      children: [],
    })),
  ]),
];

export function catalogNavigationNode(handle: string): CatNode | null {
  return [...CATALOG_NAVIGATION_TREE, ...LINKED_CATALOG_CATEGORIES]
    .find((node) => node.handle === handle) ?? null;
}
