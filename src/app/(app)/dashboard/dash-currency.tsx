"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setMoneyEur } from "@/lib/money-currency";

// Валюта показа денег на Главной: ₽ или € (по курсу 110, пока курс не известен по документам закупки меха). Только экран: данные остаются в рублях.
// Форматеры денег (formatMoney и др.) читают флаг из src/lib/money-currency.ts; при смене валюты вся Главная перемонтируется (key), чтобы все суммы пересчитались.
type Cur = "rub" | "eur";
const Ctx = createContext<{ cur: Cur; setCur: (c: Cur) => void }>({ cur: "rub", setCur: () => {} });
export const useDashCurrency = () => useContext(Ctx);

export function DashCurrency({ children }: { children: React.ReactNode }) {
  const [cur, setCur] = useState<Cur>("rub");
  setMoneyEur(cur === "eur");
  // Уход с Главной (или закрытие) возвращает рубли для остальных страниц.
  useEffect(() => () => setMoneyEur(false), []);
  return <Ctx.Provider value={{ cur, setCur }}><div key={cur}>{children}</div></Ctx.Provider>;
}
