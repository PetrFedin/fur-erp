import { requireSession } from "@/lib/session";
import { loadPaymentsOverview, loadPaymentsLeft } from "@/lib/payments-overview";
import { payLites } from "@/lib/cashflow-detail";
import { buildCashflow, vatShares, aggregateSales, monthsOf, parsePeriod, workByClass } from "@/lib/cashflow";
import { loadPurchaseVat, loadServiceParts, loadSalesLines, loadOrderClasses, loadShipmentMonths } from "@/lib/cashflow-server";
import { CashflowView } from "./cashflow-view";

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
  const shipMonths = await loadShipmentMonths(org);
  const orderCls = await loadOrderClasses(org);
  const work = workByClass(rows, orderCls, months);
  return (
    <CashflowView incl={incl} ex={ex} salesBy={salesBy} vat={{ vat: vs.vat, unknown: vs.unknown, total: incl.total + incl.outside }} services={services} initialPeriod={parsePeriod(sp.p)} workBy={work} pays={payLites(rows, vs.share, orderCls)} saleLines={lines.filter((l) => l.kind === "SALE")} shipMonths={shipMonths} left={{ raw: left.raw, prod: left.prod, advance: left.advance }} />
  );
}
