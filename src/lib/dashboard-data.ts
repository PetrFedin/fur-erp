import "server-only";
// Загрузка данных Сводки (/dashboard): всё, что нужно блокам, одним набором параллельных запросов.
// Расчёты — в dashboard-calc.ts (чистые функции), сырьё — fur-table.ts, ТЗ — analytics-orders.ts, долг — supplier-debt.ts.
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import { figures, flowOf, type C4Kind, type FlowFigures, type FurLot } from "@/lib/fur-table";
import { orderUnits } from "@/lib/production-totals";
import { loadOrderRows, type OrderRow } from "@/lib/analytics-orders";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { auctionLabeler, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { loadDebtInputs, supplierDebtFromInputs, type SupplierDebt } from "@/lib/supplier-debt";
import { loadControlCounts, type ControlCounts } from "@/lib/control-counts";
import { YEARS, type YearFilter } from "@/lib/year-filter";
import type { Commission4Mode } from "@/lib/commission4-mode";
import {
  figuresPair, furLiningFlows, isDone, orderMatches, prodTotals, restrictUsage, selectLots, toDrillOrder, orderFiltersOn,
  type DashFilters, type Pair, type ProdTotals,
} from "@/lib/dashboard-calc";
import type { DrillOrder } from "@/lib/dashboard-drill";

/** Девять чисел строки «куплено / использовано / остаток»: шт, ₽, средневзвешенная ₽/шт. */
export type Cells = { rq: number; rv: number; ra: number | null; uq: number; uv: number; ua: number | null; mq: number; mv: number; ma: number | null };
const cellsOf = (f: FlowFigures): Cells => ({ rq: f.recvQty, rv: f.recvValue, ra: f.recvAvg, uq: f.usedQty, uv: f.usedValue, ua: f.usedAvg, mq: f.remQty, mv: f.remValue, ma: f.remAvg });
export type CellsPair = Pair<Cells>;
const cellsPair = (lots: FurLot[], c4: C4Kind): CellsPair => {
  const fl = flowOf(lots);
  return { incl: cellsOf(figures(fl, { vat: "incl", c4 })), excl: cellsOf(figures(fl, { vat: "excl", c4 })) };
};

export type RawTableRow = { key: string; label: string; kind: "fur" | "lining"; cells: CellsPair; auctions: { key: string; label: string; cells: CellsPair }[]; lots: number };
export type YearRow = {
  key: string;
  label: string;
  fur: CellsPair;
  lining: CellsPair;
  prod: { qty: number; costIncl: number; costExcl: number; work: number };
  paid: number;
  debt: number;
};

export type ClientDebtRow = { clientId: string; clientName: string; billable: number; paid: number; balance: number; unpricedOrders: number; orders: number };

export type DashboardData = {
  c4: Commission4Mode;
  raw: { fur: Pair<FlowFigures>; lining: Pair<FlowFigures>; lots: number };
  prod: { done: ProdTotals; work: ProdTotals };
  rawTable: RawTableRow[];
  rawTableTotal: CellsPair;
  years: YearRow[];
  debt: SupplierDebt;
  supplierCashPaid: number;
  clientDebts: ClientDebtRow[];
  invoiceDeadlines: { auction: string; date: string; amount: number }[];
  control: ControlCounts | null;
  options: Awaited<ReturnType<typeof getFilterOptions<"auction" | "fur" | "color" | "batch">>>;
  noColorLots: number;
  /** ID выбранных ТЗ (для окна «стоимость производства»). */
  orderIds: string[];
  furTotalLots: number;
};

export const furNameFn = async (orgId: string) => {
  const idx = await getFurIndex(orgId);
  return (raw: string) => canonicalFur(raw, idx)?.name ?? raw;
};

/** Выбранные ТЗ (все годы либо год шапки) по фильтрам панели. */
export async function loadSelectedOrders(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode) {
  const [rows, furName, aucIds] = await Promise.all([
    loadOrderRows(orgId, year, c4),
    furNameFn(orgId),
    f.auction.length ? purchaseIdsByAuction(orgId, f.auction).then((a) => new Set(a)) : Promise.resolve(null),
  ]);
  return { selected: rows.filter((o) => orderMatches(o, f, aucIds, furName)), aucIds, furName };
}

/** Окно «Стоимость производства»: ТЗ выбранной группы (done — произведено, work — в работе) в режиме 4% из cookie. */
export async function loadDrillOrders(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode, scope: "done" | "work"): Promise<DrillOrder[]> {
  const [{ selected }, label] = await Promise.all([loadSelectedOrders(orgId, year, f, c4), auctionLabeler(orgId)]);
  const short = (name: string | null) => (name ? label(name).label : "Без аукциона");
  return selected.filter((o) => (scope === "done" ? isDone(o) : !isDone(o))).map((o) => toDrillOrder(o, c4, short));
}

const DEADLINE_RE = /срок\s+(\d{2})\.(\d{2})\.(\d{4})/i;

export async function loadDashboard(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode): Promise<DashboardData> {
  const furIdx = await getFurIndex(orgId);
  const [furLotsAll, liningLotsAll, ordersAll, debtInputs, options, noColorLots, control, aucIds, labeler] = await Promise.all([
    loadFurLots(prisma, orgId, { kind: "fur", year: "all", furIdx }),
    loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx }),
    loadOrderRows(orgId, "all", c4),
    loadDebtInputs(prisma, orgId),
    getFilterOptions(orgId, year, ["auction", "fur", "color", "batch"]),
    prisma.rawMaterialLot.count({ where: { organizationId: orgId, colorRefId: null, color: null } }),
    loadControlCounts(orgId, year).catch(() => null),
    f.auction.length ? purchaseIdsByAuction(orgId, f.auction).then((a) => new Set(a)) : Promise.resolve(null),
    auctionLabeler(orgId),
  ]);
  const furName = (raw: string) => canonicalFur(raw, furIdx)?.name ?? raw;
  const c4k: C4Kind = c4;

  // ТЗ: все годы → отбор по фильтрам панели → год шапки (год ТЗ по year-scope.ts уже в row.year).
  const ordersFiltered = ordersAll.filter((o) => orderMatches(o, f, aucIds, furName));
  const ordersYear = year === "all" ? ordersFiltered : ordersFiltered.filter((o) => o.year === Number(year));
  const orderIdsForUsage = orderFiltersOn(f) ? new Set(ordersFiltered.map((o) => o.id)) : null;

  const allLots = [...furLotsAll, ...liningLotsAll];
  const lotsAllYears = restrictUsage(selectLots(allLots, "all", f, aucIds), orderIdsForUsage);
  const lotsYear = year === "all" ? lotsAllYears : lotsAllYears.filter((l) => l.purchaseId != null && l.year === Number(year));
  const fl = furLiningFlows(lotsYear);

  // Таблица «по сырью»
  const rawTable: RawTableRow[] = [];
  const groups = new Map<string, FurLot[]>();
  for (const l of lotsYear) {
    const k = `${l.kind}|${l.item}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [k, ls] of groups) {
    const byAuc = new Map<string, { label: string; lots: FurLot[] }>();
    for (const l of ls) {
      const g = byAuc.get(l.auction) ?? { label: l.auction === "__none" ? "Без аукциона" : labeler(l.auction).label, lots: [] };
      g.lots.push(l);
      byAuc.set(l.auction, g);
    }
    rawTable.push({
      key: k, label: ls[0].item, kind: ls[0].kind, cells: cellsPair(ls, c4k), lots: ls.length,
      auctions: Array.from(byAuc, ([key, g]) => ({ key, label: g.label, cells: cellsPair(g.lots, c4k) })).sort((a, b) => b.cells.incl.rv - a.cells.incl.rv),
    });
  }
  rawTable.sort((a, b) => Number(a.kind === "lining") - Number(b.kind === "lining") || b.cells.incl.rv - a.cells.incl.rv);
  const rawTableTotal = cellsPair(lotsYear, c4k);

  // «Динамика по годам»: годы шапки не влияют — показаны все; фильтры панели действуют (кроме долга и оплат).
  const yearSet = new Set<number>(YEARS.map(Number));
  for (const l of lotsAllYears) yearSet.add(l.year);
  for (const o of ordersFiltered) if (o.year != null) yearSet.add(o.year);
  const yearList = Array.from(yearSet).sort((a, b) => a - b);
  const debtFor = (y: YearFilter) => supplierDebtFromInputs(debtInputs, y);
  // Строка года: сырьё по году закупки лота, «произведено» — завершённые ТЗ года ТЗ, долг/оплаты — как loadSupplierDebt(год).
  const mkYear = (key: string, label: string, lots: FurLot[], orders: OrderRow[], d: SupplierDebt): YearRow => {
    const t = prodTotals(orders.filter(isDone));
    return {
      key, label,
      fur: cellsPair(lots.filter((l) => l.kind === "fur"), c4k),
      lining: cellsPair(lots.filter((l) => l.kind === "lining"), c4k),
      prod: { qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum },
      paid: d.paid.add(d.unlinkedAdvances).toNumber(),
      debt: d.debt.toNumber(),
    };
  };
  const yearRows: YearRow[] = yearList.map((y) => mkYear(String(y), String(y), lotsAllYears.filter((l) => l.year === y), ordersFiltered.filter((o) => o.year === y), debtFor(String(y) as YearFilter)));
  const noYear = ordersFiltered.filter((o) => o.year == null);
  if (noYear.some((o) => isDone(o) && (o.qty !== 0 || o.costIncl !== 0))) {
    const t = prodTotals(noYear.filter(isDone));
    const empty = cellsPair([], c4k);
    yearRows.push({ key: "none", label: "Без даты", fur: empty, lining: empty, prod: { qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum }, paid: 0, debt: 0 });
  }
  // «Итого» = сумма строк по каждой аддитивной колонке (куплено, использовано, остаток, произведено, оплачено, долг).
  // Средневзвешенные цены в итоговой строке считаются от сумм, а не складываются.
  const sumCells = (list: Cells[]): Cells => {
    const t = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0 });
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const avg = (v: number, q: number) => (q > 0 ? r2(v / q) : null);
    return { rq: r3(t.rq), rv: r2(t.rv), ra: avg(t.rv, t.rq), uq: r3(t.uq), uv: r2(t.uv), ua: avg(t.uv, t.uq), mq: r3(t.mq), mv: r2(t.mv), ma: avg(t.mv, t.mq) };
  };
  const sumPair = (list: CellsPair[]): CellsPair => ({ incl: sumCells(list.map((c) => c.incl)), excl: sumCells(list.map((c) => c.excl)) });
  // Строки, где нет ни одной ненулевой цифры, не показываем (в сумму они ничего не вносят).
  const hasData = (r: YearRow) => [r.fur.incl, r.lining.incl].some((c) => c.rq !== 0 || c.uq !== 0 || c.mq !== 0 || c.rv !== 0) || r.prod.qty !== 0 || r.prod.costIncl !== 0 || r.paid !== 0 || r.debt !== 0;
  const shownRows = yearRows.filter(hasData);
  const totalRow: YearRow = {
    key: "all", label: "Итого",
    fur: sumPair(yearRows.map((r) => r.fur)),
    lining: sumPair(yearRows.map((r) => r.lining)),
    prod: yearRows.reduce((a, r) => ({ qty: a.qty + r.prod.qty, costIncl: a.costIncl + r.prod.costIncl, costExcl: a.costExcl + r.prod.costExcl, work: a.work + r.prod.work }), { qty: 0, costIncl: 0, costExcl: 0, work: 0 }),
    paid: yearRows.reduce((a, r) => a + r.paid, 0),
    debt: yearRows.reduce((a, r) => a + r.debt, 0),
  };
  const years: YearRow[] = [...shownRows, totalRow];

  const debt = supplierDebtFromInputs(debtInputs, year);
  const invoiceDeadlines = debt.byAuction
    .filter((a) => a.dueInvoiced.greaterThan(0) && a.invoiceDocs)
    .map((a) => {
      const m = DEADLINE_RE.exec(a.invoiceDocs ?? "");
      return m ? { auction: labeler(a.name).label, date: `${m[1]}.${m[2]}.${m[3]}`, amount: a.dueInvoiced.toNumber(), sort: `${m[3]}${m[2]}${m[1]}` } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map(({ auction, date, amount }) => ({ auction, date, amount }));

  // Долг заказчиков (давальческие ТЗ): по ТЗ, прошедшим те же фильтры; оплаты — привязанные к ним, либо без ТЗ по году.
  const ids = ordersYear.map((o) => o.id);
  const [clientOrders, clientPaymentsAll] = await Promise.all([
    prisma.productionOrder.findMany({ where: { organizationId: orgId, id: { in: ids }, clientId: { not: null } }, include: { client: true } }),
    prisma.productionPayment.findMany({ where: { organizationId: orgId }, include: { orders: { select: { productionOrderId: true } } } }),
  ]);
  const yearOrderIds = new Set(clientOrders.map((o) => o.id));
  const filtersActive = Boolean(f.auction.length || f.fur.length || f.color.length || f.vat.length || f.status.length || f.batch.length);
  const clientPayments = clientPaymentsAll.filter((p) => {
    if (p.status !== "COMPLETED") return false;
    if (p.orders.length > 0) return year === "all" && !filtersActive ? true : p.orders.some((l) => yearOrderIds.has(l.productionOrderId));
    return year === "all" ? true : new Date(p.paidAt).getUTCFullYear() === Number(year);
  });
  const map = new Map<string, { clientId: string; clientName: string; billable: Decimal; paid: Decimal; unpricedOrders: number; orders: number }>();
  for (const o of clientOrders) {
    if (!o.clientId || !o.client) continue;
    const e = map.get(o.clientId) ?? { clientId: o.clientId, clientName: o.client.name, billable: new Decimal(0), paid: new Decimal(0), unpricedOrders: 0, orders: 0 };
    e.orders += 1;
    if (o.clientWorkPricePerUnit) e.billable = e.billable.add(o.clientWorkPricePerUnit.mul(orderUnits(o).toFixed(3)));
    else e.unpricedOrders += 1;
    map.set(o.clientId, e);
  }
  for (const p of clientPayments) {
    const e = p.clientId ? map.get(p.clientId) : undefined;
    if (e) e.paid = e.paid.add(p.amount);
  }
  const clientDebts: ClientDebtRow[] = Array.from(map.values())
    .map((c) => ({ clientId: c.clientId, clientName: c.clientName, billable: c.billable.toNumber(), paid: c.paid.toNumber(), balance: c.billable.sub(c.paid).toNumber(), unpricedOrders: c.unpricedOrders, orders: c.orders }))
    .sort((a, b) => b.balance - a.balance);

  return {
    c4,
    raw: { fur: figuresPair(fl.fur, c4k), lining: figuresPair(fl.lining, c4k), lots: lotsYear.length },
    prod: { done: prodTotals(ordersYear.filter(isDone)), work: prodTotals(ordersYear.filter((o) => !isDone(o))) },
    rawTable, rawTableTotal, years, debt,
    supplierCashPaid: debt.paid.add(debt.unlinkedAdvances).toNumber(),
    clientDebts, invoiceDeadlines, control, options, noColorLots,
    orderIds: ordersYear.map((o) => o.id),
    furTotalLots: lotsYear.length,
  };
}
