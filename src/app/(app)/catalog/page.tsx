import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { serializeInput } from "@/lib/margin";
import { loadSalesInput } from "@/lib/sales-server";
import { articleKey } from "@/lib/sales-receipts-core";
import { SeasonReport } from "../sales/season-report";
import { tzAwaitSizes } from "@/lib/tz-await";

export const metadata = { title: "Каталог" };

/** Раздел «Телефон»: карточки товаров с фото, сезоны (заказ · пришло · остаток) и детализация по тапу. Данные те же, что в «Продажи и остатки → Отчёт». */
export default async function CatalogPage() {
  const session = await requireSession();
  const c4 = await getCommission4Mode();
  const [data, tz] = await Promise.all([loadSalesInput(session.user.organizationId, c4), tzAwaitSizes(session.user.organizationId, c4)]);
  const input = serializeInput(data.input);
  const lines = input.lines as { article: string; fabric?: string }[];
  const fabricByArt: Record<string, string> = {};
  for (const l of lines) if (l.fabric && !fabricByArt[l.article]) { fabricByArt[l.article] = l.fabric; fabricByArt[articleKey(l.article)] = l.fabric; }
  const ex = parseVatModeCookie((await cookies()).get("vatDisplay")?.value) === "excl";
  const tzAwait = tz.map((r) => ({ fur: r.acode.includes("/") ? r.acode.slice(r.acode.indexOf("/") + 1) : "", cls: r.cls, qty: r.fw26Conf ?? 0, model: r.modelCode ?? "" }));
  return (
    <div className="flex flex-col gap-3 p-3 md:p-4">
      <h1 className="text-xl font-semibold">Каталог</h1>
      <SeasonReport catalog sizes={data.sizes} photos={data.photos} cat="all" ex={ex} fabricByArt={fabricByArt} prices={input.prices} costs={input.costs} lines={input.lines as never} tzAwait={tzAwait} />
    </div>
  );
}
