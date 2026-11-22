import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { payLites } from "@/lib/cashflow-detail";
import { loadReportSizes } from "@/lib/margin-server";
import { fitReceipts, prepaidItems, buildCashflow, vatShares, aggregateSales, monthsOf, parsePeriod, workByClass, currentMonthMsk } from "@/lib/cashflow";
import { loadPurchaseVat, loadSalesLines, loadOrderClasses } from "@/lib/cashflow-server";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { CashflowView } from "./cashflow-view";
import { loadDataAsOf } from "@/lib/data-as-of";
import { DataAsOf } from "@/components/data-as-of";

export const metadata = { title: "Cashflow" };

export default async function CashflowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Деньги компании: владелец, администратор, бухгалтер (решение 22.11.2026); внешнего поставщика (SUPPLIER) requireRole сюда не пускает.
  const session = await requireRole(...ACCESS.cashflow);
  const sp = await searchParams;
  const org = session.user.organizationId;
  const [rows, purchaseVat, lines] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org), loadSalesLines(org)]);
  const vs = vatShares(rows, purchaseVat);
  const incl = buildCashflow(rows, "all");
  const ex = buildCashflow(rows, "all", vs.share);
  const months = monthsOf("all");
  const salesRaw = { clothes: aggregateSales(lines, months, "clothes"), acc: aggregateSales(lines, months, "acc"), other: aggregateSales(lines, months, "other") };
  // Приход — по отчёту «заказ и продажи» (637), даты — по строкам файла; нет отчёта — как в файле (659).
  const repSizes = await loadReportSizes(org);
  const repOf = (cls: string) => repSizes.filter((r) => r.cls === cls).reduce((a, r) => a + Object.values(r.seas ?? {}).reduce((x, c) => x + (c.deliv ?? 0), 0), 0);
  const useRep = repSizes.some((r) => r.seas);
  const fitted = useRep ? { clothes: fitReceipts(salesRaw.clothes, repOf("clothes")), acc: fitReceipts(salesRaw.acc, repOf("acc")), other: fitReceipts(salesRaw.other, repOf("other")) } : salesRaw;
  const allBase = aggregateSales(lines, months);
  const salesBy = { all: useRep ? { ...allBase, recPcs: allBase.recPcs.map((_, i) => fitted.clothes.recPcs[i] + fitted.acc.recPcs[i] + fitted.other.recPcs[i]) } : allBase, ...fitted };
  /** Предоплата за заказы, по которым товар ещё не принят (деньги ушли, лотов нет). */
  const dash = await loadDashboard(org, "all", parseDashFilters({}), "off");
  const prepaidNames = new Set(dash.rawMoneyTotal.unreceived.names);
  const prepaidBy: Record<string, number> = {};
  for (const r of rows) if (r.kind === "raw" && prepaidNames.has(r.label)) prepaidBy[r.iso.slice(0, 7)] = (prepaidBy[r.iso.slice(0, 7)] ?? 0) + r.amount;
  const prepaid = Object.values(prepaidBy).reduce((t, v) => t + v, 0);
  const orderCls = await loadOrderClasses(org);
  const work = workByClass(rows, orderCls, months);
  const workEx = workByClass(rows, orderCls, months, vs.share);
  const asOf = await loadDataAsOf(org);
  return (
    <><DataAsOf asOf={asOf} /><CashflowView prepaidList={prepaidItems(rows, prepaidNames)} prepaid={prepaid} prepaidBy={prepaidBy} incl={incl} ex={ex} salesBy={salesBy} vat={{ vat: vs.vat, unknown: vs.unknown, total: incl.total + incl.outside }} initialPeriod={parsePeriod(sp.p)} workBy={work} workByEx={workEx} pays={payLites(rows, vs.share, orderCls)} saleLines={lines.filter((l) => l.kind === "SALE")} initialGroup={sp.group === "category" ? "category" : "period"} nowMonth={currentMonthMsk()} /></>
  );
}
