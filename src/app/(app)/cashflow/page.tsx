import { requireSession } from "@/lib/session";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { buildCashflow, vatShares, aggregateSales, monthsOf, parsePeriod, workByClass } from "@/lib/cashflow";
import { loadPurchaseVat, loadServiceParts, loadSalesLines, loadOrderClasses } from "@/lib/cashflow-server";
import { loadMarginInput } from "@/lib/margin-server";
import { buildMargin } from "@/lib/margin";
import { getCommission4Mode } from "@/lib/commission4-mode";
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
  const marginIn = await loadMarginInput(org, await getCommission4Mode());
  const marginBy = { all: marginIn ? buildMargin(marginIn) : null, clothes: marginIn ? buildMargin(marginIn, "clothes") : null, acc: marginIn ? buildMargin(marginIn, "acc") : null };
  const months = monthsOf("all");
  const salesBy = { all: aggregateSales(lines, months), clothes: aggregateSales(lines, months, "clothes"), acc: aggregateSales(lines, months, "acc"), other: aggregateSales(lines, months, "other") };
  const work = workByClass(rows, await loadOrderClasses(org), months);
  return (
    <CashflowView incl={incl} ex={ex} salesBy={salesBy} vat={{ vat: vs.vat, unknown: vs.unknown, total: incl.total + incl.outside }} services={services} initialPeriod={parsePeriod(sp.p)} marginBy={marginBy} workBy={work} />
  );
}
