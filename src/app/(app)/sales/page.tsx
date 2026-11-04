import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { serializeInput } from "@/lib/margin";
import { loadChain, loadSalesInput } from "@/lib/sales-server";
import { loadDatamartStock } from "@/lib/datamart-stock";
import { todayMsk } from "@/lib/sales-section";
import { parseUi } from "@/lib/sales-url";
import { SalesView } from "./sales-view";
import { loadDataAsOf } from "@/lib/data-as-of";
import { DataAsOf } from "@/components/data-as-of";
import { loadReportSizesState } from "@/lib/import-keys";
import { tzAwaitSizes } from "@/lib/tz-await";

export const metadata = { title: "Продажи и остатки" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // requireSession без allowSupplier: внешнего поставщика (SUPPLIER) сюда не пускаем — ни страницу, ни данные.
  const session = await requireSession();
  const sp = await searchParams;
  const c4 = await getCommission4Mode();
  const [data, chain, asOf, dmStock, tz] = await Promise.all([loadSalesInput(session.user.organizationId, c4), loadChain(session.user.organizationId, c4), loadDataAsOf(session.user.organizationId), loadDatamartStock(session.user.organizationId), tzAwaitSizes(session.user.organizationId, c4)]);
  const rs = (await loadReportSizesState(session.user.organizationId))?.value as { asOf?: string } | undefined;
  const reportDate = rs?.asOf ? rs.asOf.split("-").reverse().join(".") : undefined;
  // «Ждём по ТЗ» для прогноза ноября в «Приходе по месяцам»: вид меха из кода строки (MODEL/FURKEY), количество.
  const tzAwait = tz.map((r) => ({ fur: r.acode.includes("/") ? r.acode.slice(r.acode.indexOf("/") + 1) : "", cls: r.cls, qty: r.fw26Conf ?? 0, model: r.modelCode ?? "" }));
  return <><DataAsOf asOf={asOf} /><SalesView input={serializeInput(data.input)} sizes={data.sizes} photos={data.photos} today={todayMsk()} initial={{ ...parseUi(sp), vat: parseVatModeCookie((await cookies()).get("vatDisplay")?.value) === "excl" ? "ex" : "in" }} chain={chain} dmStock={dmStock} reportDate={reportDate} tzAwait={tzAwait} /></>;
}
