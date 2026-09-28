"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Product, Category, Brand } from "@/lib/types";

type Data = { products: Product[]; categories: Category[]; brands: Brand[]; ready: boolean };

const Ctx = createContext<Data>({ products: [], categories: [], brands: [], ready: false });
const REFRESH_MS = 5 * 60_000;

const CATEGORY_PALETTE = [
  ["#d8f3ea", "#bce8da"], ["#dfe8fb", "#c7d7f5"], ["#fde2ee", "#f8c9df"],
  ["#ffedca", "#ffe0a3"], ["#e8dcfb", "#d9c4f6"], ["#d7f2f7", "#bce7ef"],
] as const;

function categoriesFromTree(value: unknown): Category[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((node, index) => {
    if (!node || typeof node !== "object") return [];
    const item = node as { id?: unknown; handle?: unknown; name?: unknown };
    if (typeof item.id !== "string" || typeof item.handle !== "string" || typeof item.name !== "string") return [];
    const palette = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
    return [{ id: item.id, slug: item.handle, name: item.name, count: 0, icon: "Sparkles", from: palette[0], to: palette[1] }];
  });
}

/**
 * Loads a small Medusa bootstrap page plus the independently cached category
 * tree. Full facets are deliberately excluded: downloading thousands of brand
 * aggregates during hydration delayed every page without helping its first UI.
 */
export function CatalogDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>({ products: [], categories: [], brands: [], ready: false });
  const lastProductLoadAt = useRef(0);
  const pathname = usePathname();
  const needsProductBootstrap = pathname === "/" || pathname.startsWith("/promotions")
    || pathname.startsWith("/favorites") || pathname.startsWith("/ai");

  useEffect(() => {
    if (pathname !== "/") return;
    const controller = new AbortController();
    fetch("/api/category-tree", { cache: "default", signal: controller.signal })
      .then((response) => response.ok ? response.json() : [])
      .then((tree) => setData((previous) => ({ ...previous, categories: categoriesFromTree(tree) })))
      .catch(() => { /* Navigation still works with the fallback menu. */ });
    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    // Account, checkout, PDP and catalogue routes fetch their own scoped data.
    // Avoid the global product bootstrap competing with their primary requests.
    if (!needsProductBootstrap) return;
    let alive = true;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    const schedule = (delay: number) => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, delay);
    };

    const load = async () => {
      if (!alive || running) return;
      running = true;
      activeController = new AbortController();
      const timeout = setTimeout(() => activeController?.abort(), 15_000);
      try {
        const response = await fetch("/api/catalog?limit=24&offset=0&facets=0", { cache: "default", signal: activeController.signal });
        if (!response.ok) throw new Error(`catalog_${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.products) || payload.products.length === 0) throw new Error("empty_catalog");
        if (!alive) return;
        failures = 0;
        lastProductLoadAt.current = Date.now();
        setData((previous) => ({
          ...previous,
          products: payload.products,
          brands: payload.products.flatMap((product: Partial<Product>) => (
            typeof product.brand === "string" && !["", "-", "—"].includes(product.brand.trim())
              ? [{ id: product.brand, slug: product.brand.toLocaleLowerCase("ru").replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, ""), name: product.brand, tagline: "", hue: 150 }]
              : []
          )).filter((brand: Brand, index: number, list: Brand[]) => list.findIndex((candidate) => candidate.slug === brand.slug) === index).slice(0, 6),
          ready: true,
        }));
        schedule(REFRESH_MS);
      } catch {
        if (!alive) return;
        failures += 1;
        setData((previous) => ({ ...previous, ready: true }));
        schedule(Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4)));
      } finally {
        clearTimeout(timeout);
        activeController = null;
        running = false;
      }
    };

    const reconnect = () => schedule(0);
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastProductLoadAt.current >= REFRESH_MS) reconnect();
    };

    // The full catalogue is useful for search/favourites, but downloading it
    // during hydration competes with the hero and PDP images. Start shortly
    // after the first paint; cached category navigation remains independent.
    const elapsed = Date.now() - lastProductLoadAt.current;
    schedule(lastProductLoadAt.current && elapsed < REFRESH_MS ? REFRESH_MS - elapsed : 700);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      activeController?.abort();
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [needsProductBootstrap]);

  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useCatalogData() {
  return useContext(Ctx);
}
