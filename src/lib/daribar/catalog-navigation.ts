import type { CatNode } from "../types.ts";
import { CATALOG_DIRECTORY } from "../catalog-directory.ts";
import { daribarCategoryDefinitions } from "./catalog-data.ts";

function directoryNode(group: (typeof CATALOG_DIRECTORY)[number]): CatNode {
  return {
    id: group.id,
    name: group.name,
    handle: group.handle,
    children: group.children.map((child) => ({
      id: child.id,
      name: child.name,
      handle: child.handle,
      children: [],
    })),
  };
}

/** Provider-backed category tree used by routes and every navigation surface. */
export function daribarNavigationTree(): CatNode[] {
  const directoryByHandle = new Map(CATALOG_DIRECTORY.map((group) => [group.handle, group]));
  const primary = daribarCategoryDefinitions().map((category): CatNode => {
    const directory = directoryByHandle.get(category.slug);
    return directory
      ? { ...directoryNode(directory), id: category.id, name: category.name }
      : { id: category.id, name: category.name, handle: category.slug, children: [] };
  });
  const primaryHandles = new Set(primary.map((node) => node.handle));
  const additional = CATALOG_DIRECTORY
    .filter((group) => !primaryHandles.has(group.handle))
    .map(directoryNode);

  return [...primary, ...additional];
}
