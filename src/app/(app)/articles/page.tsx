import Link from "next/link";
import { cleanSearch, escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { materialCostExclVat } from "@/lib/purchase-totals";
import { ArticlePriceForm } from "./price-form";
import { SHIPMENT_STATUS, summarizeLines } from "@/lib/shipments";
import { WriteOffForm } from "../finished-stock/write-off-form";

export const metadata = { title: "Изделия" };

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q: rawQ } = await searchParams;
  const q = cleanSearch(rawQ);
  const session = await requireSession();
  const canCreate = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const [stocks, shipments, warehouses] = await Promise.all([
    prisma.finishedGoodsStock.findMany({
      where: { organizationId: orgId },
      include: { warehouse: true },
    }),
    prisma.shipment.findMany({
      where: { organizationId: orgId, lines: { some: {} } },
      include: {
        lines: {
          orderBy: { id: "asc" },
          select: {
            size: true,
            quantity: true,
            productionOrder: { select: { productModelId: true, number: true, workOrderNumber: true } },
          },
        },
      },
      orderBy: { plannedDate: "desc" },
    }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
  ]);
  const models = await prisma.productModel.findMany({
    where: {
      organizationId: orgId,
      ...(q ? { name: { contains: escapeLike(q), mode: "insensitive" as const } } : {}),
    },
    include: {
      _count: { select: { productionOrders: true } },
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

  const rows0 = models.map((m) => {
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

    const modelStocks = stocks.filter((st) => st.productModelId === m.id);
    const stockQty = modelStocks.reduce((sum, st) => sum.add(st.quantity), new Decimal(0));
    const stockValue = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(st.avgUnitCost)), new Decimal(0));
    // Excl-VAT стоимость остатка: остаток × средняя себестоимость без НДС по
    // завершённым ТЗ модели (отдельного снимка нет). Нет данных — берём с НДС.
    const stockValueExclVat = avgUnitCostExclVat ? stockQty.mul(avgUnitCostExclVat) : stockValue;
    // Последние 10 отгрузок, где есть ТЗ этой модели (показываем только строки этой модели).
    const modelShipments = shipments
      .map((sh) => ({ sh, lines: sh.lines.filter((l) => l.productionOrder.productModelId === m.id) }))
      .filter((x) => x.lines.length > 0)
      .slice(0, 10);

    return {
      id: m.id,
      name: m.name,
      isActive: m.isActive,
      orderCount: m._count.productionOrders,
      modelStocks,
      stockQty,
      stockValue,
      stockValueExclVat,
      modelShipments,
      totalProduced,
      avgUnitCost,
      avgUnitCostExclVat,
      sellingPrice: m.sellingPrice,
      markup,
    };
  });

  const rows = [...rows0].sort((a, b) => {
    const wa = a.stockQty.greaterThan(0) || a.orderCount > 0 ? 0 : 1;
    const wb = b.stockQty.greaterThan(0) || b.orderCount > 0 ? 0 : 1;
    return wa - wb || a.name.localeCompare(b.name, "ru");
  });
  const totalStockValue = rows.reduce((s, r) => s.add(r.stockValue), new Decimal(0));
  const totalStockValueExclVat = rows.reduce((s, r) => s.add(r.stockValueExclVat), new Decimal(0));
  const writeOffModels = models.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Изделия</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">
            <VatLabel base="Стоимость остатков (по себестоимости)" />:{" "}
            <span className="font-semibold text-neutral-900">
              <Money incl={totalStockValue} excl={totalStockValueExclVat} />
            </span>
          </span>
          {canCreate && (
            <Link href="/models/new" className={buttonVariants()}>
              + Новая модель
            </Link>
          )}
        </div>
      </div>

      <form method="get" className="flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Поиск по названию модели" className="h-9 w-72" />
        <Button type="submit" variant="outline" size="sm">
          Найти
        </Button>
        {q && (
          <Link href="/articles" className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>

      <Table>
        <Thead>
          <Tr>
            <Th>Модель</Th>
            <Th>Остаток готовой, шт.</Th>
            <Th>Себестоимость за ед.</Th>
            <Th>Розничная цена</Th>
            <Th>Наценка</Th>
            <Th>ТЗ</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <Td className="font-medium">
                <details>
                  <summary className="cursor-pointer hover:underline">{r.name}</summary>
                  <div className="mt-2 flex flex-col gap-2 text-xs font-normal text-neutral-600">
                    {r.modelStocks.length === 0 ? (
                      <div>Остаток на складе: 0</div>
                    ) : (
                      r.modelStocks.map((st) => (
                        <div key={st.id}>
                          {st.warehouse.name}: {formatQty(st.quantity.toString())} шт., себестоимость{" "}
                          <Money incl={st.avgUnitCost} excl={r.avgUnitCostExclVat ?? st.avgUnitCost} />, стоимость остатка{" "}
                          <Money
                            incl={st.quantity.mul(st.avgUnitCost)}
                            excl={st.quantity.mul(r.avgUnitCostExclVat ?? st.avgUnitCost)}
                          />
                        </div>
                      ))
                    )}
                    <div className="font-medium text-neutral-700">Отгрузки по модели</div>
                    {r.modelShipments.length === 0 ? (
                      <div>Отгрузок пока нет</div>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {r.modelShipments.map(({ sh, lines }) => (
                          <li key={sh.id}>
                            <Link href={`/shipments/${sh.id}`} className="hover:underline">
                              {sh.status === "SHIPPED" && sh.shippedDate
                                ? `отгружена ${formatDate(sh.shippedDate)}`
                                : `план ${formatDate(sh.plannedDate)}`}
                            </Link>{" "}
                            · {summarizeLines(lines).join("; ")} · {SHIPMENT_STATUS[sh.status].label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </Td>
              <Td>{formatQty(r.stockQty.toString())}</Td>
              <Td>
                {r.avgUnitCost ? (
                  <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} />
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} />
              </Td>
              <Td className="font-medium">{r.markup ? `×${r.markup.toFixed(2)}` : "—"}</Td>
              <Td>
                {r.orderCount > 0 ? (
                  <Link href={`/production?model=${r.id}`} className="hover:underline" title="ТЗ этой модели">
                    {r.orderCount}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Link href={`/models/${r.id}`} className="whitespace-nowrap text-neutral-600 hover:underline">
                  Состав →
                </Link>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-neutral-400">
                {q ? "Ничего не найдено" : "Моделей пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <details className="rounded-lg border border-neutral-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">Списать готовую продукцию со склада</summary>
        <div className="mt-3">
          <WriteOffForm models={writeOffModels} warehouses={warehouses} />
        </div>
      </details>
    </div>
  );
}
