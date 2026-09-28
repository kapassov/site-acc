"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/data/account";

/** Customer API resolves the active Daribar identity, with legacy Medusa fallback. */
export function useOrders(): Order[] {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    let lastRefreshAt = 0;
    const refresh = () => {
      lastRefreshAt = Date.now();
      controller?.abort();
      controller = new AbortController();
      fetch("/api/customer/orders", { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("orders_unavailable")))
        .then((data) => { if (alive) setOrders(Array.isArray(data?.orders) ? data.orders : []); })
        .catch((error) => { if (error instanceof Error && error.name === "AbortError") return; });
    };
    const visibleRefresh = () => { if (document.visibilityState === "visible" && Date.now() - lastRefreshAt >= 30_000) refresh(); };
    refresh();
    // The list endpoint refreshes Daribar feed and several payment records;
    // polling every 15 seconds created competing requests during navigation.
    const timer = window.setInterval(visibleRefresh, 60_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, []);
  return orders;
}
