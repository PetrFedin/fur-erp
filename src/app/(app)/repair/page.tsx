import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatQty } from "@/lib/utils";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { ORDER_STATUS_LABELS } from "@/lib/dashboard-calc";

export const metadata = { title: "Ремонт" };

/** Ремонт — отдельно от производства изделий: ТЗ на ремонт не входят в «Произведено» и в средние цены, считаются здесь. */
export default async function RepairPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, productModel: { OR: [{ categoryRef: { name: "Ремонт" } }, { category: "Ремонт" }] } },
    include: { productModel: true, client: true, materialUsages: true, expenses: true },
    orderBy: { createdAt: "desc" },
  });

  const rows = orders.map((o) => {
    const qty = Number(o.plannedQuantity);
    const material = o.materialUsages.reduce((s, u) => s + Number(u.totalCost), 0);
    const expenses = o.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const work = o.clientWorkPricePerUnit ? Number(o.clientWorkPricePerUnit) * qty : 0;
    return { o, qty, material, expenses, work, total: material + expenses + work };
  });
  const sum = (k: "qty" | "material" | "expenses" | "work" | "total") => rows.reduce((s, r) => s + r[k], 0);
  const money = (v: number) => formatMoney(v.toFixed(2));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Ремонт</h1>
          <p className="text-sm text-neutral-500">Отдельно от производства: ТЗ на ремонт не входят в «Произведено» и в средние цены изделий. Затраты ремонта остаются в общей себестоимости на Главной.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/production/new" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">+ Новое ТЗ на ремонт</Link>
          <Link href="/dashboard" className="px-1 py-1.5 text-blue-700 hover:underline">← Главная</Link>
        </div>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>ТЗ</Th>
            <Th>Изделие</Th>
            <Th>Заказчик</Th>
            <Th>Статус</Th>
            <Th className="text-right">Штук</Th>
            <Th className="text-right">Материалы</Th>
            <Th className="text-right">Расходы</Th>
            <Th className="text-right">Работа</Th>
            <Th className="text-right">Итого</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ o, qty, material, expenses, work, total }) => (
            <Tr key={o.id}>
              <Td><Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">ТЗ {o.workOrderNumber ?? o.number}</Link></Td>
              <Td className="text-sm">{o.productModel.name}</Td>
              <Td className="text-sm text-neutral-700">{o.client?.name ?? "—"}</Td>
              <Td className="text-sm text-neutral-700">{ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status}</Td>
              <Td className="text-right tabular-nums">{formatQty(qty)}</Td>
              <Td className="text-right tabular-nums">{money(material)}</Td>
              <Td className="text-right tabular-nums">{money(expenses)}</Td>
              <Td className="text-right tabular-nums">{money(work)}</Td>
              <Td className="text-right font-medium tabular-nums">{money(total)}</Td>
            </Tr>
          ))}
          {rows.length === 0 ? <Tr><Td colSpan={9} className="py-8 text-center text-neutral-500">ТЗ на ремонт пока нет. Создайте ТЗ и выберите изделие категории «Ремонт».</Td></Tr> : null}
          {rows.length > 0 ? (
            <Tr className="bg-neutral-50 font-semibold">
              <Td colSpan={4}>Итого · {rows.length} ТЗ</Td>
              <Td className="text-right tabular-nums">{formatQty(sum("qty"))}</Td>
              <Td className="text-right tabular-nums">{money(sum("material"))}</Td>
              <Td className="text-right tabular-nums">{money(sum("expenses"))}</Td>
              <Td className="text-right tabular-nums">{money(sum("work"))}</Td>
              <Td className="text-right tabular-nums">{money(sum("total"))}</Td>
            </Tr>
          ) : null}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">Суммы: материалы — списанное в ТЗ (с НДС, без 4%), работа — цена работы заказчику × штук.</p>
    </div>
  );
}
