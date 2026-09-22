"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ScannerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const ScannerContext = createContext<ScannerContextValue | null>(null);

export function ScannerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return <ScannerContext.Provider value={{ isOpen, open, close }}>{children}</ScannerContext.Provider>;
}

export function useScanner() {
  const ctx = useContext(ScannerContext);
  if (!ctx) throw new Error("useScanner must be used within <ScannerProvider>");
  return ctx;
}
