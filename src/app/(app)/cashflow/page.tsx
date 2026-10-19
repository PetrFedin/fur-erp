import { requireSession } from "@/lib/session";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { buildCashflow, vatShares, aggregateSales, monthsOf, parsePeriod } from "@/lib/cashflow";
import { loadPurchaseVat, loadServiceParts, loadSalesLines } from "@/lib/cashflow-server";
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
  const margin = marginIn ? buildMargin(marginIn) : null;
  const sales = aggregateSales(lines, monthsOf("all"));
  return (
    <CashflowView incl={incl} ex={ex} sales={sales} vat={{ vat: vs.vat, unknown: vs.unknown, total: incl.total + incl.outside }} services={services} initialPeriod={parsePeriod(sp.p)} margin={margin} />
  );
}
