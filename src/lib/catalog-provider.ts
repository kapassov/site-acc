export type StorefrontCatalogProvider = "medusa" | "shadow" | "daribar";

export function storefrontCatalogProvider(env: NodeJS.ProcessEnv = process.env): StorefrontCatalogProvider {
  const value = String(env.STOREFRONT_CATALOG_PROVIDER || "medusa").trim().toLowerCase();
  if (value === "daribar" || value === "shadow") return value;
  return "medusa";
}

export function servesDaribarCatalog(env: NodeJS.ProcessEnv = process.env): boolean {
  return storefrontCatalogProvider(env) === "daribar";
}

/** Reject carts from a previous catalogue after a provider cutover. */
export function storefrontCheckoutSource(env: NodeJS.ProcessEnv = process.env): "medusa" | "daribar" {
  return servesDaribarCatalog(env) ? "daribar" : "medusa";
}

export function comparesCatalogsInShadow(env: NodeJS.ProcessEnv = process.env): boolean {
  return storefrontCatalogProvider(env) === "shadow";
}
