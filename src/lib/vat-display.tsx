"use client";

// Site-wide "С НДС / Без НДС" toggle. AppLayout reads the persisted cookie
// server-side and passes it as `initialMode`, so the first paint already
// matches the viewer's last choice (no client-only flash). Money amounts
// themselves are always computed server-side (both incl- and excl-VAT
// figures, from real stored fields) and handed to the client-only <Money>
// component, which just picks which one to render — the toggle never
// recomputes anything itself, it only switches which already-correct number
// is shown.
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { VatMode } from "./vat-mode";
import { writeCookie } from "./cookie-write";

export type { VatMode } from "./vat-mode";

const COOKIE_NAME = "vatDisplay";

const VatDisplayContext = createContext<{ mode: VatMode; setMode: (m: VatMode) => void } | null>(null);

export function VatDisplayProvider({
  initialMode,
  children,
}: {
  initialMode: VatMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<VatMode>(initialMode);

  const setMode = useCallback((m: VatMode) => {
    setModeState(m);
    writeCookie(COOKIE_NAME, m);
  }, []);

  return <VatDisplayContext.Provider value={{ mode, setMode }}>{children}</VatDisplayContext.Provider>;
}

export function useVatDisplay() {
  const ctx = useContext(VatDisplayContext);
  if (!ctx) throw new Error("useVatDisplay must be used within VatDisplayProvider");
  return ctx;
}
