import type { CatNode, Product } from "@/lib/types";
import { canonicalProductSlug, normalizeProductIdentity } from "@/lib/product-normalization";
import { productImageFallback } from "@/lib/product-image-overrides";
import { searchProductsByName } from "@/lib/product-name-search";

type RemoteCatalogPayload = Record<string, unknown> & {
  products?: Product[];
};

function configuredRemoteCatalogUrl(): URL | null {
  const raw = String(process.env.CATALOG_PUBLIC_API_URL || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function remoteCatalogEnabled(): boolean {
  return configuredRemoteCatalogUrl() !== null;
}

export function normalizeRemoteProduct(product: Product): Product {
  const identity = normalizeProductIdentity({
    name: product.name,
    brand: product.brand,
    barcode: product.barcode,
    slug: product.slug,
  });
  const fallbackImage = product.image ? undefined : productImageFallback(product.id);
  return {
    ...product,
    slug: canonicalProductSlug(identity.name, product.slug),
    name: identity.name,
    brand: identity.brand,
    image: product.image || fallbackImage,
    images: product.images?.length ? product.images : fallbackImage ? [fallbackImage] : product.images,
  };
}

function normalizePayload(payload: RemoteCatalogPayload): RemoteCatalogPayload {
  return {
    ...payload,
    products: Array.isArray(payload.products) ? payload.products.map(normalizeRemoteProduct) : [],
  };
}

export async function getRemoteCatalogPayload(searchParams?: URLSearchParams): Promise<RemoteCatalogPayload | null> {
  const url = configuredRemoteCatalogUrl();
  if (!url) return null;

  if (searchParams) {
    for (const [key, value] of searchParams) url.searchParams.set(key, value);
  }

  try {
    const query = url.searchParams.get("q")?.trim();
    const companionUrl = query ? new URL(url) : null;
    if (companionUrl) {
      companionUrl.searchParams.delete("q");
      companionUrl.searchParams.set("limit", "100");
      companionUrl.searchParams.set("offset", "0");
      companionUrl.searchParams.set("facets", "0");
    }
    const [response, companionResponse] = await Promise.all([
      // A short server-side revalidation window keeps navigation responsive
      // without turning catalogue prices and availability into long-lived data.
      // The live PDP/checkout requests remain uncached and authoritative.
      fetch(url, { next: { revalidate: 30 }, signal: AbortSignal.timeout(30_000) }),
      companionUrl
        ? fetch(companionUrl, { next: { revalidate: 30 }, signal: AbortSignal.timeout(30_000) }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!response.ok) return null;
    const payload = normalizePayload(await response.json() as RemoteCatalogPayload);
    if (!query || !companionResponse?.ok) return payload;

    const companion = normalizePayload(await companionResponse.json() as RemoteCatalogPayload);
    const combined = [...(payload.products || []), ...(companion.products || [])];
    const products = searchProductsByName([...new Map(combined.map((product) => [product.id, product])).values()], query, 100);
    if (products.length <= (payload.products?.length || 0)) return payload;
    const count = Math.max(Number(payload.count || 0), products.length);
    return {
      ...payload,
      products,
      count,
      hasMore: false,
      pagination: typeof payload.pagination === "object" && payload.pagination
        ? { ...(payload.pagination as Record<string, unknown>), total: count, hasNext: false, nextOffset: null }
        : payload.pagination,
    };
  } catch {
    return null;
  }
}

export async function getRemoteProducts(limit = 250): Promise<Product[] | null> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(250, limit))) });
  const payload = await getRemoteCatalogPayload(params);
  return payload?.products ?? null;
}

export async function searchRemoteProducts(query: string, limit = 48): Promise<Product[] | null> {
  const params = new URLSearchParams({ q: query, limit: String(Math.max(1, Math.min(100, limit))) });
  const payload = await getRemoteCatalogPayload(params);
  return payload?.products ?? null;
}

export async function getRemoteProduct(slug: string): Promise<Product | null> {
  const base = configuredRemoteCatalogUrl();
  if (!base) return null;

  const url = new URL("/api/product/" + encodeURIComponent(slug), base.origin);
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { product?: Product };
    return payload.product ? normalizeRemoteProduct(payload.product) : null;
  } catch {
    return null;
  }
}

export async function getRemoteCategoryTree(): Promise<CatNode[] | null> {
  const base = configuredRemoteCatalogUrl();
  if (!base) return null;

  try {
    const response = await fetch(new URL("/api/category-tree", base.origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload as CatNode[] : null;
  } catch {
    return null;
  }
}
