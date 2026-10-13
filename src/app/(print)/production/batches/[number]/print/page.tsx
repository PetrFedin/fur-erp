import { itemsSuffix } from "@/lib/tz-key";
import { TH as Head } from "@/components/table-head";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { batchExtraName, batchOrderInclude, batchTotals, orderStat } from "@/lib/batch-stats";
import { parseCommission4Cookie } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { articleLabel } from "@/lib/article-label";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { PrintToolbar } from "../../../../print-toolbar";

const STATUS: Record<string, string> = {
  PLANNED: "Запланирован",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершён",
  CANCELLED: "Отменён",
};

const th = "border border-neutral-700 bg-neutral-100 px-2 py-1 text-left font-semibold";
const td = "border border-neutral-700 px-2 py-1 align-top";
const tdr = td + " text-right whitespace-nowrap";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: `Сводка партии ${number}` };
}

export default async function BatchPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ c4?: string }>;
}) {
  const { number: numRaw } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const store = await cookies();
  const c4Mode = parseCommission4Cookie(sp.c4 ?? store.get("commission4Display")?.value);
  const number = /^\d{1,6}$/.test(numRaw) ? parseInt(numRaw, 10) : NaN;
  if (!Number.isInteger(number) || number < 1) notFound();

  const batch = await prisma.productionBatch.findUnique({
    where: { organizationId_number: { organizationId: session.user.organizationId, number } },
    include: { orders: { include: batchOrderInclude, orderBy: { createdAt: "asc" } } },
  });
  if (!batch) notFound();

  const t = batchTotals(batch.orders, c4Mode);
  const c4 = t.c4Applies ? c4Suffix(c4Mode) : "";
  const orders = [...batch.orders].sort((a, b) => {
    const x = parseInt(a.workOrderNumber ?? "", 10);
    const y = parseInt(b.workOrderNumber ?? "", 10);
    return (Number.isNaN(x) ? 1e9 : x) - (Number.isNaN(y) ? 1e9 : y);
  });
  const cancelled = batch.orders.length - t.items;
  const overpaid = t.remaining.lessThan(-0.005);
  const extra = batchExtraName(batch.name);
  const q = (c4: string) => `/production/batches/${number}/print?c4=${c4}`;

  return (
    <>
      <PrintToolbar
        backHref={`/production/batches/${number}`}
        switches={[
          { label: "Без 4%", href: q("off"), active: c4Mode === "off" },
          { label: "С 4%", href: q("on"), active: c4Mode === "on" },
        ]}
      />
      <article className="print-sheet mx-auto my-4 w-[210mm] max-w-full bg-white p-[15mm] text-[13px] leading-snug text-black shadow">
        <h1 className="text-center text-base font-bold">
          Сводка партии {batch.number}
          {extra ? ` — ${extra}` : ""}
        </h1>
        <p className="mt-1 text-center text-sm text-neutral-700">
          {[batch.year ? `${batch.year} г.` : null, batch.plannedUnits != null ? `план ${batch.plannedUnits} изд.` : null]
            .filter(Boolean)
            .join(" · ") || ""}
        </p>

        <h2 className="mb-1 mt-5 text-sm font-semibold">
          ТЗ партии ({t.orders}{itemsSuffix(t.orders, t.items)}
          {cancelled > 0 ? ` + ${cancelled} отменено` : ""})
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>№ ТЗ</th>
              <th className={th}>Изделие</th>
              <th className={th}>Цвет / размеры</th>
              <Head label="Кол-во" unit="шт." align="right" />
              <th className={th}>Статус</th>
              <th className={th + " text-right"}>Себестоимость{c4}</th>
              <th className={th + " text-right"}>Работа</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const s = orderStat(o, c4Mode);
              const cs = [o.color?.trim(), o.size?.trim()].filter(Boolean).join(" / ");
              return (
                <tr key={o.id}>
                  <td className={td}>{o.workOrderNumber ?? o.number}</td>
                  <td className={td}>{articleLabel(o.productModel)}</td>
                  <td className={td}>{cs || "—"}</td>
                  <td className={tdr}>{formatQty(s.qty.toString())}</td>
                  <td className={td}>{STATUS[o.status]}</td>
                  <td className={tdr}>{s.cost.isZero() ? "—" : formatMoney(s.cost.toString())}</td>
                  <td className={tdr}>{s.work.isZero() ? "—" : formatMoney(s.work.toString())}</td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td className={td + " text-center"} colSpan={7}>
                  К партии не привязано ни одного ТЗ
                </td>
              </tr>
            )}
            <tr>
              <td className={td + " font-semibold"} colSpan={3}>
                Итого (без отменённых)
              </td>
              <td className={tdr + " font-semibold"}>{formatQty(t.producedUnits.toString())}</td>
              <td className={td}></td>
              <td className={tdr + " font-semibold"}>{formatMoney(t.cost.toString())}</td>
              <td className={tdr + " font-semibold"}>{formatMoney(t.work.toString())}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-1 mt-5 text-sm font-semibold">Итоги партии</h2>
        <table className="keep-together ml-auto w-[60%] border-collapse text-xs">
          <tbody>
            <tr>
              <td className={td}>ТЗ</td>
              <td className={tdr}>{t.orders}{itemsSuffix(t.orders, t.items)}</td>
            </tr>
            <tr>
              <td className={td}>Произведено (все ТЗ без ремонта)</td>
              <td className={tdr}>{formatQty(t.producedUnits.toString())}</td>
            </tr>
            <tr>
              <td className={td}>Себестоимость{c4}</td>
              <td className={tdr}>{formatMoney(t.cost.toString())}</td>
            </tr>
            <tr>
              <td className={td}>Работа подрядчику</td>
              <td className={tdr}>{formatMoney(t.work.toString())}</td>
            </tr>
            <tr>
              <td className={td}>Оплачено</td>
              <td className={tdr}>{formatMoney(t.paid.toString())}</td>
            </tr>
            <tr>
              <td className={td + " font-bold"}>{overpaid ? "Переплата" : "Остаток к оплате"}</td>
              <td className={tdr + " font-bold"}>{formatMoney(t.remaining.abs().toString())}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-right text-[11px] text-neutral-600">Суммы с НДС. Распечатано {formatDate(new Date())}.</p>
      </article>
    </>
  );
}
