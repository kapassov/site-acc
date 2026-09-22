"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/data/account";

/** Customer API resolves the active Daribar identity, with legacy Medusa fallback. */
export function useOrders(): Order[] {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      fetch("/api/customer/orders", { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("orders_unavailable")))
        .then((data) => { if (alive) setOrders(Array.isArray(data?.orders) ? data.orders : []); })
        .catch((error) => { if (error instanceof Error && error.name === "AbortError") return; });
    };
    const visibleRefresh = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    const timer = window.setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, []);
  return orders;
}
