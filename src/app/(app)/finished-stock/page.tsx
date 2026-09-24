import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { WriteOffForm } from "./write-off-form";

const MOVEMENT_LABELS: Record<string, string> = {
  PRODUCTION_IN: "Приход (производство)",
  WRITE_OFF_OUT: "Списание",
  ADJUSTMENT_IN: "Корректировка (+)",
  ADJUSTMENT_OUT: "Корректировка (-)",
  TRANSFER_IN: "Перемещение (+)",
  TRANSFER_OUT: "Перемещение (-)",
};

export default async function FinishedStockPage() {
  const session = await requireSession();
  const [balances, movements, models, warehouses] = await Promise.all([
    prisma.finishedGoodsStock.findMany({
      where: { organizationId: session.user.organizationId },
      include: { productModel: true, warehouse: true },
      orderBy: { productModel: { name: "asc" } },
    }),
    prisma.finishedGoodsMovement.findMany({
      where: { organizationId: session.user.organizationId },
      include: { productModel: true, warehouse: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
    prisma.productModel.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
  ]);

  const totalValue = balances.reduce((s, b) => s.add(b.quantity.mul(b.avgUnitCost)), new Decimal(0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Остатки готовой продукции</h1>
        <div className="text-sm text-neutral-500">
          Стоимость остатков:{" "}
          <span className="font-semibold text-neutral-900">{formatMoney(totalValue.toString())}</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Списать со склада</CardTitle>
        </CardHeader>
        <CardContent>
          <WriteOffForm models={models} warehouses={warehouses} />
        </CardContent>
      </Card>

      <Table>
        <Thead>
          <Tr>
            <Th>Модель</Th>
            <Th>Склад</Th>
            <Th>Остаток</Th>
            <Th>Себестоимость за ед.</Th>
            <Th>Стоимость остатка</Th>
          </Tr>
        </Thead>
        <Tbody>
          {balances.map((b) => (
            <Tr key={b.id}>
              <Td className="font-medium">{b.productModel.name}</Td>
              <Td>{b.warehouse.name}</Td>
              <Td>{formatQty(b.quantity.toString())} шт.</Td>
              <Td>{formatMoney(b.avgUnitCost.toString())}</Td>
              <Td>{formatMoney(b.quantity.mul(b.avgUnitCost).toString())}</Td>
            </Tr>
          ))}
          {balances.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                Остатков пока нет — завершите производственный заказ
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <Card>
        <CardHeader>
          <CardTitle>Последние движения</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Тип</Th>
                <Th>Модель</Th>
                <Th>Склад</Th>
                <Th>Кол-во</Th>
                <Th>Сумма</Th>
              </Tr>
            </Thead>
            <Tbody>
              {movements.map((m) => (
                <Tr key={m.id}>
                  <Td>{formatDate(m.date)}</Td>
                  <Td>{MOVEMENT_LABELS[m.type]}</Td>
                  <Td>{m.productModel.name}</Td>
                  <Td>{m.warehouse.name}</Td>
                  <Td>
                    {m.type.endsWith("_OUT") ? "-" : "+"}
                    {formatQty(m.quantity.toString())} шт.
                  </Td>
                  <Td>{formatMoney(m.totalCost.toString())}</Td>
                </Tr>
              ))}
              {movements.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="py-6 text-center text-neutral-400">
                    Движений пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
