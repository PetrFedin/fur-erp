"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setMoneyEur } from "@/lib/money-currency";

// Валюта показа денег на Главной: ₽ или € (по курсу 110, пока курс не известен по документам закупки меха). Только экран: данные остаются в рублях.
// Форматеры денег (formatMoney и др.) читают флаг из src/lib/money-currency.ts; при смене валюты вся Главная перемонтируется (key), чтобы все суммы пересчитались.
// Выбранный сезон хранится здесь (выше границы key), поэтому при смене валюты сезон не сбрасывается.
type Cur = "rub" | "eur";
const Ctx = createContext<{ cur: Cur; setCur: (c: Cur) => void; season: string; setSeason: (s: string) => void }>({ cur: "rub", setCur: () => {}, season: "all", setSeason: () => {} });
export const useDashCurrency = () => useContext(Ctx);

/** Подписи единиц («Цена, ₽/шт.», «Всего, ₽») в режиме «€»: заменяем ₽ только в текстовых узлах без цифр, суммы не трогаем. */
function relabel(root: Node) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const v = n.nodeValue ?? "";
    if (v.includes("₽") && !/\d/.test(v)) n.nodeValue = v.replace(/₽/g, "€");
  }
}

export function DashCurrency({ children }: { children: React.ReactNode }) {
  const [cur, setCur] = useState<Cur>("rub");
  const [season, setSeason] = useState("all");
  const ref = useRef<HTMLDivElement>(null);
  setMoneyEur(cur === "eur");
  // Уход с Главной возвращает рубли для остальных страниц: при закрытии и при клике по ссылке на другую страницу (до того, как та отрисуется).
  useEffect(() => {
    const off = () => setMoneyEur(false);
    const onClick = (e: MouseEvent) => { const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null; if (a && a.pathname !== window.location.pathname) off(); };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", off);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("popstate", off); off(); };
  }, []);
  useLayoutEffect(() => {
    const root = ref.current;
    if (cur !== "eur" || !root) return;
    relabel(root);
    const mo = new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") relabel(m.target.parentNode ?? root); else m.addedNodes.forEach((n) => relabel(n)); } });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [cur]);
  return <Ctx.Provider value={{ cur, setCur, season, setSeason }}><div key={cur} ref={ref}>{children}</div></Ctx.Provider>;
}

/** Пометка у блока, который считается на сервере и пока не переключается в €: в режиме «€» напоминает, что суммы в рублях. */
export function RubOnlyNote() {
  const { cur } = useDashCurrency();
  return cur === "eur" ? <span className="text-xs text-neutral-600" title="Суммы этого блока считаются на сервере и показаны в рублях">суммы в рублях</span> : null;
}
