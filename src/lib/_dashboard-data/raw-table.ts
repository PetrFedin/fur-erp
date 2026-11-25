import { isZero, isPositive } from "@/domain/money";
// Шаги расчёта Сводки: таблица «Динамика по сырью» — строки по видам, деньги аукционов, «прочее» и заказанное (вынесено из loadDashboardImpl без изменений).
import { Decimal } from "@prisma/client/runtime/library";
import { figures, flowOf, type C4Kind, type FurLot } from "@/lib/fur-table";
import type { auctionLabeler } from "@/lib/filter-options";
import { auctionName } from "@/lib/auction-names";
import type { loadDebtInputs } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { BOUGHT_ORDERED, cellsPair, withHides, withOrdered } from "./cells";
import type { RawTableRow } from "./types";
import type { Unreceived } from "./unreceived";

type AucMoney = Map<string, { paid: number; due: number }>;

/** Строки таблицы «по сырью» по лотам года и деньги аукционов по доле стоимости лотов (moneyOf нужен и для денег по лотам). */
export function buildRawTable({ lotsYear, allLots, aucMoney, aucTotalValue, labeler, c4k }: {
  lotsYear: FurLot[];
  allLots: FurLot[];
  aucMoney: AucMoney;
  aucTotalValue: Map<string, number>;
  labeler: Awaited<ReturnType<typeof auctionLabeler>>;
  c4k: C4Kind;
}) {
  // Таблица «по сырью»
  const rawTable: RawTableRow[] = [];
  const groups = new Map<string, FurLot[]>();
  for (const l of lotsYear) {
    const k = `${l.kind}|${l.item}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  // Подкладка: лоты разных поставок записаны вперемешку (поставка 05.26 частично лежит в лотах 07.25), поэтому оплату и долг
  // делим по доле стоимости между ВСЕМИ лотами подкладки, а не внутри «своего» аукциона — иначе у отдельной ткани «оплачено» выходит больше «куплено».
  // В пул идут аукционы подкладки, по которым в выбранном году есть оплаты или долг (лоты — все лоты этих аукционов).
  const liningAucs = new Set(allLots.filter((l) => l.kind === "lining" && (!isZero(aucMoney.get(l.auction)?.paid ?? 0) || !isZero(aucMoney.get(l.auction)?.due ?? 0))).map((l) => l.auction));
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
  return { rawTable, rawTableTotal, moneyOf };
}

/** «Прочее» (закупки без аукциона, шкуры подрядчика, поправки) — это конкретные виды меха: переносим в их строки. */
export function applyRestToRawTable({ rawTable, hidesTotal, c4k, purchasePaid, lotsAllYears, surcharge, purchasesYear, lotsYear, allLots }: {
  rawTable: RawTableRow[];
  hidesTotal: { incl: number; excl: number };
  c4k: C4Kind;
  purchasePaid: { id: string; paid: number }[];
  lotsAllYears: FurLot[];
  surcharge: Map<string, number>;
  purchasesYear: Awaited<ReturnType<typeof loadDebtInputs>>["allPurchases"];
  lotsYear: FurLot[];
  allLots: FurLot[];
}) {
// Долг — по лотам своей закупки; оплаты (шкуры подрядчика) — по доле лотов без аукциона.
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
  // Остаток оплат — шкуры подрядчика (свакара, фондю), оплаченные в составе счетов за пошив: относим к свакаре. (hidesApply всегда false — ветка не работает.)
  if (!isZero(restPaid)) {
    const r = rowOf("Свакара");
    if (r) {
      r.paid += restPaid; r.cells = withHides(r.cells, hidesTotal);
      r.auctions.push({ key: "hides", label: "Шкуры подрядчика", cells: withHides(cellsPair([], c4k), hidesTotal), paid: restPaid, due: 0 });
    }
  }
  // Доплата подрядчику (НДС по сырью): в строки меха (по видам) и подкладки — к чему относится, а не отдельной строкой «поправки».
  if (surcharge.size > 0) {
    const lin = rawTable.filter((x) => x.kind === "lining").sort((a, b) => b.cells.incl.rv - a.cells.incl.rv)[0];
    for (const [key, amt] of surcharge) {
      const r = key === "lining" ? lin : rowOf(key.slice(4));
      if (!r || !isPositive(amt)) continue;
      r.paid += amt;
      r.auctions.push({ key: "hides", label: "Доплата подрядчику: НДС по сырью", cells: cellsPair([], c4k), paid: amt, due: 0 });
    }
  }
  for (const p of purchasesYear) {
    if (p.auctionSession && auctionName(p.auctionSession)) continue;
    const due = purchaseTotalInclVat(p).sub(p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a.add(x.amount), new Decimal(0))).toNumber();
    if (!isPositive(due)) continue;
    const ls = lotsYear.filter((l) => l.kind === "fur" && l.purchaseId === p.id);
    // База долевого деления — ВСЕ лоты закупки (как в lotMoney ниже): иначе при фильтре по виду меха на выбранный вид ложится весь долг многовидовой закупки.
    const tot = allLots.filter((l) => l.kind === "fur" && l.purchaseId === p.id).reduce((a, l) => a + l.recvIncl, 0);
    if (tot <= 0 || ls.length === 0) continue;
    const byItem = new Map<string, number>();
    for (const l of ls) byItem.set(l.item, (byItem.get(l.item) ?? 0) + l.recvIncl);
    for (const [item, v] of byItem) { const r = rowOf(item); if (r) addTo(r, 0, due * (v / tot)); }
  }
}

/** Деньги по закупкам, где лотов ещё нет, — внутрь строк своего вида меха. */
export function mergeUnreceived(rawTable: RawTableRow[], unreceived: Unreceived, c4k: C4Kind) {
  // Деньги по закупкам, где лотов ещё нет (FH 06.26, СП 09.26), — внутрь строк своего вида меха (подстрока «ещё не получен»); для вида без лотов (рысь) строка создаётся.
  for (const g of unreceived.byFur) {
    let r = rawTable.find((x) => x.kind === "fur" && x.label === g.label);
    if (!r) {
      r = { key: `fur|${g.label}`, label: g.label, kind: "fur", cells: cellsPair([], c4k), paid: 0, due: 0, usd: { bought: null, used: null, rem: null }, auctions: [], years: [], lots: 0 };
      rawTable.push(r);
    }
    r.paid += g.paid; r.due += g.due;
    if (!BOUGHT_ORDERED.has(g.label))r.ordered = { qty: (r.ordered?.qty ?? 0) + g.ordered.qty, incl: (r.ordered?.incl ?? 0) + g.ordered.incl, excl: (r.ordered?.excl ?? 0) + g.ordered.excl };
    const cnt = BOUGHT_ORDERED.has(g.label);
    r.cells = withOrdered(r.cells, cnt ? g.ordered : undefined);
    // По годам закупки (окна цен): заказанное, но не полученное, раскрывается по году закупки, как обычные лоты.
    for (const [yr, yv] of g.years) {
      const ex = r.years.find((y) => y.year === yr);
      if (ex) ex.cells = withOrdered(ex.cells, cnt ? yv : undefined);
      else r.years.push({ year: yr, cells: withOrdered(cellsPair([], c4k), cnt ? yv : undefined), usd: { bought: null, used: null, rem: null } });
    }
    r.years.sort((a, b) => a.year - b.year);
    // Цена в $ у вида без лотов (рысь): по расчёту позиций закупки; у вида с лотами остаётся цена по лотам.
    if (g.usd.q > 0 && r.usd.bought == null) {
      const avg = g.usd.s / g.usd.q;
      r.usd = { bought: avg, used: r.usd.used, rem: avg };
      for (const y of r.years) if (y.usd.bought == null) y.usd = { bought: avg, used: null, rem: avg };
    }
    r.auctions.push({ key: `unrecv|${g.names.join(",")}`, label: `${g.names.join(", ")}`, cells: withOrdered(cellsPair([], c4k), cnt ? g.ordered : undefined), paid: g.paid, due: g.due });
  }
  rawTable.sort((a, b) => Number(a.kind === "lining") - Number(b.kind === "lining") || b.cells.incl.rv - a.cells.incl.rv || b.paid - a.paid);
}
