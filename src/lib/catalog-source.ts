import type { CatNode, Product } from "./types.ts";

export type CatalogSnapshot = {
  products: Product[];
  sourceCount: number;
  loadedCount: number;
  complete: boolean;
  stale: boolean;
  generatedAt: string;
  categoryTree?: CatNode[];
};

export type CatalogReadSource = "postgres" | "medusa" | "medusa_fallback";

export type CatalogReadResult = {
  snapshot: CatalogSnapshot;
  source: CatalogReadSource;
  degraded: boolean;
};

export type CatalogSourceLoaders = {
  local: () => Promise<CatalogSnapshot>;
  medusa: () => Promise<CatalogSnapshot>;
};

export function prefersPostgresCatalog(value: string | undefined): boolean {
  return String(value || "medusa").trim().toLowerCase() === "postgres";
}

/**
 * Resolve one authoritative storefront snapshot. PostgreSQL is opt-in only;
 * any local verification/read failure falls back to real Medusa data.
 */
export async function resolveCatalogSource(
  preferredValue: string | undefined,
  loaders: CatalogSourceLoaders,
): Promise<CatalogReadResult> {
  if (!prefersPostgresCatalog(preferredValue)) {
    return { snapshot: await loaders.medusa(), source: "medusa", degraded: false };
  }

  try {
    const snapshot = await loaders.local();
    if (!snapshot.complete || snapshot.loadedCount !== snapshot.sourceCount) {
      throw new Error("catalog_snapshot_incomplete");
    }
    return { snapshot, source: "postgres", degraded: false };
  } catch {
    return { snapshot: await loaders.medusa(), source: "medusa_fallback", degraded: true };
  }
}
