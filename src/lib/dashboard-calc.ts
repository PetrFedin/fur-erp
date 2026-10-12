// Расчёты Сводки (/dashboard): отбор лотов и ТЗ по фильтрам панели и сборка чисел для блоков.
// Чистые функции без базы и React — их же вызывает scripts/test-dashboard-numbers.ts.
// Сырьё считает src/lib/fur-table.ts (один источник с таблицей «Мех / Подкладка»), ТЗ — строки аналитики (analytics-orders.ts).
import { defineFilters, pick, splitNone } from "@/lib/filters";
import { figures, flowOf, NOT_SET, type C4Kind, type Flow, type FlowFigures, type FurLot } from "@/lib/fur-table";
import type { OrderRow } from "@/lib/analytics-orders";
import { NO_GROUP } from "@/lib/category-groups";
import type { DrillOrder, DrillLine } from "@/lib/dashboard-drill";
import type { YearFilter } from "@/lib/year-filter";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { orderKey } from "@/lib/tz-key";

export const ORDER_STATUS_LABELS: Record<string, string> = { PLANNED: "Запланирован", IN_PROGRESS: "В работе", COMPLETED: "Завершён", CANCELLED: "Отменён" };

// Фильтры Сводки (год — общий, из шапки).
export const DASH_FILTERS = defineFilters({
  ...pick(["auction", "fur", "color", "attr", "batch", "status", "vat", "catgroup"], {
    status: { allowed: Object.keys(ORDER_STATUS_LABELS) },
    batch: { pattern: /^(\d{1,6}|none)$/ },
    vat: { allowed: ["20", "22"] },
  }),
});

export type DashFilters = { auction: string[]; fur: string[]; color: string[]; attr: string[]; batch: string[]; status: string[]; vat: string[]; catgroup: string[] };

export const lotFiltersOn = (f: DashFilters) => Boolean(f.auction.length || f.fur.length || f.color.length || f.attr.length || f.vat.length);
export const orderFiltersOn = (f: DashFilters) => Boolean(f.status.length || f.batch.length || f.catgroup?.length);

// ───────────────────────────── лоты ─────────────────────────────

/** Лот подходит под год (по дате закупки, как lotYear) и фильтры: партия закупки, вид меха, цвет, ставка НДС. */
export function selectLots(lots: FurLot[], year: YearFilter, f: DashFilters, aucIds: Set<string> | null): FurLot[] {
  const colors = splitNone(f.color);
  const vats = f.vat.map(Number);
  return lots.filter((l) => {
    if (year !== "all" && !(l.purchaseId != null && l.year === Number(year))) return false;
    if (aucIds && !(l.purchaseId != null && aucIds.has(l.purchaseId))) return false;
    if (f.fur.length && !(l.kind === "fur" && f.fur.includes(l.item))) return false;
    if (f.color.length && !((colors.none && l.color === NOT_SET) || colors.rest.includes(l.color))) return false;
    if (f.attr.length && !hasAttr(l.attrs, f.attr)) return false;
    if (vats.length && !vats.includes(l.vatRate)) return false;
    return true;
  });
}

/** Признак меха: лот (ТЗ-строка) подходит, если у него есть любой из выбранных признаков; none — признаков нет. */
const hasAttr = (attrs: string[], selected: string[]) => (attrs.length ? attrs.some((a) => selected.includes(a)) : selected.includes("none"));

/** Использовано только по выбранным ТЗ (фильтры «Статус ТЗ» / «Партия производства»): куплено и остаток не меняются. */
export function restrictUsage(lots: FurLot[], orderIds: Set<string> | null): FurLot[] {
  if (!orderIds) return lots;
  return lots.map((l) => {
    const us = l.usages.filter((u) => orderIds.has(u.orderId));
    const sum = (k: "qty" | "incl" | "excl" | "extraIncl" | "extraExcl") => us.reduce((s, u) => s + u[k], 0);
    const used = sum("qty");
    return {
      ...l, used, usedIncl: sum("incl"), usedExcl: sum("excl"), usedExtraIncl: sum("extraIncl"), usedExtraExcl: sum("extraExcl"),
      usdUsedQty: l.usdPrice != null ? used : 0, usdUsedSubtotal: l.usdPrice != null ? used * l.usdPrice : 0,
    };
  });
}

export type Pair<T> = { incl: T; excl: T };
export const figuresPair = (flow: Flow, c4: C4Kind): Pair<FlowFigures> => ({
  incl: figures(flow, { vat: "incl", c4 }),
  excl: figures(flow, { vat: "excl", c4 }),
});

export function furLiningFlows(lots: FurLot[]) {
  return { fur: flowOf(lots.filter((l) => l.kind === "fur")), lining: flowOf(lots.filter((l) => l.kind === "lining")) };
}

// ───────────────────────────── ТЗ ─────────────────────────────

