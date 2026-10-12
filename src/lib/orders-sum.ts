// Суммы по ТЗ в формате Главной (чистые функции, без базы): мех (с шкурами подрядчика), подкладка, 4%, расходы и прочее, работа.
// Ремонт — не изделия: в «Произведено» и штуках не считается (src/lib/production-totals.ts), затраты остаются в себестоимости.
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import { atomsOf, type DrillOrder } from "@/lib/dashboard-drill";
import { orderKey } from "@/lib/tz-key";

export type VatSel = "incl" | "excl";
export type Sum = {
  /** Уникальные ТЗ (по номеру ТЗ из документа) без ремонта. */
  orders: number;
  repairOrders: number;
  /** Позиции (записи, артикулы в ТЗ) без ремонта. */
  items: number;
  repairItems: number;
  /** Произведено, шт. (без ремонта). */
  qty: number;
  repairQty: number;
  fur: number;
  lining: number;
  c4: number;
  /** Расходы ТЗ и прочее (разница снимка и строк) = exp + остаток снимка. */
  other: number;
  /** Из other: расходы ТЗ (ProductionExpense, «доп. расходы»). Остаток снимка = other − exp. */
  exp: number;
  /** Использовано по лотам: шкуры меха, шт. */
  furQ: number;
  /** Использовано по лотам: подкладка, м. */
  liningQ: number;
  work: number;
};

export const isRepair = (o: DrillOrder) => o.cat === REPAIR_CATEGORY;
export const blankSum = (): Sum => ({ orders: 0, repairOrders: 0, items: 0, repairItems: 0, qty: 0, repairQty: 0, fur: 0, lining: 0, c4: 0, other: 0, exp: 0, furQ: 0, liningQ: 0, work: 0 });
/** Себестоимость вместе с работой — как «Себестоимость» на Главной. */
export const sumTotal = (s: Sum) => s.fur + s.lining + s.c4 + s.other + s.work;

function addTo(s: Sum, o: DrillOrder, vat: VatSel): Sum {
  if (isRepair(o)) { s.repairItems += 1; s.repairQty += o.qty; } else { s.items += 1; s.qty += o.qty; }
  s.work += o.work;
  for (const a of atomsOf(o)) {
    const v = vat === "incl" ? a.i : a.e;
    const c = vat === "incl" ? a.ci : a.ce;
    if (a.k === "f" || a.k === "h") s.fur += v - c;
    else if (a.k === "l") s.lining += v - c;
    else { s.other += v; if (a.k === "e") s.exp += v; }
    if (a.k === "f") s.furQ += a.q;
    else if (a.k === "l") s.liningQ += a.q;
    if (a.k === "f" || a.k === "l") s.c4 += c;
  }
  return s;
}

export function sumOrders(os: DrillOrder[], vat: VatSel): Sum {
  const s = blankSum();
  const own = new Set<string>(), rep = new Set<string>();
  for (const o of os) { addTo(s, o, vat); (isRepair(o) ? rep : own).add(orderKey(o)); }
  // ТЗ считаем по уникальным номерам из документа (один ТЗ с несколькими артикулами — одно ТЗ), суммы — по записям.
  s.orders = own.size;
  s.repairOrders = rep.size;
  return s;
}
