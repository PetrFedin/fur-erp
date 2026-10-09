import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote } from "@/components/year-note";
import { OrdersTree } from "@/components/orders-tree";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { RepairTiles } from "./repair-tiles";

export const metadata = { title: "Ремонт" };

/** Ремонт — отдельно от производства изделий: ТЗ на ремонт не входят в «Произведено» и в средние цены, считаются здесь (данные те же, что на Главной). */
export default async function RepairPage() {
  const session = await requireSession();
  const c4 = await getCommission4Mode();
  const year = await getYearFilter();
  const orders = (await loadOrdersDrill(session.user.organizationId, year, c4)).filter((o) => o.cat === "Ремонт");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Ремонт</h1>
          <YearNote year={year} />
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/production/new" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">+ Новое ТЗ на ремонт</Link>
          <Link href="/dashboard" className="px-1 py-1.5 text-blue-700 hover:underline">← Главная</Link>
        </div>
      </div>
      <p className="text-sm text-neutral-500">Отдельно от производства: ТЗ на ремонт не входят в «Произведено» и в средние цены изделий. Затраты ремонта остаются в общей себестоимости на Главной.</p>
      <RepairTiles orders={orders} c4={c4} />
      <OrdersTree
        orders={orders}
        c4={c4}
        title="ТЗ на ремонт и их состав"
        countRepairQty
        defaultOpenDepth={0}
        modes={[{ id: "order", label: "ТЗ", dims: ["order"] }]}
        hint={<p>Каждое ТЗ раскрывается до строк списания материалов (лот и закупка — ссылками), расходов и работы. Суммы — как в блоке «Производство» на Главной.</p>}
        empty="ТЗ на ремонт пока нет. Создайте ТЗ и выберите изделие категории «Ремонт»."
      />
    </div>
  );
}