/** ТЗ подходит: статус и партия производства; при фильтрах по сырью — в нём списан хотя бы один подходящий лот. */
export function orderMatches(o: OrderRow, f: DashFilters, aucIds: Set<string> | null, furName: (raw: string) => string): boolean {
  if (f.status.length && !f.status.includes(o.status)) return false;
  if (f.catgroup?.length) {
    const g = splitNone(f.catgroup);
    if (!(o.categoryGroup ? g.rest.includes(o.categoryGroup) : g.none)) return false;
  }
  if (f.batch.length) {
    const b = splitNone(f.batch);
    const nums = b.rest.map(Number);
    const ok = (o.batchNumber == null ? b.none : nums.includes(o.batchNumber));
    if (!ok) return false;
  }
  if (lotFiltersOn(f)) {
    const colors = splitNone(f.color);
    const vats = f.vat.map(Number);
    const any = o.lines.some((l) => {
      if (aucIds && !(l.purchaseId != null && aucIds.has(l.purchaseId))) return false;
      if (f.fur.length && !(!l.isLining && f.fur.includes(furName(l.rawName)))) return false;
      if (f.color.length && !((colors.none && l.lotColor == null) || (l.lotColor != null && colors.rest.includes(l.lotColor)))) return false;
      if (f.attr.length && !(!l.isLining && hasAttr(l.lotAttrs, f.attr))) return false;
      if (vats.length && !vats.includes(l.vat)) return false;
      return true;
    });
    if (!any) return false;
  }
  return true;
}

/** Ремонт — не выпуск изделий: в штуках и числе ТЗ не считается, учитывается отдельно (затраты остаются в себестоимости). */
export const REPAIR_CATEGORY = "Ремонт";

export type ProdTotals = { repairItems: number; items: number; repairOrders: number; repairQty: number; repairCostIncl: number; repairCostExcl: number; orders: number; qty: number; costIncl: number; costExcl: number; workSum: number; furIncl: number; liningIncl: number; c4Incl: number; furExcl: number; liningExcl: number; c4Excl: number; expenses: number };

/** Сводные числа по ТЗ: «произведено» — завершённые, «в работе» — запланированные и в работе. */
export function prodTotals(rows: OrderRow[]): ProdTotals {
  const t: ProdTotals = { repairItems: 0, items: 0, repairOrders: 0, repairQty: 0, repairCostIncl: 0, repairCostExcl: 0, orders: 0, qty: 0, costIncl: 0, costExcl: 0, workSum: 0, furIncl: 0, liningIncl: 0, c4Incl: 0, furExcl: 0, liningExcl: 0, c4Excl: 0, expenses: 0 };
  const own = new Set<string>(), rep = new Set<string>();
  for (const o of rows) {
    if (o.category === REPAIR_CATEGORY) { t.repairItems += 1; rep.add(orderKey({ number: o.number, workOrderNumber: o.workOrderNumber })); t.repairQty += o.qty; t.repairCostIncl += o.costIncl; t.repairCostExcl += o.costExcl; } else { t.items += 1; own.add(orderKey({ number: o.number, workOrderNumber: o.workOrderNumber })); t.qty += o.qty; }
    t.costIncl += o.costIncl; t.costExcl += o.costExcl; t.workSum += o.work;
    t.furIncl += o.furIncl; t.liningIncl += o.liningIncl; t.c4Incl += o.c4Incl;
    t.furExcl += o.furExcl; t.liningExcl += o.liningExcl; t.c4Excl += o.c4Excl; t.expenses += o.expenses;
  }
  // ТЗ — уникальные номера из документа; items — позиции (записи). Суммы и штуки считаются по записям.
  t.orders = own.size;
  t.repairOrders = rep.size;
  return t;
}

export const isDone = (o: OrderRow) => o.status === "COMPLETED";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Строка аналитики → ТЗ для окна «проваливания» (суммы строк в выбранном режиме 4%). */
export function toDrillOrder(o: OrderRow, c4: "on" | "off", auctionShort: (name: string | null) => string, furName: (raw: string) => string = (r) => r): DrillOrder {
  const k = c4 === "on" ? COMMISSION_RATE : 0;
  const lines: DrillLine[] = o.lines.map((l) => {
    const ci = l.c4 ? l.incl * k : 0;
    const ce = l.c4 ? l.excl * k : 0;
    return {
      k: l.isLining ? "l" : "f", n: l.rawName, fu: l.isLining ? "" : furName(l.rawName), lot: l.lotId, ln: l.lotNumber, au: auctionShort(l.auction),
      pid: l.purchaseId, pn: l.purchaseNumber, q: l.qty, i: l.incl + ci, e: l.excl + ce, ci, ce,
    };
  });
  const sumI = lines.reduce((s, l) => s + l.i, 0);
  const sumE = lines.reduce((s, l) => s + l.e, 0);
  return {
    id: o.id, number: o.number, wo: o.workOrderNumber, bk: o.batchNumber == null ? "none" : String(o.batchNumber),
    bl: o.batchText ?? "Без партии", y: o.year, st: o.status, cat: o.category, grp: o.category === REPAIR_CATEGORY ? "Ремонт (отдельно)" : o.categoryGroup || NO_GROUP, mid: o.modelId, ml: o.modelLabel, fur: o.fur,
    qty: o.qty, work: o.work, exp: o.expenses, hI: 0, hE: 0, resI: r2(o.costIncl - sumI - o.expenses), resE: r2(o.costExcl - sumE - o.expenses), lines,
  };
}
