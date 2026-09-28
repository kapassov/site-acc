"use client";

import {
  createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode,
} from "react";
import type { Product } from "@/lib/types";
import { trackEvent } from "@/lib/analytics/client";
import { browserUuidV4 } from "@/lib/client-uuid";
import { boundedCartQuantity, validCartItemForProvider, type CartCatalogProvider } from "./medusa-cart";

export interface CartItem {
  product: Product;
  qty: number;
}

interface CartContextValue {
  items: CartItem[];
  cartInstanceId: string;
  count: number;
  subtotal: number;
  savings: number;
  isOpen: boolean;
  add: (product: Product, qty?: number) => void;
  remove: (id: string, reason?: string) => void;
  restore: (item: CartItem, index?: number) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  // Выбор позиций для оформления (по умолчанию выбраны все; снятые остаются в корзине)
  isSelected: (id: string) => boolean;
  toggleSelected: (id: string) => void;
  selectedItems: CartItem[];
  selectedCount: number;
  selectedSubtotal: number;
  removeSelected: () => void;
  legacyItemsRemoved: boolean;
  dismissLegacyNotice: () => void;
  open: () => void;
  close: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
// Keep the previous cart recoverable, but never mix provider identities or
// resurrect an old Medusa cart whose products/prices may no longer be current.
const STORAGE_KEY = "inkar-cart-v4-medusa";
const LEGACY_STORAGE_KEY = "inkar-cart-v3-daribar";
const MIGRATION_NOTICE_KEY = "inkar-cart-migration-v4-medusa";
const CART_INSTANCE_KEY = "inkar-cart-instance-v4-medusa";
function storageKeys(provider: CartCatalogProvider) {
  if (provider === "medusa") return {
    cart: STORAGE_KEY,
    legacy: LEGACY_STORAGE_KEY,
    notice: MIGRATION_NOTICE_KEY,
    instance: CART_INSTANCE_KEY,
  };
  return {
    cart: "inkar-cart-v5-daribar",
    legacy: STORAGE_KEY,
    notice: "inkar-cart-migration-v5-daribar",
    instance: "inkar-cart-instance-v5-daribar",
  };
}
// Rotate only the cart identity (not its items) after the checkout recovery
// release. This prevents an old server-side uncertain attempt from conflicting
// with the customer's new, freshly quoted request.
const CART_INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function freshCartInstanceId(): string {
  return browserUuidV4();
}

export function CartProvider({ children, provider = "medusa" }: { children: ReactNode; provider?: CartCatalogProvider }) {
  const { cart: storageKey, legacy: legacyStorageKey, notice: migrationNoticeKey,
    instance: cartInstanceKey } = storageKeys(provider);
  const [items, setItems] = useState<CartItem[]>([]);
  const [unselected, setUnselected] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [legacyItemsRemoved, setLegacyItemsRemoved] = useState(false);
  const [cartInstanceId, setCartInstanceId] = useState("");

  // Hydrate from localStorage after mount (keeps SSR markup === first client render).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- разовая гидратация корзины из localStorage после маунта */
    try {
      const storedInstanceId = localStorage.getItem(cartInstanceKey) || "";
      const instanceId = CART_INSTANCE_ID.test(storedInstanceId) ? storedInstanceId : freshCartInstanceId();
      localStorage.setItem(cartInstanceKey, instanceId);
      setCartInstanceId(instanceId);
      const currentRaw = localStorage.getItem(storageKey);
      const noticeState = localStorage.getItem(migrationNoticeKey);
      let showMigrationNotice = noticeState === "pending";
      // Read the old cart even when the new empty cart was already persisted.
      // It remains untouched; acknowledgement hides only this explanation.
      const legacyRaw = localStorage.getItem(legacyStorageKey);
      if (legacyRaw && noticeState !== "acknowledged") {
        try {
          const previous = JSON.parse(legacyRaw) as unknown;
          if (Array.isArray(previous) && previous.length > 0) showMigrationNotice = true;
        } catch { /* A malformed old cart must not block the current cart. */ }
      }
      if (currentRaw) {
        const parsed = JSON.parse(currentRaw) as unknown;
        const values = Array.isArray(parsed) ? parsed : [];
        const validItems = values.filter((value): value is CartItem => validCartItemForProvider(value, provider));
        setItems(validItems);
        if (validItems.length !== values.length) showMigrationNotice = true;
      }
      if (showMigrationNotice) {
        setLegacyItemsRemoved(true);
        try { localStorage.setItem(migrationNoticeKey, "pending"); } catch { /* Keep the visible notice if storage is unavailable. */ }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [cartInstanceKey, legacyStorageKey, migrationNoticeKey, provider, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      /* ignore */
    }
    // A browser cart is only a draft. The server validates catalogue prices
    // and live Daribar stock for the complete basket before checkout.
  }, [items, hydrated, storageKey]);

  const dismissLegacyNotice = useCallback(() => {
    try { localStorage.setItem(migrationNoticeKey, "acknowledged"); } catch { /* A failed write may show the notice again on reload. */ }
    setLegacyItemsRemoved(false);
  }, [migrationNoticeKey]);

  const rotateCartInstance = useCallback(() => {
    const next = freshCartInstanceId();
    setCartInstanceId(next);
    try { localStorage.setItem(cartInstanceKey, next); } catch { /* ignore */ }
  }, [cartInstanceKey]);

  const add = useCallback((product: Product, qty = 1) => {
    qty = boundedCartQuantity(qty);
    if (!validCartItemForProvider({ product, qty }, provider)) return;
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: boundedCartQuantity(next[idx].qty + qty) };
        return next;
      }
      return [...prev, { product, qty }];
    });
    rotateCartInstance();
    trackEvent("cart_item_added", {
      productId: product.id,
      category: product.categorySlug,
      quantity: qty,
      price: product.price,
    });
  }, [provider, rotateCartInstance]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === cartInstanceKey && event.newValue && CART_INSTANCE_ID.test(event.newValue)) {
        setCartInstanceId(event.newValue);
      }
      if (event.key === migrationNoticeKey && ["pending", "acknowledged"].includes(event.newValue || "")) {
        setLegacyItemsRemoved(event.newValue === "pending");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [cartInstanceKey, migrationNoticeKey]);

  const remove = useCallback((id: string, reason = "remove") => {
    trackEvent("cart_item_removed", { productId: id, reason });
    setItems((prev) => prev.filter((it) => it.product.id !== id));
    setUnselected((prev) => prev.filter((x) => x !== id));
    rotateCartInstance();
  }, [rotateCartInstance]);

  const restore = useCallback((item: CartItem, index?: number) => {
    if (!validCartItemForProvider(item, provider)) return;
    setItems((previous) => {
      const withoutDuplicate = previous.filter((entry) => entry.product.id !== item.product.id);
      const next = [...withoutDuplicate];
      const target = Math.max(0, Math.min(index ?? next.length, next.length));
      next.splice(target, 0, item);
      return next;
    });
    rotateCartInstance();
    trackEvent("cart_item_added", { productId: item.product.id, quantity: item.qty, reason: "undo_remove" });
  }, [provider, rotateCartInstance]);

  const setQty = useCallback((id: string, qty: number) => {
    if (!Number.isSafeInteger(qty)) return;
    qty = boundedCartQuantity(qty);
    if (qty <= 0) trackEvent("cart_item_removed", { productId: id, reason: "quantity_zero" });
    if (qty <= 0) setUnselected((prev) => prev.filter((x) => x !== id));
    setItems((prev) =>
      qty <= 0
        ? prev.filter((it) => it.product.id !== id)
        : prev.map((it) => (it.product.id === id ? { ...it, qty } : it)),
    );
    rotateCartInstance();
  }, [rotateCartInstance]);

  const clear = useCallback(() => {
    setItems([]);
    setUnselected([]);
    rotateCartInstance();
  }, [rotateCartInstance]);

  const toggleSelected = useCallback((id: string) => {
    setUnselected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    rotateCartInstance();
  }, [rotateCartInstance]);

  // Удалить оформленные (выбранные) позиции, оставив невыбранные в корзине.
  const removeSelected = useCallback(() => {
    setItems((prev) => prev.filter((it) => unselected.includes(it.product.id)));
    setUnselected([]);
    rotateCartInstance();
  }, [unselected, rotateCartInstance]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((s, it) => s + it.qty, 0);
    const subtotal = items.reduce((s, it) => s + it.product.price * it.qty, 0);
    const savings = items.reduce(
      (s, it) => s + (it.product.oldPrice ? (it.product.oldPrice - it.product.price) * it.qty : 0),
      0,
    );
    const selectedItems = items.filter((it) => !unselected.includes(it.product.id));
    const selectedCount = selectedItems.reduce((s, it) => s + it.qty, 0);
    const selectedSubtotal = selectedItems.reduce((s, it) => s + it.product.price * it.qty, 0);
    return {
      items, cartInstanceId, count, subtotal, savings, isOpen,
      add, remove, restore, setQty, clear,
      isSelected: (id: string) => !unselected.includes(id),
      toggleSelected, selectedItems, selectedCount, selectedSubtotal, removeSelected, legacyItemsRemoved, dismissLegacyNotice,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    };
  }, [items, cartInstanceId, unselected, isOpen, add, remove, restore, setQty, clear, toggleSelected, removeSelected, legacyItemsRemoved, dismissLegacyNotice]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
