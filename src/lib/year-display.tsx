"use client";

// Общий переключатель года в шапке. Данные фильтруются на сервере, поэтому
// выбор пишет cookie и обновляет серверные компоненты (как переключатель 4%).
import { createContext, useContext, useState, useCallback, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { YearFilter } from "./year-filter";

const COOKIE_NAME = "yearFilter";

const Ctx = createContext<{ year: YearFilter; setYear: (y: YearFilter) => void; pending: boolean } | null>(null);

export function YearDisplayProvider({ initialYear, children }: { initialYear: YearFilter; children: ReactNode }) {
  const [year, setYearState] = useState<YearFilter>(initialYear);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const setYear = useCallback(
    (y: YearFilter) => {
      setYearState(y);
      document.cookie = `${COOKIE_NAME}=${y}; path=/; max-age=31536000; samesite=lax`;
      startTransition(() => router.refresh());
    },
    [router],
  );

  return <Ctx.Provider value={{ year, setYear, pending }}>{children}</Ctx.Provider>;
}

export function useYearDisplay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useYearDisplay must be used within YearDisplayProvider");
  return ctx;
}
