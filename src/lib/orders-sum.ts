// Суммы по ТЗ в формате Главной (чистые функции, без базы): мех (с шкурами подрядчика), подкладка, 4%, расходы и прочее, работа.
// Ремонт — не изделия: в «Произведено» и штуках не считается (src/lib/production-totals.ts), затраты остаются в себестоимости.
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import { atomsOf, type DrillOrder } from "@/lib/dashboard-drill";

export type VatSel = "incl" | "excl";
export type Sum = {
  /** ТЗ без ремонта. */
  orders: number;
  repairOrders: number;
  /** Произведено, шт. (без ремонта). */
  qty: number;
  repairQty: number;
  fur: number;
  lining: number;
  c4: number;
  /** Расходы ТЗ и прочее (разница снимка и строк). */
  other: number;
  work: number;
};

export const isRepair = (o: DrillOrder) => o.cat === REPAIR_CATEGORY;
export const blankSum = (): Sum => ({ orders: 0, repairOrders: 0, qty: 0, repairQty: 0, fur: 0, lining: 0, c4: 0, other: 0, work: 0 });
/** Себестоимость вместе с работой — как «Себестоимость» на Главной. */
export const sumTotal = (s: Sum) => s.fur + s.lining + s.c4 + s.other + s.work;

export function addTo(s: Sum, o: DrillOrder, vat: VatSel): Sum {
  if (isRepair(o)) { s.repairOrders += 1; s.repairQty += o.qty; } else { s.orders += 1; s.qty += o.qty; }
  s.work += o.work;
  for (const a of atomsOf(o)) {
    const v = vat === "incl" ? a.i : a.e;
    const c = vat === "incl" ? a.ci : a.ce;
    if (a.k === "f" || a.k === "h") s.fur += v - c;
    else if (a.k === "l") s.lining += v - c;
    else s.other += v;
    if (a.k === "f" || a.k === "l") s.c4 += c;
  }
  return s;
}

export function sumOrders(os: DrillOrder[], vat: VatSel): Sum {
  const s = blankSum();
  for (const o of os) addTo(s, o, vat);
  return s;
}
