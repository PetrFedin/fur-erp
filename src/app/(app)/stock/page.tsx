import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_IN: "Приход (закупка)",
  PRODUCTION_OUT: "Списание в производство",
  ADJUSTMENT_IN: "Корректировка (+)",
  ADJUSTMENT_OUT: "Корректировка (-)",
  TRANSFER_IN: "Перемещение (+)",
  TRANSFER_OUT: "Перемещение (-)",
};

export default async function StockPage() {
  const session = await requireSession();
  const [balances, movements] = await Promise.all([
    prisma.rawMaterialStock.findMany({
      where: { organizationId: session.user.organizationId },
      include: { rawMaterial: true, warehouse: true },
      orderBy: { rawMaterial: { name: "asc" } },
    }),
    prisma.stockMovement.findMany({
      where: { organizationId: session.user.organizationId },
      include: { rawMaterial: true, warehouse: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  const totalValue = balances.reduce((s, b) => s.add(b.quantity.mul(b.avgUnitCost)), new Decimal(0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Остатки сырья</h1>
        <div className="text-sm text-neutral-500">
          Стоимость остатков: <span className="font-semibold text-neutral-900">{formatMoney(totalValue.toString())}</span>
        </div>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Сырьё</Th>
            <Th>Склад</Th>
            <Th>Остаток</Th>
            <Th>Средняя себестоимость</Th>
            <Th>Стоимость остатка</Th>
            <Th>Мин. уровень</Th>
          </Tr>
        </Thead>
        <Tbody>
          {balances.map((b) => {
            const low = b.rawMaterial.minStockLevel && b.quantity.lessThan(b.rawMaterial.minStockLevel);
            return (
              <Tr key={b.id}>
                <Td className="font-medium">{b.rawMaterial.name}</Td>
                <Td>{b.warehouse.name}</Td>
                <Td>
                  {formatQty(b.quantity.toString())} {UNIT_LABELS[b.rawMaterial.unit]}{" "}
                  {low && <Badge variant="danger">Мало</Badge>}
                </Td>
                <Td>{formatMoney(b.avgUnitCost.toString())}</Td>
                <Td>{formatMoney(b.quantity.mul(b.avgUnitCost).toString())}</Td>
                <Td>
                  {b.rawMaterial.minStockLevel ? formatQty(b.rawMaterial.minStockLevel.toString()) : "—"}
                </Td>
              </Tr>
            );
          })}
          {balances.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                Остатков пока нет — оприходуйте закупку сырья
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
                <Th>Сырьё</Th>
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
                  <Td>{m.rawMaterial.name}</Td>
                  <Td>{m.warehouse.name}</Td>
                  <Td>
                    {m.type.endsWith("_OUT") ? "-" : "+"}
                    {formatQty(m.quantity.toString())} {UNIT_LABELS[m.rawMaterial.unit]}
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
