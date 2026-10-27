// «НДС в ТЗ» по материалу: какая ставка применится при списании материала в ТЗ.
// (а) у материала задана ставка по умолчанию (RawMaterial.defaultVatRate) — она приоритетнее;
// (б) иначе — ставка того лота, из которого списано: сводка по лотам с разбивкой по году закупки.
import { vatRateForDate, VAT_CUTOFF } from "./vat-by-date";

export type MaterialLotVat = { vatRate: number; date: Date };

export type MaterialVatGroup = { rate: number; before2026: number; from2026: number; lots: number };

export type MaterialVatSummary = {
  defaultRate: number | null;
  groups: MaterialVatGroup[];
  /** Лоты, ставка которых расходится с датой закупки. */
  mismatch: number;
  /** Короткий текст для ячейки: «22% (лотов 3) · 20% (лотов 5)». */
  text: string;
  /** Пояснение: откуда берётся ставка. */
  note: string;
};

export function summarizeMaterialVat(defaultRate: number | null, lots: MaterialLotVat[]): MaterialVatSummary {
  const map = new Map<number, MaterialVatGroup>();
  let mismatch = 0;
  for (const l of lots) {
    const g = map.get(l.vatRate) ?? { rate: l.vatRate, before2026: 0, from2026: 0, lots: 0 };
    g.lots += 1;
    if (l.date.getTime() < VAT_CUTOFF.getTime()) g.before2026 += 1;
    else g.from2026 += 1;
    map.set(l.vatRate, g);
    if (vatRateForDate(l.date) !== l.vatRate) mismatch += 1;
  }
  const groups = [...map.values()].sort((a, b) => b.rate - a.rate);
  if (defaultRate != null) {
    return {
      defaultRate,
      groups,
      mismatch,
      text: `${defaultRate}%`,
      note: "Ставка задана у материала: применяется к новым закупкам и строкам ТЗ (приоритетнее ставки лота).",
    };
  }
  if (groups.length === 0) {
    return { defaultRate, groups, mismatch, text: "–", note: "Лотов нет: в ТЗ — ставка лота, а для новой закупки — по дате (до 2026 — 20%, с 2026 — 22%)." };
  }
  return {
    defaultRate,
    groups,
    mismatch,
    text: groups.map((g) => `${g.rate}% (лотов ${g.lots})`).join(" · "),
    note: "В ТЗ — ставка лота, на который списано.",
  };
}
