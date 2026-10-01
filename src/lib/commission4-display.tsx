"use client";

// Site-wide «Без 4% | С 4%» toggle. Unlike the VAT toggle, 4% changes the
// numbers themselves (computed server-side from stored usages), so switching
// writes the cookie and refreshes the server components.
import { createContext, useContext, useState, useCallback, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Commission4Mode } from "./commission4-mode";

const COOKIE_NAME = "commission4Display";

const Ctx = createContext<{ mode: Commission4Mode; setMode: (m: Commission4Mode) => void; pending: boolean } | null>(null);

export function Commission4DisplayProvider({ initialMode, children }: { initialMode: Commission4Mode; children: ReactNode }) {
  const [mode, setModeState] = useState<Commission4Mode>(initialMode);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const setMode = useCallback(
    (m: Commission4Mode) => {
      setModeState(m);
      document.cookie = `${COOKIE_NAME}=${m}; path=/; max-age=31536000; samesite=lax`;
      startTransition(() => router.refresh());
    },
    [router],
  );

  return <Ctx.Provider value={{ mode, setMode, pending }}>{children}</Ctx.Provider>;
}

export function useCommission4Display() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommission4Display must be used within Commission4DisplayProvider");
  return ctx;
}
