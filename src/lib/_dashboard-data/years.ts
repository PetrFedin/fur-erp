// Шаг расчёта Сводки: «Динамика по годам» и мех по годам по источнику (вынесено из loadDashboardImpl без изменений).
import { Decimal } from "@prisma/client/runtime/library";
import type { loadPaymentsLeft, loadPaymentsOverview } from "@/lib/payments-overview";
import { classifyLotSource } from "@/lib/purchase-source";
import type { C4Kind, FurLot } from "@/lib/fur-table";
import type { OrderRow } from "@/lib/analytics-orders";
import { supplierDebtFromInputs, type loadDebtInputs, type SupplierDebt } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { isServicePurchase } from "@/lib/service-purchase";
import { availableYears, inYear, type YearFilter } from "@/lib/year-filter";
import { prodTotals } from "@/lib/dashboard-calc";
import { cellsPair, sumPair, withHides, withOrdered } from "./cells";
import type { DashboardData, Ordered, YearRow } from "./types";

export function buildYearRows({ lotsAllYears, ordersFiltered, debtInputs, allLots, orderedYear, hidesYear, c4k, ovAll, ovLeftAll }: {
  lotsAllYears: FurLot[];
  ordersFiltered: OrderRow[];
  debtInputs: Awaited<ReturnType<typeof loadDebtInputs>>;
  allLots: FurLot[];
  orderedYear: Map<number, Ordered>;
  hidesYear: Map<number, { incl: number; excl: number }>;
  c4k: C4Kind;
  ovAll: Awaited<ReturnType<typeof loadPaymentsOverview>>;
  ovLeftAll: Awaited<ReturnType<typeof loadPaymentsLeft>>;
}) {
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
        // Закупки-услуги (УПД без позиций сырья) — не мех: их неоплаченная часть идёт отдельной статьёй, как в «Расходах».
        const svc = debtInputs.allPurchases.filter((p) => isServicePurchase(p) && inYear(p.orderDate, key as YearFilter))
          .reduce((a, p) => a + Math.max(purchaseTotalInclVat(p).sub(p.payments.filter((x) => x.status === "COMPLETED").reduce((s2, x) => s2.add(x.amount), new Decimal(0))).toNumber(), 0), 0);
        return { fur: { paid: rowsY.reduce((a, r) => a + r.fur, 0), debt: debtY - dl - svc }, lining: { paid: rowsY.reduce((a, r) => a + r.lining, 0), debt: dl } };
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
  const yearsFurBySrc = (["auction", "supplier"] as const).reduce((acc, sr) => {
    acc[sr] = yearList.map((y) => {
      const base = cellsPair(lotsAllYears.filter((l) => l.year === y && l.kind === "fur" && classifyLotSource(l) === sr), c4k);
      const fur = sr === "auction" ? withOrdered(base, orderedYear.get(y)) : withHides(base, hidesYear.get(y));
      return { key: String(y), fur };
    });
    return acc;
  }, {} as DashboardData["yearsFurBySrc"]);
  const auctionSrc: Record<string, "auction" | "supplier"> = { __none: "supplier", hides: "supplier" };
  for (const l of allLots) if (l.kind === "fur" && !(l.auction in auctionSrc)) auctionSrc[l.auction] = classifyLotSource(l);
  return { yearList, yearRows, buildYears, yearsFurBySrc, auctionSrc };
}
