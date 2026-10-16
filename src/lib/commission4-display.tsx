"use client";

// Site-wide «Без 4% | С 4%» toggle. Unlike the VAT toggle, 4% changes the
// numbers themselves (computed server-side from stored usages), so switching
// writes the cookie and refreshes the server components.
import { createContext, useContext, useState, useCallback, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { writeCookie } from "./cookie-write";
import type { Commission4Mode } from "./commission4-mode";

const COOKIE_NAME = "commission4Display";

const Ctx = createContext<{ mode: Commission4Mode; setMode: (m: Commission4Mode) => void; pending: boolean } | null>(null);

export function Commission4DisplayProvider({ initialMode, children }: { initialMode: Commission4Mode; children: ReactNode }) {
  const [mode, setModeState] = useState<Commission4Mode>(initialMode);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setMode = useCallback(
    (m: Commission4Mode) => {
      setModeState(m);
      writeCookie(COOKIE_NAME, m);
      // Быстрые нажатия подряд: обновление страницы одно, после короткой паузы (иначе гонка нескольких router.refresh).
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => startTransition(() => router.refresh()), 250);
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
