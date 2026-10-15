// Таблица «ТЗ артикула и их состав»: по строке на ТЗ, статьи — столбцами в одном порядке; итог = сумма строк.
// Чистые функции без базы и React: их вызывает карточка артикула и проверочный скрипт scripts/test-article-tz-table.ts.
//
// Деньги округляются до рубля методом наибольших остатков внутри столбца: сумма округлённых строк равна округлённому
// итогу столбца (то есть тому, что показывают плитки), и на экране «Итого» строго равно сумме строк. Итог строки — сумма её статей.
import { isRepair, sumOrders, type VatSel } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";

export const MONEY_COLS = ["fur", "lining", "c4", "other", "work"] as const;
export type MoneyCol = (typeof MONEY_COLS)[number];

export type TzTableRow = {
  id: string;
  /** Изделий, шт. */
  qty: number;
  /** Шкур меха и подкладка, м (по строкам списания; шкуры подрядчика сюда не входят). */
  furQ: number;
  liningQ: number;
  fur: number;
  lining: number;
  c4: number;
  /** Расходы ТЗ и прочее. */
  other: number;
  work: number;
  /** Сумма статей строки. */
  total: number;
  /** Нет списания меха и нет шкур подрядчика: расход не заполнен. */
  noFur: boolean;
};

export type TzTable = {
  rows: TzTableRow[];
  /** Итого = сумма строк. */
  total: TzTableRow;
  /** Итого ÷ изделий (null, если изделий нет). */
  perUnit: Omit<TzTableRow, "id" | "noFur"> | null;
  /** Точная (не округлённая) сумма из плиток, для сверки: разница с `total.total` — только от округления до рубля. */
  exactTotal: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Округление до целых методом наибольших остатков: Σ результата = round(Σ значений). */
export function roundKeepingSum(values: number[]): number[] {
  const target = Math.round(values.reduce((a, b) => a + b, 0));
  const floors = values.map(Math.floor);
  let need = target - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  for (let k = 0; need > 0 && k < order.length; k++, need--) out[order[k].i] += 1;
  for (let k = order.length - 1; need < 0 && k >= 0; k--, need++) out[order[k].i] -= 1;
  return out;
}

export function buildTzTable(all: DrillOrder[], vat: VatSel): TzTable {
  const list = all.filter((o) => !isRepair(o));
  const sums = list.map((o) => sumOrders([o], vat));
  const cols = {} as Record<MoneyCol, number[]>;
  for (const c of MONEY_COLS) cols[c] = roundKeepingSum(sums.map((s) => s[c]));
  const rows: TzTableRow[] = list.map((o, i) => {
    const s = sums[i];
    const row = {
      id: o.id, qty: r2(s.qty), furQ: r2(s.furQ), liningQ: r2(s.liningQ),
      fur: cols.fur[i], lining: cols.lining[i], c4: cols.c4[i], other: cols.other[i], work: cols.work[i],
      total: 0, noFur: s.furQ <= 0 && o.hI <= 0,
    };
    row.total = row.fur + row.lining + row.c4 + row.other + row.work;
    return row;
  });
  const sum = (pick: (r: TzTableRow) => number) => r2(rows.reduce((a, r) => a + pick(r), 0));
  const total: TzTableRow = {
    id: "total", qty: sum((r) => r.qty), furQ: sum((r) => r.furQ), liningQ: sum((r) => r.liningQ),
    fur: sum((r) => r.fur), lining: sum((r) => r.lining), c4: sum((r) => r.c4), other: sum((r) => r.other), work: sum((r) => r.work),
    total: sum((r) => r.total), noFur: false,
  };
  const q = total.qty;
  const per = (v: number) => v / q;
  const perUnit = q > 0
    ? { qty: 1, furQ: per(total.furQ), liningQ: per(total.liningQ), fur: per(total.fur), lining: per(total.lining), c4: per(total.c4), other: per(total.other), work: per(total.work), total: per(total.total) }
    : null;
  const exact = sumOrders(list, vat);
  return { rows, total, perUnit, exactTotal: exact.fur + exact.lining + exact.c4 + exact.other + exact.work };
}
