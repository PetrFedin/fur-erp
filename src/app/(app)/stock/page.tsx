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
  const [lots, movements] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true, warehouse: true },
      orderBy: [{ rawMaterial: { name: "asc" } }, { receivedDate: "asc" }],
    }),
    prisma.stockMovement.findMany({
      where: { organizationId: session.user.organizationId },
      include: { rawMaterial: true, warehouse: true, lot: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  const totalValue = lots.reduce((s, l) => s.add(l.quantityRemaining.mul(l.unitCost)), new Decimal(0));

  // Aggregate by material+warehouse for the summary table; per-lot detail follows below.
  type Agg = {
    key: string;
    materialName: string;
    unit: string;
    minStockLevel: Decimal | null;
    warehouseName: string;
    quantity: Decimal;
    value: Decimal;
  };
  const aggregates = new Map<string, Agg>();
  for (const l of lots) {
    const key = `${l.rawMaterialId}:${l.warehouseId}`;
    const existing = aggregates.get(key);
    const value = l.quantityRemaining.mul(l.unitCost);
    if (existing) {
      existing.quantity = existing.quantity.add(l.quantityRemaining);
      existing.value = existing.value.add(value);
    } else {
      aggregates.set(key, {
        key,
        materialName: l.rawMaterial.name,
        unit: l.rawMaterial.unit,
        minStockLevel: l.rawMaterial.minStockLevel,
        warehouseName: l.warehouse.name,
        quantity: l.quantityRemaining,
        value,
      });
    }
  }
  const aggregateRows = Array.from(aggregates.values());

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
            <Th>Стоимость остатка</Th>
            <Th>Мин. уровень</Th>
          </Tr>
        </Thead>
        <Tbody>
          {aggregateRows.map((a) => {
            const low = a.minStockLevel && a.quantity.lessThan(a.minStockLevel);
            return (
              <Tr key={a.key}>
                <Td className="font-medium">{a.materialName}</Td>
                <Td>{a.warehouseName}</Td>
                <Td>
                  {formatQty(a.quantity.toString())} {UNIT_LABELS[a.unit]}{" "}
                  {low && <Badge variant="danger">Мало</Badge>}
                </Td>
                <Td>{formatMoney(a.value.toString())}</Td>
                <Td>{a.minStockLevel ? formatQty(a.minStockLevel.toString()) : "—"}</Td>
              </Tr>
            );
          })}
          {aggregateRows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                Остатков пока нет — оприходуйте закупку сырья
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <Card>
        <CardHeader>
          <CardTitle>Остатки по лотам</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Лот</Th>
                <Th>Склад</Th>
                <Th>Получено</Th>
                <Th>Остаток</Th>
                <Th>Себестоимость за ед.</Th>
                <Th>Стоимость остатка</Th>
                <Th>Дата поступления</Th>
              </Tr>
            </Thead>
            <Tbody>
              {lots.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.rawMaterial.name}</Td>
                  <Td>{l.lotNumber ?? "без номера"}</Td>
                  <Td>{l.warehouse.name}</Td>
                  <Td>
                    {formatQty(l.quantityReceived.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                  </Td>
                  <Td>
                    {formatQty(l.quantityRemaining.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                  </Td>
                  <Td>{formatMoney(l.unitCost.toString())}</Td>
                  <Td>{formatMoney(l.quantityRemaining.mul(l.unitCost).toString())}</Td>
                  <Td>{formatDate(l.receivedDate)}</Td>
                </Tr>
              ))}
              {lots.length === 0 && (
                <Tr>
                  <Td colSpan={8} className="py-6 text-center text-neutral-400">
                    Лотов пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

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
                <Th>Лот</Th>
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
                  <Td>{m.lot?.lotNumber ?? "—"}</Td>
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
                  <Td colSpan={7} className="py-6 text-center text-neutral-400">
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
