"use client";
// Сортировка небольших таблиц-окон по клику на подпись столбца (▲ ↓ ▼ ↓ без сортировки): значения берутся из того, что показано в ячейке.
// Числа распознаются из текста («1 234 шт.», «12,5 %», «×3,49», «−7 млн ₽»), остальное сравнивается как русский текст с «натуральными» номерами.
import { isValidElement, useMemo, useState, type ReactNode } from "react";
import { SortMark } from "@/components/table-head";

/** Текст, который видит человек в ячейке (строки, числа, вложенные элементы). */
export function textOf(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return "";
}

/** «1 234,5 ₽» → 1234.5; «–» и пустое → null; не число → null. */
export function numFrom(t: string): number | null {
  const s = t.replace(/[ \s]/g, "").replace(/^[×x]/, "").replace(/−/g, "-");
  const m = /^(-?\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  let v = Number(m[1].replace(",", "."));
  if (/^-?\d[\d.,]*(млн|млрд|тыс)/.test(s)) v *= /млрд/.test(s) ? 1e9 : /млн/.test(s) ? 1e6 : 1e3;
  return Number.isFinite(v) ? v : null;
}

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
type St = { col: number; dir: "asc" | "desc" } | null;

export function useMiniSort(rows: ReactNode[][]) {
  const [st, setSt] = useState<St>(null);
  const sorted = useMemo(() => {
    if (!st) return rows;
    const sign = st.dir === "desc" ? -1 : 1;
    return rows
      .map((r, i) => { const t = textOf(r[st.col]); return { r, i, t, n: numFrom(t) }; })
      .sort((a, b) => {
        const ae = a.t.trim() === "" || a.t.trim() === "–", be = b.t.trim() === "" || b.t.trim() === "–";
        if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1;
        const c = a.n != null && b.n != null ? a.n - b.n : collator.compare(a.t, b.t);
        return sign * c || a.i - b.i;
      })
      .map((x) => x.r);
  }, [rows, st]);
  const click = (col: number) => setSt((c) => (c?.col === col ? (c.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" }));
  return { rows: sorted, st, click };
}

/** Подпись-кнопка столбца для окон-таблиц. */
export function MiniSortTh({ label, col, st, click, left }: { label: ReactNode; col: number; st: St; click: (c: number) => void; left?: boolean }) {
  const dir = st?.col === col ? st.dir : "none";
  return (
    <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined} className={"px-2 py-0 text-xs font-semibold " + (left ? "text-left" : "text-right")}>
      <button type="button" onClick={() => click(col)} className="inline-flex min-h-11 items-center gap-0.5 whitespace-nowrap hover:underline">{label}<SortMark dir={dir} /></button>
    </th>
  );
}
