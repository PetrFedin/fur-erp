import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { serializeInput } from "@/lib/margin";
import { loadChain, loadSalesInput } from "@/lib/sales-server";
import { loadDatamartStock } from "@/lib/datamart-stock";
import { todayMsk } from "@/lib/sales-section";
import { parseUi } from "@/lib/sales-url";
import { SalesView } from "./sales-view";
import { loadDataAsOf } from "@/lib/data-as-of";
import { DataAsOf } from "@/components/data-as-of";

export const metadata = { title: "Продажи и остатки" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // requireSession без allowSupplier: внешнего поставщика (SUPPLIER) сюда не пускаем — ни страницу, ни данные.
  const session = await requireSession();
  const sp = await searchParams;
  const c4 = await getCommission4Mode();
  const [data, chain, asOf, dmStock] = await Promise.all([loadSalesInput(session.user.organizationId, c4), loadChain(session.user.organizationId, c4), loadDataAsOf(session.user.organizationId), loadDatamartStock(session.user.organizationId)]);
  return <><DataAsOf asOf={asOf} /><SalesView input={serializeInput(data.input)} sizes={data.sizes} photos={data.photos} today={todayMsk()} initial={parseUi(sp)} chain={chain} dmStock={dmStock} /></>;
}
