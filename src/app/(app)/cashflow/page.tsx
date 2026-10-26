import { requireSession } from "@/lib/session";
import { loadPaymentsOverview, loadPaymentsLeft } from "@/lib/payments-overview";
import { payLites } from "@/lib/cashflow-detail";
import { buildCashflow, vatShares, aggregateSales, monthsOf, parsePeriod, workByClass, currentMonthMsk } from "@/lib/cashflow";
import { loadPurchaseVat, loadServiceParts, loadSalesLines, loadOrderClasses } from "@/lib/cashflow-server";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { CashflowView } from "./cashflow-view";
import { loadDataAsOf } from "@/lib/data-as-of";
import { DataAsOf } from "@/components/data-as-of";

export const metadata = { title: "Cashflow" };

export default async function CashflowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // requireSession без allowSupplier: внешнего поставщика (SUPPLIER) сюда не пускаем — ни траты, ни розницу, ни продажи он не видит.
  const session = await requireSession();
  const sp = await searchParams;
  const org = session.user.organizationId;
  const [rows, purchaseVat, lines] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org), loadSalesLines(org)]);
  const vs = vatShares(rows, purchaseVat);
  const incl = buildCashflow(rows, "all");
  const ex = buildCashflow(rows, "all", vs.share);
  const services = await loadServiceParts(org, rows);
  const months = monthsOf("all");
  const salesBy = { all: aggregateSales(lines, months), clothes: aggregateSales(lines, months, "clothes"), acc: aggregateSales(lines, months, "acc"), other: aggregateSales(lines, months, "other") };
  const left = await loadPaymentsLeft(org);
  /** Предоплата за заказы, по которым товар ещё не принят (деньги ушли, лотов нет). */
  const dash = await loadDashboard(org, "all", parseDashFilters({}), "off");
  const prepaidNames = new Set(dash.rawMoneyTotal.unreceived.names);
  const prepaidBy: Record<string, number> = {};
  for (const r of rows) if (r.kind === "raw" && prepaidNames.has(r.label)) prepaidBy[r.iso.slice(0, 7)] = (prepaidBy[r.iso.slice(0, 7)] ?? 0) + r.amount;
  const prepaid = Object.values(prepaidBy).reduce((t, v) => t + v, 0);
  const orderCls = await loadOrderClasses(org);
  const work = workByClass(rows, orderCls, months);
  const asOf = await loadDataAsOf(org);
  return (
    <><DataAsOf asOf={asOf} /><CashflowView prepaid={prepaid} prepaidBy={prepaidBy} incl={incl} ex={ex} salesBy={salesBy} vat={{ vat: vs.vat, unknown: vs.unknown, total: incl.total + incl.outside }} services={services} initialPeriod={parsePeriod(sp.p)} workBy={work} pays={payLites(rows, vs.share, orderCls)} saleLines={lines.filter((l) => l.kind === "SALE")} initialGroup={sp.group === "category" ? "category" : "period"} nowMonth={currentMonthMsk()} left={{ raw: left.raw, prod: left.prod, advance: left.advance }} /></>
  );
}
