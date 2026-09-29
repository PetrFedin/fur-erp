import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { materialCostExclVat } from "@/lib/purchase-totals";
import { ArticlePriceForm } from "./price-form";

export default async function ArticlesPage() {
  const session = await requireSession();
  const models = await prisma.productModel.findMany({
    where: { organizationId: session.user.organizationId },
    include: {
      productionOrders: {
        where: { status: "COMPLETED" },
        select: {
          unitCost: true,
          producedQuantity: true,
          materialUsages: {
            select: {
              quantity: true,
              lot: { select: { materialCostExclVat: true, expenseCostExclVat: true } },
            },
          },
          expenses: { select: { amount: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows = models.map((m) => {
    const totalProduced = m.productionOrders.reduce((s, o) => s.add(o.producedQuantity), new Decimal(0));
    const totalCost = m.productionOrders.reduce(
      (s, o) => s.add((o.unitCost ?? new Decimal(0)).mul(o.producedQuantity)),
      new Decimal(0)
    );
    // Excl-VAT counterpart of totalCost above, computed live from each
    // order's own materialUsages/expenses — same approach as
    // production/[id]'s estimatedUnitCostExclVat, since there is no stored
    // excl-VAT snapshot column for unitCost (see schema comment). Production
    // expenses carry no VAT at all, so they contribute the same amount to
    // both incl- and excl-VAT totals.
    const totalCostExclVat = m.productionOrders.reduce((s, o) => {
      const orderExpenseCost = o.expenses.reduce((es, e) => es.add(e.amount), new Decimal(0));
      return s.add(materialCostExclVat(o.materialUsages).add(orderExpenseCost));
    }, new Decimal(0));
    const avgUnitCost = totalProduced.greaterThan(0) ? totalCost.div(totalProduced) : null;
    const avgUnitCostExclVat = totalProduced.greaterThan(0) ? totalCostExclVat.div(totalProduced) : null;
    const markup = m.sellingPrice && avgUnitCost && avgUnitCost.greaterThan(0) ? m.sellingPrice.div(avgUnitCost) : null;

    return {
      id: m.id,
      name: m.name,
      sku: m.sku,
      isActive: m.isActive,
      totalProduced,
      avgUnitCost,
      avgUnitCostExclVat,
      sellingPrice: m.sellingPrice,
      markup,
    };
  });

  const grandTotalProduced = rows.reduce((s, r) => s.add(r.totalProduced), new Decimal(0));
  const grandTotalValue = rows.reduce(
    (s, r) => s.add((r.sellingPrice ?? new Decimal(0)).mul(r.totalProduced)),
    new Decimal(0)
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Товар и цены</h1>
        <p className="text-sm text-neutral-500">
          Себестоимость — средневзвешенная по завершённым производственным заказам этой модели.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Артикулов</div>
          <div className="mt-1 text-lg font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Произведено, шт.</div>
          <div className="mt-1 text-lg font-semibold">{formatQty(grandTotalProduced.toString())}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Стоимость по розничным ценам</div>
          <div className="mt-1 text-lg font-semibold">{formatMoney(grandTotalValue.toString())}</div>
        </div>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Модель</Th>
            <Th>Артикул</Th>
            <Th>Произведено</Th>
            <Th>Себестоимость за ед.</Th>
            <Th>Розничная цена</Th>
            <Th>Маркап</Th>
            <Th>Статус</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">
                <Link href={`/models/${r.id}`} className="hover:underline">
                  {r.name}
                </Link>
              </Td>
              <Td>{r.sku ?? "—"}</Td>
              <Td>{formatQty(r.totalProduced.toString())} шт.</Td>
              <Td>
                {r.avgUnitCost ? (
                  <Link href={`/production?model=${r.id}`} className="text-neutral-900 hover:underline" title="Смотреть ТЗ, из которых сложилась себестоимость">
                    <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} />
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} />
              </Td>
              <Td className="font-medium">{r.markup ? `×${r.markup.toFixed(2)}` : "—"}</Td>
              <Td>
                <Badge variant={r.isActive ? "success" : "default"}>
                  {r.isActive ? "Активна" : "Неактивна"}
                </Badge>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-neutral-400">
                Моделей пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
