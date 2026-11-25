import { isPositive } from "@/domain/money";
import { countPayslips } from "@/lib/pay-kinds";
import "server-only";
// Загрузка данных Сводки (/dashboard): всё, что нужно блокам, одним набором параллельных запросов.
// Расчёты — в dashboard-calc.ts (чистые функции), сырьё — fur-table.ts, ТЗ — analytics-orders.ts, долг — supplier-debt.ts.
import { memoRequest, jsonKey } from "@/lib/req-memo";
import { Decimal } from "@prisma/client/runtime/library";
import { loadPaymentsLeft, loadPaymentsOverview } from "@/lib/payments-overview";
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import { type C4Kind, type FlowFigures, type FurLot } from "@/lib/fur-table";
import { loadOrderRows, type OrderRow } from "@/lib/analytics-orders";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { withOrderFurOptions } from "@/lib/order-fur";
import { auctionLabeler, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { loadClientDebt, type ClientDebtRow } from "@/lib/payment-alloc";
import { auctionName } from "@/lib/auction-names";
import { overpayTarget } from "@/lib/overpay-notes";
import { allocateHides, hidesApply, hidesByPayYear } from "@/lib/contractor-hides";
import { loadDebtInputs, supplierDebtFromInputs } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { isServicePurchase } from "@/lib/service-purchase";
import { loadControlCounts } from "@/lib/control-counts";
import { inYear, type YearFilter } from "@/lib/year-filter";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { figuresPair, furLiningFlows, isDone, orderMatches, prodTotals, restrictUsage, selectLots, orderFiltersOn, lotFiltersOn, REPAIR_CATEGORY, type DashFilters } from "@/lib/dashboard-calc";
import { addVat, BOUGHT_ORDERED, bumpFigures, lotVat, mergeVat, withHides, withOrdered } from "@/lib/_dashboard-data/cells";
import type { Cells, CellsPair, DashboardData, Ordered, RawTableRow, VatByRate, VatTriple, YearRow } from "@/lib/_dashboard-data/types";
import { surchargeSplit } from "@/lib/_dashboard-data/drill-orders";
import { collectUnreceived } from "@/lib/_dashboard-data/unreceived";
import { applyRestToRawTable, buildRawTable, mergeUnreceived } from "@/lib/_dashboard-data/raw-table";
import { buildYearRows } from "@/lib/_dashboard-data/years";
import { buildSyntheticLots } from "@/lib/_dashboard-data/synthetic-lots";
import { rawFurBySourceOf, rawSourcesOf } from "@/lib/_dashboard-data/fur-sources";

// Типы, помощники ячеек и шаги расчёта — в src/lib/_dashboard-data/ (прежние пути импорта сохранены переэкспортом).
export type { Cells, CellsPair, DashboardData, Ordered, RawTableRow, VatByRate, VatTriple, YearRow };
export { furNameFn, loadSelectedOrders, loadDrillOrders, receivedWithoutTz, surchargeSplit } from "@/lib/_dashboard-data/drill-orders";

export type { ClientDebtRow };
const DEADLINE_RE = /срок\s+(\d{2})\.(\d{2})\.(\d{4})/i;

async function loadDashboardImpl(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode): Promise<DashboardData> {
  const furIdx = await getFurIndex(orgId);
  const [furLotsAll, liningLotsAll, ordersAll, debtInputs, options, noColorLots, control, aucIds, labeler] = await Promise.all([
    loadFurLots(prisma, orgId, { kind: "fur", year: "all", furIdx }),
    loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx }),
    loadOrderRows(orgId, "all", c4),
    loadDebtInputs(prisma, orgId),
    getFilterOptions(orgId, year, ["auction", "fur", "color", "attr", "batch"]),
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

  // Оплачено и долг по видам: оплаты и остаток каждого аукциона делятся по доле вида в стоимости лотов этого аукциона.
  const debtRaw = supplierDebtFromInputs(debtInputs, year);
  // Оплачено по аукциону — из общего списка оплат (в долге есть только аукционы с остатком); долг — из расчёта долга.
  const [ovAll, ovLeftAll] = await Promise.all([loadPaymentsOverview(orgId), loadPaymentsLeft(orgId)]);
  // Доплата подрядчику делится на мех (по видам) и подкладку только без фильтров сырья и ТЗ (при фильтре она остаётся строкой «поправки» и целиком в меху).
  const surcharge = !lotFiltersOn(f) && !orderFiltersOn(f) ? await surchargeSplit(orgId, ovAll, year, c4) : new Map<string, number>();
  // Шкуры подрядчика, оплаченные в составе пошива: по выбранным ТЗ (партии 7 и 8), по году оплаты. Фильтры панели действуют.
  const hidesYear = new Map<number, { incl: number; excl: number }>();
  const hidesVat: VatByRate = {};
  if (hidesApply(f)) {
    const shares = allocateHides(ordersFiltered.map((o) => ({ id: o.id, number: o.number, batch: o.batchNumber == null ? "none" : String(o.batchNumber), qty: o.qty })), hidesByPayYear(ovAll), year);
    for (const sh of shares) { const cur = hidesYear.get(sh.payYear) ?? { incl: 0, excl: 0 }; cur.incl += sh.incl; cur.excl += sh.excl; hidesYear.set(sh.payYear, cur); if (sh.excl > 0) addVat(hidesVat, Math.round((sh.incl / sh.excl - 1) * 100), sh.incl - sh.excl); }
  }
  const hidesTotal = Array.from(hidesYear.values()).reduce((a, v) => ({ incl: a.incl + v.incl, excl: a.excl + v.excl }), { incl: 0, excl: 0 });
  const aucMoney = new Map<string, { paid: number; due: number }>();
  for (const r of ovAll) if (r.kind === "raw" && (year === "all" || r.year === Number(year))) aucMoney.set(r.label, { paid: (aucMoney.get(r.label)?.paid ?? 0) + r.fur + r.lining, due: 0 });
  for (const a of debtRaw.byAuction) aucMoney.set(a.name, { paid: aucMoney.get(a.name)?.paid ?? 0, due: a.due.toNumber() });
  // Переплата аукциона зачтена в счёте другого аукциона (AME): оплата переносится туда, долг цели уменьшается — минусов в строках нет.
  for (const o of debtRaw.overpaid) {
    const amt = o.amount.toNumber();
    const to = overpayTarget(o.name);
    const tgt = to ? aucMoney.get(to) : undefined;
    if (to && tgt) {
      const src = aucMoney.get(o.name) ?? { paid: 0, due: 0 };
      aucMoney.set(o.name, { paid: src.paid - amt, due: 0 });
      aucMoney.set(to, { paid: tgt.paid + amt, due: tgt.due - amt });
    } else aucMoney.set(o.name, { paid: aucMoney.get(o.name)?.paid ?? 0, due: -amt });
  }
  const aucTotalValue = new Map<string, number>();
  for (const l of allLots) aucTotalValue.set(l.auction, (aucTotalValue.get(l.auction) ?? 0) + l.recvIncl);
  const { orderedYear, orderedVat, unreceived, purchasePaid } = await collectUnreceived(orgId, year, f, { aucMoney, aucTotalValue, allLots, lotsAllYears, debtInputs, debtRaw, furName });
  // Таблица «по сырью»
  const { rawTable, rawTableTotal, moneyOf } = buildRawTable({ lotsYear, allLots, aucMoney, aucTotalValue, labeler, c4k });

  const { yearList, yearRows, buildYears, yearsFurBySrc, auctionSrc } = buildYearRows({ lotsAllYears, ordersFiltered, debtInputs, allLots, orderedYear, hidesYear, c4k, ovAll, ovLeftAll });
  let years: YearRow[] = buildYears();

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

  // Долг по работе подрядчику (давальческие ТЗ): единая функция loadClientDebt (payment-alloc.ts) — работа выбранных ТЗ
  // минус оплачено, где оплачено = разнесено на эти ТЗ (PaymentAllocation) + неразнесённые авансы года.
  const filtersActive = Boolean(f.auction.length || f.fur.length || f.color.length || f.attr.length || f.vat.length || f.status.length || f.batch.length || f.catgroup?.length || f.kind?.length);
  const clientDebt = await loadClientDebt(prisma, orgId, { year, orderIds: ordersYear.map((o) => o.id), orderFiltersActive: filtersActive });
  const clientDebts: ClientDebtRow[] = clientDebt.rows;

  const furPair = figuresPair(fl.fur, c4k), liningPair = figuresPair(fl.lining, c4k);
  const usedBaseOf = (v: "incl" | "excl") => [furPair[v], liningPair[v]].reduce((a, x) => a + (c4 === "on" ? x.usedValueOther : x.usedValue), 0);
  const purchasesYear = debtInputs.allPurchases.filter((p) => p.status !== "CANCELLED" && inYear(p.orderDate, year));
  const sumPurch = (pred: (st: string) => boolean) => purchasesYear.filter((p) => pred(p.status)).reduce((a, p) => a.add(purchaseTotalInclVat(p)), new Decimal(0)).toNumber();
  const workOf = (pred: (o: OrderRow) => boolean) => ordersYear.filter(pred).reduce((a, o) => a + o.work, 0);

  // Оплачено по статьям — те же числа, что в «Оплаты → Все»: мех (с шкурами подрядчика), подкладка, работа. 4% отдельной суммой не добавляется (учтены в оплатах).
  // «Оплачено» = реальная сумма оплат (с переплатами): закупки − оплачено = долг; переплаты, зачтённые в долг, показаны отдельно.
  const supplierOverpaid = debt.overpaid.reduce((a, o) => a.add(o.amount), new Decimal(0));
  const supplierCashPaid = debt.paid.add(debt.unlinkedAdvances).add(supplierOverpaid).toNumber();
  const ovLeft = ovLeftAll;
  const ovYear = ovAll.filter((r) => year === "all" || r.year === Number(year));
  const sumOv = (k: "fur" | "lining" | "services" | "work") => ovYear.reduce((a, r) => a + r[k], 0);
  const paidByItem = { fur: sumOv("fur"), lining: sumOv("lining"), services: sumOv("services"), work: sumOv("work") };
  const paidFurBySource = ovYear.reduce((t, r) => {
    if (r.kind === "raw") { if (r.auction ?? r.edit === "auction") t.auction += r.fur; else t.supplier += r.fur; } else t.supplier += r.hides;
    return t;
  }, { auction: 0, supplier: 0 });
  const paidByType = (["ADVANCE", "PARTIAL", "FINAL", "OTHER"] as const).map((type) => {
    const rs = ovYear.filter((r) => r.type === type);
    return { type, amount: rs.reduce((a, r) => a + r.fur + r.lining + r.services + r.work, 0), count: rs.length };
  });
  const typesOf = (pick: (r: (typeof ovYear)[number]) => number) => (["ADVANCE", "PARTIAL", "FINAL", "OTHER"] as const).map((type) => {
    const rs = ovYear.filter((r) => r.type === type && r.kind === "raw" && Math.abs(pick(r)) >= 0.005);
    return { type, amount: rs.reduce((x, r) => x + pick(r), 0), count: rs.length };
  });
  const paidByTypeFur = typesOf((r) => r.fur), paidByTypeLining = typesOf((r) => r.lining);
  const leftYears = Array.from(ovLeft.byYear.entries()).filter(([y]) => year === "all" || y === Number(year));
  const leftRaw = leftYears.reduce((a, [, v]) => a + v.raw, 0);
  // Остаток по сырью делим на мех и подкладку по доле подкладки в лотах каждого аукциона; прочее (закупки без аукциона, зачёты) — мех.
  const auctionLots = new Map<string, FurLot[]>();
  for (const l of allLots) auctionLots.set(l.auction, [...(auctionLots.get(l.auction) ?? []), l]);
  const liningShare = (name: string) => {
    const ls = auctionLots.get(name) ?? [];
    const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
    return tot > 0 ? ls.filter((l) => l.kind === "lining").reduce((a, l) => a + l.recvIncl, 0) / tot : 0;
  };
  const leftLining = debt.byAuction.reduce((a, x) => a + x.due.toNumber() * liningShare(x.name), 0) ;
  // Закупки-услуги (УПД без позиций сырья): неоплаченная часть — отдельной статьёй, не в меху.
  const leftServices = debtInputs.allPurchases.filter((p) => isServicePurchase(p) && inYear(p.orderDate, year))
    .reduce((a, p) => a + Math.max(purchaseTotalInclVat(p).sub(p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), new Decimal(0))).toNumber(), 0), 0);
  // «К оплате» по работе — остаток работы по заведённым ТЗ (не меньше нуля); неразнесённые авансы подрядчику — отдельной строкой (advance), а не минусом.
  const left = { raw: leftRaw, fur: leftRaw - leftLining - leftServices, lining: leftLining, services: leftServices, prod: leftYears.reduce((a, [, v]) => a + v.prod, 0) };
  const advance = leftYears.reduce((a, [, v]) => a + v.adv, 0);

  // «Прочее» (закупки без аукциона, шкуры подрядчика, поправки) — это конкретные виды меха: переносим в их строки.
  applyRestToRawTable({ rawTable, hidesTotal, c4k, purchasePaid, lotsAllYears, surcharge, purchasesYear, lotsYear, allLots });

  mergeUnreceived(rawTable, unreceived, c4k);
  const orderedAll = unreceived.byFur.reduce((a, g) => ({ qty: a.qty + g.ordered.qty, incl: a.incl + g.ordered.incl, excl: a.excl + g.ordered.excl }), { qty: 0, incl: 0, excl: 0 });
  const orderedBought = unreceived.byFur.filter((g) => BOUGHT_ORDERED.has(g.label)).reduce((a, g) => ({ qty: a.qty + g.ordered.qty, incl: a.incl + g.ordered.incl, excl: a.excl + g.ordered.excl }), { qty: 0, incl: 0, excl: 0 });
  const rawTableTotalAll = withHides(withOrdered(rawTableTotal, orderedBought), hidesTotal);
  const addHidesFig = (f: FlowFigures, v: number): FlowFigures => ({ ...f, recvValue: f.recvValue + v, recvAvg: f.recvQty > 0 ? Math.round(((f.recvValue + v) / f.recvQty) * 100) / 100 : null, usedValue: f.usedValue + v, usedValueOther: f.usedValueOther + v, usedAvg: f.usedQty > 0 ? Math.round(((f.usedValue + v) / f.usedQty) * 100) / 100 : null });
  const bumpedFur = { incl: bumpFigures(furPair.incl, orderedBought.qty, orderedBought.incl), excl: bumpFigures(furPair.excl, orderedBought.qty, orderedBought.excl) };
  const furPairAll = { incl: addHidesFig(bumpedFur.incl, hidesTotal.incl), excl: addHidesFig(bumpedFur.excl, hidesTotal.excl) };
  const syntheticLots: FurLot[] = buildSyntheticLots({ debtInputs, labeler, unreceived, hidesTotal, hidesYear });

  // Деньги по лотам (для плиток «Оплачено / К оплате» таблицы «Сырьё» при фильтрах): доля аукциона по стоимости лота; закупки без аукциона — по своим оплатам и долгу.
  const lotMoney: Record<string, { paid: number; due: number }> = {};
  for (const l of allLots) { const m = moneyOf(l.auction, [l]); lotMoney[l.id] = { paid: m.paid, due: m.due }; }
  for (const x of purchasePaid) {
    const ls = allLots.filter((l) => l.purchaseId === x.id);
    const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
    if (tot > 0) for (const l of ls) lotMoney[l.id].paid += x.paid * (l.recvIncl / tot);
  }
  for (const p of purchasesYear) {
    if (p.auctionSession && auctionName(p.auctionSession)) continue;
    const dueP = purchaseTotalInclVat(p).sub(p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a.add(x.amount), new Decimal(0))).toNumber();
    if (!isPositive(dueP)) continue;
    const ls = allLots.filter((l) => l.kind === "fur" && l.purchaseId === p.id);
    const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
    if (tot > 0) for (const l of ls) lotMoney[l.id].due += dueP * (l.recvIncl / tot);
  }
  const unreceivedLeft = { paid: unreceived.paid - unreceived.byFur.reduce((a, g) => a + g.paid, 0), due: unreceived.due - unreceived.byFur.reduce((a, g) => a + g.due, 0), names: unreceived.names, byFur: [] as typeof unreceived.byFur };

  // Фильтры панели: деньги по сырью — сумма строк таблицы (они уже по выбранным лотам), «Работа» — по выбранным ТЗ.
  const moneyFromRows = lotFiltersOn(f) || orderFiltersOn(f);
  const sumRows = (kind: "fur" | "lining", k: "paid" | "due") => rawTable.filter((r) => r.kind === kind).reduce((a, r) => a + r[k], 0);
  let paidOut = paidByItem, leftOut = left, advanceOut = advance;
  if (moneyFromRows) {
    paidOut = { ...paidByItem, services: 0, fur: sumRows("fur", "paid"), lining: sumRows("lining", "paid") };
    leftOut = { ...left, services: 0, fur: sumRows("fur", "due"), lining: sumRows("lining", "due"), raw: sumRows("fur", "due") + sumRows("lining", "due") };
  }
  if (moneyFromRows) {
    const alloc = new Map((await prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId, productionPayment: { status: "COMPLETED" } }, _sum: { amount: true } })).map((x) => [x.productionOrderId, x._sum.amount?.toNumber() ?? 0]));
    let wPaid = 0, wLeft = 0;
    for (const o of ordersYear) {
      if (!o.clientName) continue;
      const a = alloc.get(o.id) ?? 0;
      wPaid += Math.min(a, o.work); wLeft += Math.max(o.work - a, 0);
    }
    paidOut = { ...paidOut, work: wPaid };
    leftOut = { ...leftOut, prod: wLeft };
    advanceOut = 0; // при фильтрах «Оплачено за работу» — только разнесённое на выбранные ТЗ, аванс без ТЗ к срезу не относится
  }
  if (moneyFromRows) {
    // Годы: оплата и долг строки делятся по годам закупки лотов пропорционально их стоимости; строки без лотов (заказано, шкуры) — в последний год.
    const lastY = yearList[yearList.length - 1];
    const pY = new Map<number, number>(), dY = new Map<number, number>();
    const kind = { fur: { p: new Map<number, number>(), d: new Map<number, number>() }, lining: { p: new Map<number, number>(), d: new Map<number, number>() } };
    const add = (m: Map<number, number>, y: number, v: number) => m.set(y, (m.get(y) ?? 0) + v);
    for (const r of rawTable) {
      const totalV = r.years.reduce((a, y) => a + y.cells.incl.rv, 0);
      const parts = totalV > 0 ? r.years.map((y) => ({ year: y.year, sh: y.cells.incl.rv / totalV })) : [{ year: lastY, sh: 1 }];
      for (const { year: y, sh } of parts) { add(pY, y, r.paid * sh); add(dY, y, r.due * sh); add(kind[r.kind].p, y, r.paid * sh); add(kind[r.kind].d, y, r.due * sh); }
    }
    for (const yr of yearRows) if (/^\d{4}$/.test(yr.key)) {
      const y = Number(yr.key);
      yr.paid = pY.get(y) ?? 0; yr.debt = dY.get(y) ?? 0;
      yr.money = { fur: { paid: kind.fur.p.get(y) ?? 0, debt: kind.fur.d.get(y) ?? 0 }, lining: { paid: kind.lining.p.get(y) ?? 0, debt: kind.lining.d.get(y) ?? 0 } };
    }
    years = buildYears();
  }
  const unreceivedOut = moneyFromRows ? { paid: 0, due: 0, names: [] as string[], byFur: [] as typeof unreceived.byFur } : unreceivedLeft;

  // НДС по ставкам: плитки сырья — по лотам года/фильтров (ставка лота) + заказанное, но не полученное (ставки позиций закупки) + шкуры подрядчика;
  // себестоимость — по строкам списаний выбранных ТЗ (ставка строки: своя либо лота) + шкуры подрядчика. 4% в НДС не входит.
  const furLots = lotsYear.filter((l) => l.kind === "fur"), liningLots = lotsYear.filter((l) => l.kind === "lining");
  const costVat: VatByRate = {};
  for (const o of ordersYear) for (const l of o.lines) addVat(costVat, l.vat, l.incl - l.excl);
  const vatOut = {
    fur: { recv: mergeVat(lotVat(furLots, "recv"), orderedVat, hidesVat), used: mergeVat(lotVat(furLots, "used"), hidesVat), rem: mergeVat(lotVat(furLots, "rem"), orderedVat) },
    lining: { recv: lotVat(liningLots, "recv"), used: lotVat(liningLots, "used"), rem: lotVat(liningLots, "rem") },
    cost: mergeVat(costVat, hidesVat),
  };

  return {
    c4,
    vat: vatOut,
    paidByItem: paidOut,
    paidFurBySource,
    paidByType,
    paidByTypeFur,
    paidByTypeLining,
    paidSlips: { slips: countPayslips(ovYear), rows: ovYear.length },
    left: leftOut,
    advance: advanceOut,
    overpaid: debt.overpaid.map((o) => ({ name: o.name, amount: o.amount.toNumber() })),
    hides: hidesTotal,
    ordered: orderedAll,
    orderedBought,
    syntheticLots,
    lotMoney,
    rawMoneyTotal: { paid: paidOut.fur + paidOut.lining, due: leftOut.fur + leftOut.lining, unreceived: unreceivedOut },
    raw: { fur: furPairAll, lining: liningPair, lots: lotsYear.length },
    rawSources: rawSourcesOf(furLots, c4k, orderedBought, hidesTotal),
    rawFurBySource: rawFurBySourceOf(furLots, c4k, orderedBought, hidesTotal, unreceived, furPairAll),
    prod: { done: prodTotals(ordersYear.filter(isDone)), work: prodTotals(ordersYear.filter((o) => !isDone(o))), all: prodTotals(ordersYear) },
    rawTable, rawTableTotal: rawTableTotalAll, years, yearsFurBySrc, auctionSrc, debt,
    supplierCashPaid,
    supplierOverpaid: supplierOverpaid.toNumber(),
    clientDebts, clientDebtInfo: { allocated: clientDebt.allocated, unallocated: clientDebt.unallocated, unallocatedAll: clientDebt.unallocatedAll, unallocatedApplied: clientDebt.unallocatedApplied, unallocatedByKind: clientDebt.unallocatedByKind }, invoiceDeadlines, control, options: { ...options, fur: withOrderFurOptions(options.fur, ordersAll) }, noColorLots,
    noGroup: { repair: ordersAll.filter((o) => !o.categoryGroup && o.category === REPAIR_CATEGORY).length, other: ordersAll.filter((o) => !o.categoryGroup && o.category !== REPAIR_CATEGORY).length },
    orderIds: ordersYear.map((o) => o.id),
    furTotalLots: lotsYear.length,
    priceLots: lotsYear.filter((l) => l.kind === "fur"),
    bridge: {
      usedBase: { incl: usedBaseOf("incl"), excl: usedBaseOf("excl") },
      usedComparable: year === "all" && !lotFiltersOn(f),
      purchases: { received: sumPurch((st) => st === "RECEIVED"), draft: sumPurch((st) => st !== "RECEIVED") },
      clientWork: { done: workOf((o) => o.clientName != null && isDone(o)), work: workOf((o) => o.clientName != null && !isDone(o)), noClient: workOf((o) => o.clientName == null) },
    },
  };
}

export const loadDashboard = memoRequest("dashboard", loadDashboardImpl, (orgId, year, f, c4) => `${orgId}|${year}|${c4}|${jsonKey(f)}`, { shared: true });
