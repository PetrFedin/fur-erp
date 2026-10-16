"use client";

// Общий переключатель года в шапке. Данные фильтруются на сервере, поэтому
// выбор пишет cookie и обновляет серверные компоненты (как переключатель 4%).
import { createContext, useContext, useState, useCallback, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { writeCookie } from "./cookie-write";
import type { YearFilter } from "./year-filter";

const COOKIE_NAME = "yearFilter";

const Ctx = createContext<{ year: YearFilter; setYear: (y: YearFilter) => void; pending: boolean; years: string[] } | null>(null);

export function YearDisplayProvider({ initialYear, years, children }: { initialYear: YearFilter; years: string[]; children: ReactNode }) {
  const [year, setYearState] = useState<YearFilter>(initialYear);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setYear = useCallback(
    (y: YearFilter) => {
      setYearState(y);
      writeCookie(COOKIE_NAME, y);
      // Быстрые нажатия подряд: обновление страницы одно, после короткой паузы (иначе гонка нескольких router.refresh).
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => startTransition(() => router.refresh()), 250);
    },
    [router],
  );

  return <Ctx.Provider value={{ year, setYear, pending, years }}>{children}</Ctx.Provider>;
}

export function useYearDisplay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useYearDisplay must be used within YearDisplayProvider");
  return ctx;
}
