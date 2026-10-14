/** Сравнение окончательного расчёта с предварительным (чистая логика): итого и по лотам «за шкуру было → стало». */
import { calcAll, rowFilled, type CalcPayload } from "@/lib/supplier-calc";

export type CompareRow = {
  lot: string; fur: string;
  qtyBefore: number | null; qtyAfter: number | null;
  unitBefore: number | null; unitAfter: number | null;
  totalBefore: number | null; totalAfter: number | null;
};
export type CalcComparison = { totalBefore: number; totalAfter: number; diff: number; qtyBefore: number; qtyAfter: number; rows: CompareRow[] };

const key = (lot: string, fur: string) => `${lot.trim().toLowerCase()}|${fur.trim().toLowerCase()}`;

function lines(p: CalcPayload) {
  const t = calcAll(p);
  return p.rows.map((r, i) => ({ r, c: t.calcs[i] })).filter(({ r }) => rowFilled(r)).map(({ r, c }) => ({
    lot: (r.lot ?? "").trim(), fur: (r.fur ?? "").trim(), qty: t.qtys[p.rows.indexOf(r)] ?? 0, unit: c.unitRub, total: c.totalRub,
  }));
}

export function compareCalcs(before: CalcPayload, after: CalcPayload): CalcComparison {
  const a = lines(before), b = lines(after);
  const taken = new Set<number>();
  const rows: CompareRow[] = [];
  for (const x of b) {
    // совпадение по лоту и меху; повторяющиеся лоты берутся по порядку
    const j = a.findIndex((y, k) => !taken.has(k) && key(y.lot, y.fur) === key(x.lot, x.fur));
    if (j >= 0) taken.add(j);
    const y = j >= 0 ? a[j] : null;
    rows.push({ lot: x.lot, fur: x.fur, qtyBefore: y ? y.qty : null, qtyAfter: x.qty, unitBefore: y ? y.unit : null, unitAfter: x.unit, totalBefore: y ? y.total : null, totalAfter: x.total });
  }
  a.forEach((y, k) => {
    if (!taken.has(k)) rows.push({ lot: y.lot, fur: y.fur, qtyBefore: y.qty, qtyAfter: null, unitBefore: y.unit, unitAfter: null, totalBefore: y.total, totalAfter: null });
  });
  const tb = calcAll(before), ta = calcAll(after);
  return { totalBefore: tb.totalRub, totalAfter: ta.totalRub, diff: ta.totalRub - tb.totalRub, qtyBefore: tb.qty, qtyAfter: ta.qty, rows };
}
