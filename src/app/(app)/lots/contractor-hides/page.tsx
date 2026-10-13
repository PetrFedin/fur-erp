import { orderLabel } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { allocateHides, hidesByPayYear } from "@/lib/contractor-hides";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { HidesView, type HidesOrderRow, type HidesPayment } from "./hides-view";

export const metadata = { title: "Шкуры подрядчика" };

/**
 * Шкуры подрядчика (партии 7 и 8): стоимость шкур, оплаченная в составе счетов за пошив; закупки на них нет, в ТЗ они не списаны.
 * Те же расчёты, что на Главной (contractor-hides.ts + оплаты производства): сумма входит в мех «Куплено» и «Использовано».
 */
export default async function ContractorHidesPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const [orders, ov] = await Promise.all([loadOrderRows(orgId, "all", c4), loadPaymentsOverview(orgId)]);
  const shares = allocateHides(orders.map((o) => ({ id: o.id, number: o.number, batch: o.batchNumber == null ? "none" : String(o.batchNumber), qty: o.qty })), hidesByPayYear(ov), year);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const tzPos = await loadTzPositions(orgId, orders);
  const rows: HidesOrderRow[] = shares.map((s) => {
    const o = byId.get(s.id)!;
    return {
      orderId: o.id, number: o.number, label: orderLabel({ workOrderNumber: o.workOrderNumber, number: o.number, ...tzPos.get(o.id) }), batch: o.batchNumber == null ? "без партии" : String(o.batchNumber), payYear: s.payYear,
      article: o.modelLabel || o.modelName, category: o.category, units: o.qty, incl: s.incl, excl: s.excl, pinned: s.pinned ?? false,
    };
  });
  const payments: HidesPayment[] = ov
    .filter((r) => r.hides > 0 && (year === "all" || r.year === Number(year)))
    .map((r) => ({ id: r.id, iso: r.iso, date: r.iso.split("-").reverse().join("."), year: r.year, label: r.label, doc: r.doc, hides: r.hides, amount: r.amount, href: r.href, confirmed: r.confirmed }));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Мех", href: "/lots" }, { label: "Шкуры подрядчика" }]} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/lots" aria-label="Назад в «Сырьё — Мех»" title="Назад в «Сырьё — Мех»" className="inline-flex size-8 items-center justify-center rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50">←</Link>
        <h1 className="text-xl font-semibold">Шкуры подрядчика</h1>
        <YearNote year={year} />
        <span className="inline-flex">
          <InfoHint label="О шкурах подрядчика" wide>
            <p>Шкуры подрядчика — часть счетов за пошив, оплаченная как стоимость шкур (партии 7 и 8). Отдельной закупки и лотов на них нет, в ТЗ они не списываются, поэтому в «Сырьё — мех» они идут отдельной строкой «Шкуры подрядчика» (куплено и сразу использовано).</p>
            <p className="mt-1">Откуда данные: сумма — из оплат производства (нераспределённый остаток платежа с пометкой «шкур…» в основании), по году платежа; партии и закреплённые ТЗ — по документам (п/п №22618 от 21.01.2026, счёт №1 — партия 7; п/п №82173 от 27.11.2025 — партия 8). Остаток партии делится между её ТЗ пропорционально изделиям. НДС: партия 7 — 22%, партия 8 — 20%. Год шапки применяется по году платежа.</p>
          </InfoHint>
        </span>
      </div>
      <HidesView orders={rows} payments={payments} />
    </div>
  );
}
