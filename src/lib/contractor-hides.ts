/**
 * Шкуры подрядчика, оплаченные в составе счетов за пошив и не списанные в ТЗ (остаток, на который нет закупки).
 * По документам (примечания к платежам):
 *  • п/п №22618 от 21.01.2026, счёт №1 — партия 7: остаток 189 966,22 ₽ (ТЗ 79 — 25 040 ₽, остальное — мелкие шкуры партии 7);
 *  • п/п №82173 от 27.11.2025 — партия 8: остаток аванса 32 918,56 ₽ — шкуры подрядчика партии 8 (закупки на них нет).
 * Сумма берётся из оплат (по году платежа), здесь — только к какой партии и ТЗ она относится. По ТЗ внутри партии, кроме закреплённого,
 * делится пропорционально изделиям (условно: по документам разбивки по ТЗ нет).
 */
export const HIDES_ALLOC: { batch: string; payYear: number; vat: number; pin?: { order: string; amount: number } }[] = [
  { batch: "7", payYear: 2026, vat: 1.22, pin: { order: "П-2026-0079", amount: 25040 } },
  { batch: "8", payYear: 2025, vat: 1.2 },
];

export type HidesOrder = { id: string; number: string; batch: string; qty: number };
export type HidesShare = { id: string; payYear: number; incl: number; excl: number };

/** Шкуры подрядчика по выбранным ТЗ: сумма берётся из оплат по году платежа, делится по партиям и ТЗ (закреплённый ТЗ — по документам, остальные — по изделиям). */
export function allocateHides(orders: HidesOrder[], hidesByPayYear: Map<number, number>, year: "all" | `${number}`): HidesShare[] {
  const out: HidesShare[] = [];
  for (const h of HIDES_ALLOC) {
    if (year !== "all" && Number(year) !== h.payYear) continue;
    const total = hidesByPayYear.get(h.payYear) ?? 0;
    const inBatch = orders.filter((o) => o.batch === h.batch);
    if (total <= 0 || inBatch.length === 0) continue;
    const pinned = h.pin ? inBatch.find((o) => o.number === h.pin!.order) : undefined;
    const pinAmt = pinned ? Math.min(h.pin!.amount, total) : 0;
    if (pinned) out.push({ id: pinned.id, payYear: h.payYear, incl: pinAmt, excl: pinAmt / h.vat });
    const rest = total - pinAmt;
    const others = inBatch.filter((o) => o !== pinned);
    const qtySum = others.reduce((a, o) => a + o.qty, 0);
    for (const o of others) {
      const v = qtySum > 0 ? rest * (o.qty / qtySum) : rest / others.length;
      out.push({ id: o.id, payYear: h.payYear, incl: v, excl: v / h.vat });
    }
  }
  return out;
}

/** Годы оплат, суммы шкур подрядчика (с НДС) — из списка оплат «Все». */
export const hidesByPayYear = (rows: { year: number; hides: number }[]) => {
  const m = new Map<number, number>();
  for (const r of rows) if (r.hides > 0) m.set(r.year, (m.get(r.year) ?? 0) + r.hides);
  return m;
};

/** Шкуры подрядчика не привязаны к аукциону, цвету, признаку и ставке НДС и относятся только к свакаре. */
export const hidesApply = (f: { auction: string[]; fur: string[]; color: string[]; attr: string[]; vat: string[] }) =>
  !(f.auction.length || f.color.length || f.attr.length || f.vat.length) && (f.fur.length === 0 || f.fur.includes("Свакара"));
