import "server-only";
// Загрузка данных Сводки (/dashboard): всё, что нужно блокам, одним набором параллельных запросов.
// Расчёты — в dashboard-calc.ts (чистые функции), сырьё — fur-table.ts, ТЗ — analytics-orders.ts, долг — supplier-debt.ts.
import { Decimal } from "@prisma/client/runtime/library";
import { loadPaymentsLeft, loadPaymentsOverview } from "@/lib/payments-overview";
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import { figures, flowOf, NOT_SET, type C4Kind, type FlowFigures, type FurLot } from "@/lib/fur-table";
import { orderUnits } from "@/lib/production-totals";
import { loadOrderRows, type OrderRow } from "@/lib/analytics-orders";
import { canonicalFur } from "@/lib/fur-ref";
import { lotUsdPrice } from "@/lib/lot-hammer";
import { getFurIndex } from "@/lib/fur-ref-server";
import { withOrderFurOptions } from "@/lib/order-fur";
import { auctionLabeler, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { loadClientDebt, type ClientDebt, type ClientDebtRow } from "@/lib/payment-alloc";
import { auctionName } from "@/lib/auction-names";
import { overpayTarget } from "@/lib/overpay-notes";
import { allocateHides, hidesApply, hidesByPayYear } from "@/lib/contractor-hides";
import { loadDebtInputs, supplierDebtFromInputs, type SupplierDebt } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { loadControlCounts, type ControlCounts } from "@/lib/control-counts";
import { availableYears, inYear, type YearFilter } from "@/lib/year-filter";
import type { Commission4Mode } from "@/lib/commission4-mode";
import {
  figuresPair, furLiningFlows, isDone, orderMatches, prodTotals, restrictUsage, selectLots, toDrillOrder, orderFiltersOn, lotFiltersOn, REPAIR_CATEGORY,
  type DashFilters, type Pair, type ProdTotals,
} from "@/lib/dashboard-calc";
import type { DrillOrder } from "@/lib/dashboard-drill";

/** Девять чисел строки «куплено / использовано / остаток»: шт, ₽, средневзвешенная ₽/шт. */
export type Cells = {
  rq: number; rv: number; ra: number | null; uq: number; uv: number; ua: number | null; mq: number; mv: number; ma: number | null;
  /** «Использовано» в ПРОТИВОПОЛОЖНОЙ базе 4% (режим «с 4%» → без 4%, и наоборот): сумма и средневзвешенная. «Куплено» и «Остаток» всегда без 4%. */
  uo: number; uoa: number | null;
};
const cellsOf = (f: FlowFigures): Cells => ({ rq: f.recvQty, rv: f.recvValue, ra: f.recvAvg, uq: f.usedQty, uv: f.usedValue, ua: f.usedAvg, mq: f.remQty, mv: f.remValue, ma: f.remAvg, uo: f.usedValueOther, uoa: f.usedQty > 0 ? Math.round((f.usedValueOther / f.usedQty) * 100) / 100 : null });
export type CellsPair = Pair<Cells>;
/** Заказанное, но ещё не полученное считаем купленным и лежащим в остатке (использовано — 0): прибавляем к «Куплено» и «Остаток». */
const bumpCells = (c: Cells, q: number, v: number): Cells => {
  const rq = c.rq + q, rv = c.rv + v, mq = c.mq + q, mv = c.mv + v;
  return { ...c, rq, rv, ra: rq > 0 ? Math.round((rv / rq) * 100) / 100 : null, mq, mv, ma: mq > 0 ? Math.round((mv / mq) * 100) / 100 : null };
};
/** Шкуры подрядчика (оплачены в составе пошива, лотов нет): купленное и сразу израсходованное, остаток 0. */
const withHides = (p: CellsPair, v: { incl: number; excl: number } | undefined): CellsPair => {
  if (!v) return p;
  const f = (c: Cells, x: number): Cells => ({ ...c, rv: c.rv + x, uv: c.uv + x, uo: c.uo + x, ra: c.rq > 0 ? Math.round(((c.rv + x) / c.rq) * 100) / 100 : null, ua: c.uq > 0 ? Math.round(((c.uv + x) / c.uq) * 100) / 100 : null });
  return { incl: f(p.incl, v.incl), excl: f(p.excl, v.excl) };
};
const withOrdered = (p: CellsPair, o: Ordered | undefined): CellsPair => (o ? { incl: bumpCells(p.incl, o.qty, o.incl), excl: bumpCells(p.excl, o.qty, o.excl) } : p);
const bumpFigures = (f: FlowFigures, q: number, v: number): FlowFigures => {
  const recvQty = f.recvQty + q, recvValue = f.recvValue + v, remQty = f.remQty + q, remValue = f.remValue + v;
  return { ...f, recvQty, recvValue, recvAvg: recvQty > 0 ? Math.round((recvValue / recvQty) * 100) / 100 : null, remQty, remValue, remAvg: remQty > 0 ? Math.round((remValue / remQty) * 100) / 100 : null };
};
// Таблицы «Динамика по годам» и «по сырью» показывают «Использовано» всегда без 4% (4% — отдельно, в виджетах и себестоимости).
const cellsPair = (lots: FurLot[], _c4: C4Kind): CellsPair => {
  const fl = flowOf(lots);
  return { incl: cellsOf(figures(fl, { vat: "incl", c4: "off" })), excl: cellsOf(figures(fl, { vat: "excl", c4: "off" })) };
};

/** Заказано, но ещё не получено (состав закупки): шт. и сумма с НДС / без НДС. */
export type Ordered = { qty: number; incl: number; excl: number };
export type RawTableRow = { key: string; label: string; kind: "fur" | "lining"; cells: CellsPair; /** Оплачено и долг по виду: оплаты и остаток аукционов делятся по доле вида в стоимости лотов аукциона. */ paid: number; due: number; /** Средняя цена в долларах (куплено / использовано / остаток); у подкладки нет. */ usd: { bought: number | null; used: number | null; rem: number | null }; auctions: { key: string; label: string; cells: CellsPair; paid: number; due: number }[]; /** Те же цифры по годам закупки лота (для окон цен). */ years: { year: number; cells: CellsPair; usd: { bought: number | null; used: number | null; rem: number | null } }[]; lots: number; /** Id лотов ткани подкладки — для перехода в карточку лота (у меха не заполняется). */ lotIds?: string[] };
export type YearRow = {
  key: string;
  label: string;
  fur: CellsPair;
  lining: CellsPair;
  prod: { qty: number; costIncl: number; costExcl: number; work: number };
  paid: number;
  debt: number;
  /** Оплачено и задолженность года отдельно по меху и подкладке (в сумме — paid и debt). */
  money: { fur: { paid: number; debt: number }; lining: { paid: number; debt: number } };
};

/** НДС по ставкам, ₽: ключ — ставка в процентах («20», «22»). Это сумма НДС, лежащая внутри цен с НДС (с НДС − без НДС), от режима «С НДС / без НДС» шапки не зависит. */
export type VatByRate = Record<string, number>;
export type VatTriple = { recv: VatByRate; used: VatByRate; rem: VatByRate };
const addVat = (m: VatByRate, rate: number | string, v: number) => { if (Number.isFinite(v) && Math.abs(v) > 0.000001) m[String(rate)] = (m[String(rate)] ?? 0) + v; };

export type { ClientDebtRow };

export type DashboardData = {
  c4: Commission4Mode;
  raw: { fur: Pair<FlowFigures>; lining: Pair<FlowFigures>; lots: number };
  /** НДС по ставкам внутри плиток сырья (куплено / использовано / остаток; использовано — без 4%) и в себестоимости (по строкам списаний + шкуры подрядчика, без НДС на надбавку 4%). */
  vat: { fur: VatTriple; lining: VatTriple; cost: VatByRate };
  prod: { done: ProdTotals; work: ProdTotals; /** Все ТЗ года: уникальные номера ТЗ считаются по всему набору, а не суммой «завершённые + в работе». */ all: ProdTotals };
  rawTable: RawTableRow[];
  rawTableTotal: CellsPair;
  years: YearRow[];
  debt: SupplierDebt;
  supplierCashPaid: number;
  /** Оплачено по статьям: сырьё (мех / подкладка), работа подрядчику, расчётная надбавка 4%. */
  paidByItem: { fur: number; lining: number; work: number };
  /** Осталось оплатить: сырьё (долг поставщику) и производство (долг заказчика) — те же числа, что в «Оплаты → Все». */
  left: { raw: number; fur: number; lining: number; prod: number };
  /** Оплачено и долг по сырью — итог строки «Всего» в «Динамике по сырью» (те же числа, что в «Оплатах»). */
  /** Аукционы с переплатой: учтены в долге по сырью (зачтены поставщиком). */
  overpaid: { name: string; amount: number }[];
  /** Шкуры подрядчика (оплачены в составе пошива): входят в мех «Использовано» и в себестоимость. */
  hides: { incl: number; excl: number };
  /** Заказано, но ещё не получено (нет лотов): шт. и сумма — входит в «Куплено» и «Остаток» меха. */
  ordered: Ordered;
  /** Заказанный, но не полученный мех и шкуры подрядчика как «лоты» для страницы «Сырьё»: таблица там сходится с Главной. */
  syntheticLots: FurLot[];
  /** Оплачено и к оплате по каждому лоту (id → ₽ с НДС): доля оплат и долга аукциона по стоимости лота. Нужны таблице «Сырьё» для плиток оплат при фильтрах. */
  lotMoney: Record<string, { paid: number; due: number }>;
  rawMoneyTotal: { paid: number; due: number; /** Оплаты и остаток по закупкам, где лотов ещё нет (мех не получен). */ unreceived: { paid: number; due: number; names: string[]; /** Тот же остаток по видам меха закупок, где лотов ещё нет (по составу заказа). */ byFur: { label: string; names: string[]; paid: number; due: number; ordered: Ordered }[] } };
  clientDebts: ClientDebtRow[];
  /** Разнесение оплат заказчиков: разнесено на ТЗ, неразнесённые авансы (по виду), учтены ли они в остатке. */
  clientDebtInfo: Pick<ClientDebt, "allocated" | "unallocated" | "unallocatedAll" | "unallocatedApplied" | "unallocatedByKind">;
  invoiceDeadlines: { auction: string; date: string; amount: number }[];
  control: ControlCounts | null;
  options: Awaited<ReturnType<typeof getFilterOptions<"auction" | "fur" | "color" | "attr" | "batch">>>;
  noColorLots: number;
  /** ТЗ без группы категории (все годы): ремонт и прочие — подпись пункта «Без группы» в фильтре. */
  noGroup: { repair: number; other: number };
  /** ID выбранных ТЗ (для окна «стоимость производства»). */
  orderIds: string[];
  furTotalLots: number;
  /** «Мост» между блоками (пояснения у цифр): всё в рублях. */
  bridge: {
    /** Мех + подкладка, использованные по лотам Сводки, БЕЗ 4% (то, что сравнивается с сырьём в ТЗ). */
    usedBase: Pair<number>;
    /** Совпадает ли «Использовано» блока «Сырьё» с сырьём в ТЗ: нет при годе шапки (разные правила года) и при фильтрах по лотам (ТЗ берутся целиком). */
    usedComparable: boolean;
    /** Закупки года с НДС, без отменённых: мех получен (= лоты «Куплено») и ещё не получен (черновики). */
    purchases: { received: number; draft: number };
    /** Работа по ТЗ с заказчиком: завершённые, в работе, и работа по ТЗ без заказчика (в «Долг заказчиков» не входит). */
    clientWork: { done: number; work: number; noClient: number };
  };
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
export async function loadDrillOrders(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode, scope: "done" | "work" | "all"): Promise<DrillOrder[]> {
  const [{ selected, furName }, label] = await Promise.all([loadSelectedOrders(orgId, year, f, c4), auctionLabeler(orgId)]);
  const short = (name: string | null) => (name ? label(name).label : "Без аукциона");
  const orders = selected.filter((o) => (scope === "all" ? true : scope === "done" ? isDone(o) : !isDone(o))).map((o) => toDrillOrder(o, c4, short, furName));
  // Шкуры подрядчика (оплачены в составе пошива, в ТЗ не списаны) — в партию и ТЗ, где использовались (см. contractor-hides.ts).
  if (scope === "all" && hidesApply(f)) {
    const ov = await loadPaymentsOverview(orgId);
    const shares = allocateHides(orders.map((o) => ({ id: o.id, number: o.number, batch: o.bk, qty: o.qty })), hidesByPayYear(ov), year);
    for (const sh of shares) { const o = orders.find((x) => x.id === sh.id); if (o) { o.hI += sh.incl; o.hE += sh.excl; } }
  }
  return orders;
}

const DEADLINE_RE = /срок\s+(\d{2})\.(\d{2})\.(\d{4})/i;

export async function loadDashboard(orgId: string, year: YearFilter, f: DashFilters, c4: Commission4Mode): Promise<DashboardData> {
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

  // Таблица «по сырью»
  const rawTable: RawTableRow[] = [];
  const groups = new Map<string, FurLot[]>();
  for (const l of lotsYear) {
    const k = `${l.kind}|${l.item}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  // Оплачено и долг по видам: оплаты и остаток каждого аукциона делятся по доле вида в стоимости лотов этого аукциона.
  const debtRaw = supplierDebtFromInputs(debtInputs, year);
  // Оплачено по аукциону — из общего списка оплат (в долге есть только аукционы с остатком); долг — из расчёта долга.
  const [ovAll, ovLeftAll] = await Promise.all([loadPaymentsOverview(orgId), loadPaymentsLeft(orgId)]);
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
  // Заказанное, но не полученное (нет лотов): фильтры «вид меха» и «аукцион» действуют, фильтры по цвету, признаку и НДС лотов — исключают.
  const orderedOk = (label: string, aucName: string) =>
    !(f.color.length || f.attr.length || f.vat.length) && (!f.fur.length || f.fur.includes(label)) && (!f.auction.length || f.auction.some((x) => auctionName(x) === aucName || x === aucName));
  /** Цена шкуры в $ из расчёта позиции закупки (лота ещё нет): «цена за ед., $» либо материал без НДС ÷ зафиксированный курс. */
  const planUsd = (plan: unknown, purchaseNumber: string | null, lotNumber: string | null, vatRate: number): number | null => {
    const direct = lotUsdPrice(null, [plan], { vatRate, purchaseNumber, lotNumber });
    if (direct.usd != null && direct.usd > 0) return direct.usd;
    const pl = plan as { materialExclVat?: unknown; costBreakdown?: { items?: { label?: string; value?: number }[] } } | null;
    const fix = pl?.costBreakdown?.items?.find((x) => x.label === "Курс ЦБ (фиксация)")?.value;
    const mat = Number(pl?.materialExclVat);
    return fix && fix > 0 && Number.isFinite(mat) && mat > 0 ? mat / fix : null;
  };
  const orderedYear = new Map<number, Ordered>();
  /** НДС заказанного, но не полученного меха по ставкам позиций закупки (с тем же масштабом, что и сумма). */
  const orderedVat: VatByRate = {};
  const unreceived = { paid: 0, due: 0, names: [] as string[], byFur: [] as { label: string; names: string[]; paid: number; due: number; ordered: Ordered; years: Map<number, Ordered>; usd: { q: number; s: number } }[] };
  const matName = new Map((await prisma.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  // Оплаты закупок без аукциона (З-2026-…): если у закупки есть лоты, это оплата конкретных видов меха, а не «мех не получен».
  const purchaseNo = new Map(debtInputs.allPurchases.map((p) => [p.number, p.id]));
  const purchasePaid: { id: string; paid: number }[] = [];
  for (const [name, m] of aucMoney) {
    const pid = purchaseNo.get(name);
    if (pid && allLots.some((l) => l.purchaseId === pid)) {
      const all = allLots.filter((l) => l.purchaseId === pid).reduce((a, l) => a + l.recvIncl, 0);
      const sel = lotsAllYears.filter((l) => l.purchaseId === pid).reduce((a, l) => a + l.recvIncl, 0);
      purchasePaid.push({ id: pid, paid: all > 0 ? m.paid * (sel / all) : 0 });
      aucMoney.delete(name);
      continue;
    }
    if ((aucTotalValue.get(name) ?? 0) > 0 || (Math.abs(m.paid) < 0.5 && Math.abs(m.due) < 0.5)) continue;
    unreceived.paid += m.paid; unreceived.due += m.due;
    if (!/^З-\d{4}-\d+$/.test(name)) unreceived.names.push(name);
    // Состав заказа (ещё без лотов): делим деньги по видам меха пропорционально стоимости позиций.
    const byFurVal = new Map<string, Ordered>();
    const byFurYear = new Map<string, Map<number, Ordered>>();
    const byFurUsd = new Map<string, { q: number; s: number }>();
    const byFurVat = new Map<string, VatByRate>();
    for (const p of debtInputs.allPurchases) {
      if (p.status === "CANCELLED" || auctionName(p.auctionSession) !== name || !inYear(p.orderDate, year)) continue;
      for (const it of p.items) {
        const nm = matName.get((it as { rawMaterialId?: string }).rawMaterialId ?? "");
        if (!nm) continue;
        const k = furName(nm);
        const q = it.quantity?.toNumber() ?? 0, incl = it.subtotal.mul(it.vatRate.div(100).add(1)).toNumber(), excl = it.subtotal.toNumber();
        const cur = byFurVal.get(k) ?? { qty: 0, incl: 0, excl: 0 };
        cur.qty += q; cur.incl += incl; cur.excl += excl;
        byFurVal.set(k, cur);
        const bv = byFurVat.get(k) ?? {}; addVat(bv, it.vatRate.toNumber(), incl - excl); byFurVat.set(k, bv);
        // По годам закупки и цена в $ (из расчёта позиции): нужны окнам «Цена по видам сырья» для вида без лотов (рысь).
        const yr = p.orderDate ? p.orderDate.getFullYear() : 2026;
        const ym = byFurYear.get(k) ?? new Map<number, Ordered>();
        const yc = ym.get(yr) ?? { qty: 0, incl: 0, excl: 0 };
        yc.qty += q; yc.incl += incl; yc.excl += excl; ym.set(yr, yc); byFurYear.set(k, ym);
        const usd = planUsd((it as { costPlan?: unknown }).costPlan, p.number, (it as { lotNumber?: string | null }).lotNumber ?? null, it.vatRate.toNumber());
        if (usd != null && q > 0) { const u = byFurUsd.get(k) ?? { q: 0, s: 0 }; u.q += q; u.s += q * usd; byFurUsd.set(k, u); }
      }
    }
    const totV = Array.from(byFurVal.values()).reduce((a, v) => a + v.incl, 0);
    // Позиции закупки иногда внесены без цены (СП 09.26): общую сумму берём из расчёта закупки, а по видам делим по позициям.
    const aucTotal = debtRaw.byAuction.find((x) => x.name === name)?.total.toNumber() ?? totV;
    const scale = totV > 0 ? aucTotal / totV : 1;
    if (totV > 0) for (const [label, v] of byFurVal) {
      if (!orderedOk(label, name)) continue;
      const g = unreceived.byFur.find((x) => x.label === label) ?? (unreceived.byFur.push({ label, names: [], paid: 0, due: 0, ordered: { qty: 0, incl: 0, excl: 0 }, years: new Map(), usd: { q: 0, s: 0 } }), unreceived.byFur[unreceived.byFur.length - 1]);
      g.paid += m.paid * (v.incl / totV); g.due += m.due * (v.incl / totV); if (!g.names.includes(name)) g.names.push(name);
      g.ordered.qty += v.qty; g.ordered.incl += v.incl * scale; g.ordered.excl += v.excl * scale;
      for (const [rate, x] of Object.entries(byFurVat.get(label) ?? {})) addVat(orderedVat, rate, x * scale);
      for (const [yr, yv] of byFurYear.get(label) ?? []) {
        const yc = g.years.get(yr) ?? { qty: 0, incl: 0, excl: 0 };
        yc.qty += yv.qty; yc.incl += yv.incl * scale; yc.excl += yv.excl * scale; g.years.set(yr, yc);
      }
      const uv = byFurUsd.get(label); if (uv) { g.usd.q += uv.q; g.usd.s += uv.s; }
    }
    // По годам закупки (для «Динамики по годам»).
    for (const p of debtInputs.allPurchases) {
      if (p.status === "CANCELLED" || auctionName(p.auctionSession) !== name || !inYear(p.orderDate, year) || !p.orderDate) continue;
      const y = p.orderDate.getFullYear();
      const cur = orderedYear.get(y) ?? { qty: 0, incl: 0, excl: 0 };
      for (const it of p.items) {
        const nm = matName.get((it as { rawMaterialId?: string }).rawMaterialId ?? "");
        if (!nm || !orderedOk(furName(nm), name)) continue;
        cur.qty += it.quantity?.toNumber() ?? 0; cur.incl += it.subtotal.mul(it.vatRate.div(100).add(1)).toNumber() * scale; cur.excl += it.subtotal.toNumber() * scale;
      }
      orderedYear.set(y, cur);
    }
  }
  // Подкладка: лоты разных поставок записаны вперемешку (поставка 05.26 частично лежит в лотах 07.25), поэтому оплату и долг
  // делим по доле стоимости между ВСЕМИ лотами подкладки, а не внутри «своего» аукциона — иначе у отдельной ткани «оплачено» выходит больше «куплено».
  // В пул идут аукционы подкладки, по которым в выбранном году есть оплаты или долг (лоты — все лоты этих аукционов).
  const liningAucs = new Set(allLots.filter((l) => l.kind === "lining" && (Math.abs(aucMoney.get(l.auction)?.paid ?? 0) >= 0.5 || Math.abs(aucMoney.get(l.auction)?.due ?? 0) >= 0.5)).map((l) => l.auction));
  const liningPool = { paid: 0, due: 0, value: allLots.filter((l) => l.kind === "lining" && liningAucs.has(l.auction)).reduce((a, l) => a + l.recvIncl, 0) };
  for (const au of liningAucs) {
    const tot = aucTotalValue.get(au) ?? 0;
    const lin = allLots.filter((l) => l.auction === au && l.kind === "lining").reduce((a, l) => a + l.recvIncl, 0);
    const m = aucMoney.get(au);
    if (m && tot > 0) { liningPool.paid += m.paid * (lin / tot); liningPool.due += m.due * (lin / tot); }
  }
  const moneyOf = (auction: string, lots: FurLot[]) => {
    if (lots.length > 0 && lots.every((l) => l.kind === "lining")) {
      const share = liningPool.value > 0 ? lots.reduce((a, l) => a + l.recvIncl, 0) / liningPool.value : 0;
      return { paid: liningPool.paid * share, due: liningPool.due * share };
    }
    const tot = aucTotalValue.get(auction) ?? 0;
    const share = tot > 0 ? lots.reduce((a, l) => a + l.recvIncl, 0) / tot : 0;
    const m = aucMoney.get(auction);
    return { paid: (m?.paid ?? 0) * share, due: (m?.due ?? 0) * share };
  };
  for (const [k, ls] of groups) {
    const byAuc = new Map<string, { label: string; lots: FurLot[] }>();
    for (const l of ls) {
      const g = byAuc.get(l.auction) ?? { label: l.auction === "__none" ? "Без аукциона" : labeler(l.auction).label, lots: [] };
      g.lots.push(l);
      byAuc.set(l.auction, g);
    }
    rawTable.push({
      key: k, label: ls[0].item, kind: ls[0].kind, cells: cellsPair(ls, c4k), lots: ls.length, ...(ls[0].kind === "lining" ? { lotIds: ls.map((l) => l.id) } : {}),
      ...((): { paid: number; due: number } => { let paid = 0, due = 0; for (const [au, g] of byAuc) { const m = moneyOf(au, g.lots); paid += m.paid; due += m.due; } return { paid, due }; })(),
      usd: (() => { const f = figures(flowOf(ls), { vat: "incl", c4: c4k }); return { bought: f.usdAvg, used: f.usdUsedAvg, rem: f.usdRemAvg }; })(),
      years: Array.from(new Set(ls.map((l) => l.year))).sort((a, b) => a - b).map((y) => {
        const yl = ls.filter((l) => l.year === y);
        const f = figures(flowOf(yl), { vat: "incl", c4: c4k });
        return { year: y, cells: cellsPair(yl, c4k), usd: { bought: f.usdAvg, used: f.usdUsedAvg, rem: f.usdRemAvg } };
      }),
      auctions: Array.from(byAuc, ([key, g]) => ({ key, label: g.label, cells: cellsPair(g.lots, c4k), ...moneyOf(key, g.lots) })).sort((a, b) => b.cells.incl.rv - a.cells.incl.rv),
    });
  }
  rawTable.sort((a, b) => Number(a.kind === "lining") - Number(b.kind === "lining") || b.cells.incl.rv - a.cells.incl.rv);
  const rawTableTotal = cellsPair(lotsYear, c4k);

  // «Динамика по годам»: годы шапки не влияют — показаны все; фильтры панели действуют (кроме долга и оплат).
  const yearSet = new Set<number>(availableYears().map(Number));
  for (const l of lotsAllYears) yearSet.add(l.year);
  for (const o of ordersFiltered) if (o.year != null) yearSet.add(o.year);
  const yearList = Array.from(yearSet).sort((a, b) => a - b);
  const debtFor = (y: YearFilter) => supplierDebtFromInputs(debtInputs, y);
  // Задолженность по подкладке по годам: остаток каждого аукциона × доля подкладки в его лотах, год — по названию аукциона.
  const debtLiningByYear = new Map<number, number>();
  for (const a of supplierDebtFromInputs(debtInputs, "all").byAuction) {
    const m = /(\d{2})[-.](\d{2})\s*$/.exec(a.name.trim());
    const y = m ? 2000 + Number(m[2]) : 2026;
    const ls = allLots.filter((l) => l.auction === a.name);
    const tot = ls.reduce((x, l) => x + l.recvIncl, 0);
    const lin = tot > 0 ? ls.filter((l) => l.kind === "lining").reduce((x, l) => x + l.recvIncl, 0) / tot : 0;
    debtLiningByYear.set(y, (debtLiningByYear.get(y) ?? 0) + a.due.toNumber() * lin);
  }
  // Строка года: сырьё по году закупки лота, «произведено» — факт по всем ТЗ года ТЗ (завершённые и в работе), долг/оплаты — как loadSupplierDebt(год).
  const mkYear = (key: string, label: string, lots: FurLot[], orders: OrderRow[], d: SupplierDebt): YearRow => {
    const t = prodTotals(orders);
    return {
      key, label,
      fur: withHides(withOrdered(cellsPair(lots.filter((l) => l.kind === "fur"), c4k), orderedYear.get(Number(key))), hidesYear.get(Number(key))),
      lining: cellsPair(lots.filter((l) => l.kind === "lining"), c4k),
      prod: { qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum },
      paid: ovAll.filter((r) => r.year === Number(key)).reduce((a, r) => a + r.fur + r.lining, 0),
      debt: ovLeftAll.byYear.get(Number(key))?.raw ?? 0,
      money: (() => {
        const rowsY = ovAll.filter((r) => r.year === Number(key));
        const debtY = ovLeftAll.byYear.get(Number(key))?.raw ?? 0;
        const dl = debtLiningByYear.get(Number(key)) ?? 0;
        return { fur: { paid: rowsY.reduce((a, r) => a + r.fur, 0), debt: debtY - dl }, lining: { paid: rowsY.reduce((a, r) => a + r.lining, 0), debt: dl } };
      })(),
    };
  };
  const yearRows: YearRow[] = yearList.map((y) => mkYear(String(y), String(y), lotsAllYears.filter((l) => l.year === y), ordersFiltered.filter((o) => o.year === y), debtFor(String(y) as YearFilter)));
  const noYear = ordersFiltered.filter((o) => o.year == null);
  if (noYear.some((o) => o.qty !== 0 || o.costIncl !== 0)) {
    const t = prodTotals(noYear);
    const empty = cellsPair([], c4k);
    yearRows.push({ key: "none", label: "Без даты", fur: empty, lining: empty, prod: { qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum }, paid: 0, debt: 0, money: { fur: { paid: 0, debt: 0 }, lining: { paid: 0, debt: 0 } } });
  }
  // «Итого» = сумма строк по каждой аддитивной колонке (куплено, использовано, остаток, произведено, оплачено, долг).
  // Средневзвешенные цены в итоговой строке считаются от сумм, а не складываются.
  const sumCells = (list: Cells[]): Cells => {
    const t = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const avg = (v: number, q: number) => (q > 0 ? r2(v / q) : null);
    return { rq: r3(t.rq), rv: r2(t.rv), ra: avg(t.rv, t.rq), uq: r3(t.uq), uv: r2(t.uv), ua: avg(t.uv, t.uq), mq: r3(t.mq), mv: r2(t.mv), ma: avg(t.mv, t.mq), uo: r2(t.uo), uoa: avg(t.uo, t.uq) };
  };
  const sumPair = (list: CellsPair[]): CellsPair => ({ incl: sumCells(list.map((c) => c.incl)), excl: sumCells(list.map((c) => c.excl)) });
  // Строки, где нет ни одной ненулевой цифры, не показываем (в сумму они ничего не вносят).
  const hasData = (r: YearRow) => [r.fur.incl, r.lining.incl].some((c) => c.rq !== 0 || c.uq !== 0 || c.mq !== 0 || c.rv !== 0) || r.prod.qty !== 0 || r.prod.costIncl !== 0 || r.paid !== 0 || r.debt !== 0;
  const buildYears = (): YearRow[] => {
    const shownRows = yearRows.filter(hasData);
    const totalRow: YearRow = {
      key: "all", label: "Всего, ₽",
      fur: sumPair(yearRows.map((r) => r.fur)),
      lining: sumPair(yearRows.map((r) => r.lining)),
      prod: yearRows.reduce((a, r) => ({ qty: a.qty + r.prod.qty, costIncl: a.costIncl + r.prod.costIncl, costExcl: a.costExcl + r.prod.costExcl, work: a.work + r.prod.work }), { qty: 0, costIncl: 0, costExcl: 0, work: 0 }),
      paid: yearRows.reduce((a, r) => a + r.paid, 0),
      debt: yearRows.reduce((a, r) => a + r.debt, 0),
      money: {
        fur: { paid: yearRows.reduce((a, r) => a + r.money.fur.paid, 0), debt: yearRows.reduce((a, r) => a + r.money.fur.debt, 0) },
        lining: { paid: yearRows.reduce((a, r) => a + r.money.lining.paid, 0), debt: yearRows.reduce((a, r) => a + r.money.lining.debt, 0) },
      },
    };
    return [...shownRows, totalRow];
  };
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

  // Долг заказчиков (давальческие ТЗ): единая функция loadClientDebt (payment-alloc.ts) — работа выбранных ТЗ
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
  const supplierCashPaid = debt.paid.add(debt.unlinkedAdvances).toNumber();
  const ovLeft = ovLeftAll;
  const ovYear = ovAll.filter((r) => year === "all" || r.year === Number(year));
  const sumOv = (k: "fur" | "lining" | "work") => ovYear.reduce((a, r) => a + r[k], 0);
  const paidByItem = { fur: sumOv("fur"), lining: sumOv("lining"), work: sumOv("work") };
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
  const left = { raw: leftRaw, fur: leftRaw - leftLining, lining: leftLining, prod: leftYears.reduce((a, [, v]) => a + v.prod, 0) };

  // «Прочее» (закупки без аукциона, шкуры подрядчика, поправки) — это конкретные виды меха: переносим в их строки.
  // Долг — по лотам своей закупки; оплаты (шкуры подрядчика) — по доле лотов без аукциона.
  {
    const restPaid = hidesTotal.incl; // шкуры подрядчика (по выбранным ТЗ)
    const rowOf = (item: string, kind: "fur" | "lining" = "fur") => {
      let r = rawTable.find((x) => x.label === item && x.kind === kind);
      if (!r) { // вид, лоты которого лежат в другом году (оплата 2026 за лоты 2025): строка без лотов в этом году
        r = { key: `${kind}|${item}`, label: item, kind, cells: cellsPair([], c4k), paid: 0, due: 0, usd: { bought: null, used: null, rem: null }, auctions: [], years: [], lots: 0 };
        rawTable.push(r);
      }
      return r;
    };
    for (const x of purchasePaid) {
      const ls = lotsAllYears.filter((l) => l.purchaseId === x.id);
      const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
      const byKey = new Map<string, { item: string; kind: "fur" | "lining"; v: number }>();
      for (const l of ls) { const k = `${l.kind}|${l.item}`; byKey.set(k, { item: l.item, kind: l.kind, v: (byKey.get(k)?.v ?? 0) + l.recvIncl }); }
      if (tot > 0) for (const g of byKey.values()) { const r = rowOf(g.item, g.kind); if (r) { const add = x.paid * (g.v / tot); r.paid += add; const a = r.auctions.find((y) => y.key === "__none"); if (a) a.paid += add; else r.auctions.push({ key: "__none", label: "Без аукциона", cells: cellsPair([], c4k), paid: add, due: 0 }); } }
    }
    const addTo = (r: RawTableRow, paid: number, due: number) => {
      r.paid += paid; r.due += due;
      const g = r.auctions.find((x) => x.key === "__none");
      if (g) { g.paid += paid; g.due += due; }
    };
    // Остаток оплат — шкуры подрядчика (свакара, фондю), оплаченные в составе счетов за пошив: относим к свакаре.
    if (Math.abs(restPaid) >= 0.5) {
      const r = rowOf("Свакара");
      if (r) {
        r.paid += restPaid; r.cells = withHides(r.cells, hidesTotal);
        r.auctions.push({ key: "hides", label: "Шкуры подрядчика", cells: withHides(cellsPair([], c4k), hidesTotal), paid: restPaid, due: 0 });
      }
    }
    for (const p of purchasesYear) {
      if (p.auctionSession && auctionName(p.auctionSession)) continue;
      const due = purchaseTotalInclVat(p).sub(p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a.add(x.amount), new Decimal(0))).toNumber();
      if (due < 0.5) continue;
      const ls = lotsYear.filter((l) => l.kind === "fur" && l.purchaseId === p.id);
      const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
      if (tot <= 0) continue;
      const byItem = new Map<string, number>();
      for (const l of ls) byItem.set(l.item, (byItem.get(l.item) ?? 0) + l.recvIncl);
      for (const [item, v] of byItem) { const r = rowOf(item); if (r) addTo(r, 0, due * (v / tot)); }
    }
  }

  // Деньги по закупкам, где лотов ещё нет (FH 06.26, СП 09.26), — внутрь строк своего вида меха (подстрока «ещё не получен»); для вида без лотов (рысь) строка создаётся.
  for (const g of unreceived.byFur) {
    let r = rawTable.find((x) => x.kind === "fur" && x.label === g.label);
    if (!r) {
      r = { key: `fur|${g.label}`, label: g.label, kind: "fur", cells: cellsPair([], c4k), paid: 0, due: 0, usd: { bought: null, used: null, rem: null }, auctions: [], years: [], lots: 0 };
      rawTable.push(r);
    }
    r.paid += g.paid; r.due += g.due;
    r.cells = withOrdered(r.cells, g.ordered);
    // По годам закупки (окна цен): заказанное, но не полученное, раскрывается по году закупки, как обычные лоты.
    for (const [yr, yv] of g.years) {
      const ex = r.years.find((y) => y.year === yr);
      if (ex) ex.cells = withOrdered(ex.cells, yv);
      else r.years.push({ year: yr, cells: withOrdered(cellsPair([], c4k), yv), usd: { bought: null, used: null, rem: null } });
    }
    r.years.sort((a, b) => a.year - b.year);
    // Цена в $ у вида без лотов (рысь): по расчёту позиций закупки; у вида с лотами остаётся цена по лотам.
    if (g.usd.q > 0 && r.usd.bought == null) {
      const avg = g.usd.s / g.usd.q;
      r.usd = { bought: avg, used: r.usd.used, rem: avg };
      for (const y of r.years) if (y.usd.bought == null) y.usd = { bought: avg, used: null, rem: avg };
    }
    r.auctions.push({ key: `unrecv|${g.names.join(",")}`, label: `${g.names.join(", ")}`, cells: withOrdered(cellsPair([], c4k), g.ordered), paid: g.paid, due: g.due });
  }
  rawTable.sort((a, b) => Number(a.kind === "lining") - Number(b.kind === "lining") || b.cells.incl.rv - a.cells.incl.rv || b.paid - a.paid);
  const orderedAll = unreceived.byFur.reduce((a, g) => ({ qty: a.qty + g.ordered.qty, incl: a.incl + g.ordered.incl, excl: a.excl + g.ordered.excl }), { qty: 0, incl: 0, excl: 0 });
  const rawTableTotalAll = withHides(withOrdered(rawTableTotal, orderedAll), hidesTotal);
  const addHidesFig = (f: FlowFigures, v: number): FlowFigures => ({ ...f, recvValue: f.recvValue + v, recvAvg: f.recvQty > 0 ? Math.round(((f.recvValue + v) / f.recvQty) * 100) / 100 : null, usedValue: f.usedValue + v, usedValueOther: f.usedValueOther + v, usedAvg: f.usedQty > 0 ? Math.round(((f.usedValue + v) / f.usedQty) * 100) / 100 : null });
  const furPairAll = { incl: addHidesFig(bumpFigures(furPair.incl, orderedAll.qty, orderedAll.incl), hidesTotal.incl), excl: addHidesFig(bumpFigures(furPair.excl, orderedAll.qty, orderedAll.excl), hidesTotal.excl) };
  const synth = (id: string, item: string, auction: string, year0: number, o: { qty: number; incl: number; excl: number }, used: { incl: number; excl: number } | null, money: { paid: number; due: number }, plan?: { q: number; s: number }): FurLot => ({
    id, kind: "fur", item, materialName: item, color: NOT_SET, size: NOT_SET, sizes: [], attrs: [], auction, auctionLabel: labeler(auction).label || auction, year: year0,
    lotNumber: used ? "шкуры подрядчика" : "заказано, не получено", grade: "", purchaseId: null, purchaseNumber: null, supplier: null,
    recv: o.qty, used: 0, rem: o.qty, recvIncl: o.incl, recvExcl: o.excl,
    usedIncl: used?.incl ?? 0, usedExcl: used?.excl ?? 0, usedExtraIncl: 0, usedExtraExcl: 0,
    remIncl: used ? 0 : o.incl, remExcl: used ? 0 : o.excl,
    vatRate: 22, usdPrice: null, usdSource: "none", usdQty: 0, usdSubtotal: 0, usdUsedQty: 0, usdUsedSubtotal: 0, usdRemQty: 0, usdRemSubtotal: 0,
    usdQtyDirect: 0, usdQtyEur: 0, usdQtyRub: 0, usdQtyCalc: 0, usages: [],
    purchaseStatus: used ? "RECEIVED" : "DRAFT", paid: money.paid, due: money.due, usdPlanQty: plan?.q, usdPlanSubtotal: plan?.s,
  });
  const syntheticLots: FurLot[] = [
    ...unreceived.byFur.map((g) => synth(`ordered:${g.label}`, g.label, g.names[0] ?? "Заказано", 2026, g.ordered, null, { paid: g.paid, due: g.due }, g.usd)),
    // Шкуры подрядчика — по году оплаты (год лота = год оплаты): фильтр «Год закупки» таблицы «Сырьё» делит их так же, как Главная.
    ...(hidesTotal.incl > 0.5 ? Array.from(hidesYear).filter(([, v]) => v.incl > 0).sort((a, b) => a[0] - b[0]).map(([y, v]) => synth(`hides:${y}`, "Свакара", "Шкуры подрядчика", y, { qty: 0, incl: v.incl, excl: v.excl }, { incl: v.incl, excl: v.excl }, { paid: v.incl, due: 0 })) : []),
  ];

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
    if (dueP < 0.5) continue;
    const ls = allLots.filter((l) => l.kind === "fur" && l.purchaseId === p.id);
    const tot = ls.reduce((a, l) => a + l.recvIncl, 0);
    if (tot > 0) for (const l of ls) lotMoney[l.id].due += dueP * (l.recvIncl / tot);
  }
  const unreceivedLeft = { paid: unreceived.paid - unreceived.byFur.reduce((a, g) => a + g.paid, 0), due: unreceived.due - unreceived.byFur.reduce((a, g) => a + g.due, 0), names: unreceived.names, byFur: [] as typeof unreceived.byFur };

  // Фильтры панели: деньги по сырью — сумма строк таблицы (они уже по выбранным лотам), «Работа» — по выбранным ТЗ.
  const moneyFromRows = lotFiltersOn(f) || orderFiltersOn(f);
  const sumRows = (kind: "fur" | "lining", k: "paid" | "due") => rawTable.filter((r) => r.kind === kind).reduce((a, r) => a + r[k], 0);
  let paidOut = paidByItem, leftOut = left;
  if (moneyFromRows) {
    paidOut = { ...paidByItem, fur: sumRows("fur", "paid"), lining: sumRows("lining", "paid") };
    leftOut = { ...left, fur: sumRows("fur", "due"), lining: sumRows("lining", "due"), raw: sumRows("fur", "due") + sumRows("lining", "due") };
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
  const lotVat = (ls: FurLot[], k: "recv" | "used" | "rem"): VatByRate => {
    const m: VatByRate = {};
    for (const l of ls) addVat(m, l.vatRate, k === "recv" ? l.recvIncl - l.recvExcl : k === "used" ? l.usedIncl - l.usedExcl : l.remIncl - l.remExcl);
    return m;
  };
  const mergeVat = (...list: VatByRate[]): VatByRate => { const m: VatByRate = {}; for (const x of list) for (const [r, v] of Object.entries(x)) addVat(m, r, v); return m; };
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
    left: leftOut,
    overpaid: debt.overpaid.map((o) => ({ name: o.name, amount: o.amount.toNumber() })),
    hides: hidesTotal,
    ordered: orderedAll,
    syntheticLots,
    lotMoney,
    rawMoneyTotal: { paid: paidOut.fur + paidOut.lining, due: leftOut.raw, unreceived: unreceivedOut },
    raw: { fur: furPairAll, lining: liningPair, lots: lotsYear.length },
    prod: { done: prodTotals(ordersYear.filter(isDone)), work: prodTotals(ordersYear.filter((o) => !isDone(o))), all: prodTotals(ordersYear) },
    rawTable, rawTableTotal: rawTableTotalAll, years, debt,
    supplierCashPaid,
    clientDebts, clientDebtInfo: { allocated: clientDebt.allocated, unallocated: clientDebt.unallocated, unallocatedAll: clientDebt.unallocatedAll, unallocatedApplied: clientDebt.unallocatedApplied, unallocatedByKind: clientDebt.unallocatedByKind }, invoiceDeadlines, control, options: { ...options, fur: withOrderFurOptions(options.fur, ordersAll) }, noColorLots,
    noGroup: { repair: ordersAll.filter((o) => !o.categoryGroup && o.category === REPAIR_CATEGORY).length, other: ordersAll.filter((o) => !o.categoryGroup && o.category !== REPAIR_CATEGORY).length },
    orderIds: ordersYear.map((o) => o.id),
    furTotalLots: lotsYear.length,
    bridge: {
      usedBase: { incl: usedBaseOf("incl"), excl: usedBaseOf("excl") },
      usedComparable: year === "all" && !lotFiltersOn(f),
      purchases: { received: sumPurch((st) => st === "RECEIVED"), draft: sumPurch((st) => st !== "RECEIVED") },
      clientWork: { done: workOf((o) => o.clientName != null && isDone(o)), work: workOf((o) => o.clientName != null && !isDone(o)), noClient: workOf((o) => o.clientName == null) },
    },
  };
}
