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

/**
 * ЕДИНСТВЕННОЕ место итога производства для экрана: плитка «Полная себестоимость» и строка «Всего» под списком берут числа отсюда.
 * Основной итог — со всеми ТЗ (ремонт включён, как на Главной); «без ремонта» (изделия) нужен для «На 1 изделие» и лежит в подсказке «i».
 */
export function showTotals(orders: DrillOrder[], vat: VatSel) {
  const all = sumOrders(orders, vat);
  const own = sumOrders(orders.filter((o) => !isRepair(o)), vat);
  const total = sumTotal(all);
  const totalOwn = sumTotal(own);
  return { all, own, total, totalOwn, repair: total - totalOwn };
}

/**
 * Облегчённая копия ТЗ для плиток итогов (ProdTiles): плиткам нужны только суммы по атомам, поэтому строки списаний одного вида
 * (мех / подкладка) схлопываются в одну с теми же суммами, количеством и долей 4%; названия, лоты и партии закупки не передаются в браузер.
 * Суммы плиток те же (sumOrders считает по атомам); подробный состав остаётся в OrdersTree, которому нужны полные ТЗ.
 */
export function slimForTiles(orders: DrillOrder[]): DrillOrder[] {
  return orders.map((o) => {
    const lines: DrillOrder["lines"] = [];
    for (const k of ["f", "l"] as const) {
      const part = o.lines.filter((l) => l.k === k);
      if (part.length === 0) continue;
      lines.push({
        k, n: "", fu: "", lot: "", ln: null, au: "", pid: null, pn: null,
        q: part.reduce((a, l) => a + l.q, 0),
        i: part.reduce((a, l) => a + l.i, 0),
        e: part.reduce((a, l) => a + l.e, 0),
        ci: part.reduce((a, l) => a + l.ci, 0),
        ce: part.reduce((a, l) => a + l.ce, 0),
      });
    }
    return { id: o.id, number: o.number, wo: o.wo, bk: "", bl: "", y: o.y, st: o.st, cat: o.cat, grp: o.grp, mid: "", ml: "", fur: "", qty: o.qty, work: o.work, exp: o.exp, hI: o.hI, hE: o.hE, resI: o.resI, resE: o.resE, lines };
  });
}

/** «В выпуске» = готово (завершённые ТЗ) + в работе (план ТЗ «В работе» / «Запланировано»); без ремонта. Только для подписи-расшифровки, итоги не затрагивает. */
export function outputSplit(os: DrillOrder[]): { done: number; inWork: number } {
  let done = 0, inWork = 0;
  for (const o of os) {
    if (isRepair(o)) continue;
    if (o.st === "COMPLETED") done += o.qty; else inWork += o.qty;
  }
  return { done, inWork };
}
