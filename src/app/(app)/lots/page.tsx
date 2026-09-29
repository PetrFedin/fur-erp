import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { CostBreakdownToggle } from "./cost-breakdown-toggle";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function LotsArchivePage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const materialId = typeof sp.material === "string" ? sp.material : "";

  const [currentLots, allLots, lots, materials] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true, warehouse: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId },
      select: { rawMaterialId: true, quantityReceived: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(materialId ? { rawMaterialId: materialId } : {}),
        ...(q
          ? {
              OR: [
                { lotNumber: { contains: q, mode: "insensitive" } },
                { color: { contains: q, mode: "insensitive" } },
                { grade: { contains: q, mode: "insensitive" } },
                { rawMaterial: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: {
        rawMaterial: true,
        warehouse: true,
        purchase: { include: { supplier: true } },
        usages: { include: { productionOrder: true } },
      },
      orderBy: { receivedDate: "desc" },
      take: 200,
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  type MaterialAgg = {
    id: string;
    name: string;
    unit: string;
    purchased: Decimal;
    remaining: Decimal;
    value: Decimal;
    valueExclVat: Decimal;
  };
  const materialAggMap = new Map<string, MaterialAgg>();
  for (const m of materials) {
    materialAggMap.set(m.id, {
      id: m.id,
      name: m.name,
      unit: m.unit,
      purchased: new Decimal(0),
      remaining: new Decimal(0),
      value: new Decimal(0),
      valueExclVat: new Decimal(0),
    });
  }
  for (const l of allLots) {
    const agg = materialAggMap.get(l.rawMaterialId);
    if (agg) agg.purchased = agg.purchased.add(l.quantityReceived);
  }
  for (const l of currentLots) {
    const agg = materialAggMap.get(l.rawMaterialId);
    if (agg) {
      agg.remaining = agg.remaining.add(l.quantityRemaining);
      agg.value = agg.value.add(l.quantityRemaining.mul(l.unitCost));
      agg.valueExclVat = agg.valueExclVat.add(l.quantityRemaining.mul(lotUnitCostExclVat(l)));
    }
  }
  const materialRows = Array.from(materialAggMap.values()).filter(
    (r) => r.purchased.greaterThan(0) || r.remaining.greaterThan(0)
  );
  const furMaterialRows = materialRows.filter((r) => r.unit !== "M");
  const liningMaterialRows = materialRows.filter((r) => r.unit === "M");
  const furTotalValue = furMaterialRows.reduce((s, r) => s.add(r.value), new Decimal(0));
  const furTotalValueExclVat = furMaterialRows.reduce((s, r) => s.add(r.valueExclVat), new Decimal(0));
  const liningTotalValue = liningMaterialRows.reduce((s, r) => s.add(r.value), new Decimal(0));
  const liningTotalValueExclVat = liningMaterialRows.reduce((s, r) => s.add(r.valueExclVat), new Decimal(0));

  type Agg = {
    key: string;
    materialName: string;
    unit: string;
    minStockLevel: Decimal | null;
    warehouseName: string;
    quantity: Decimal;
    value: Decimal;
    valueExclVat: Decimal;
  };
  const aggregates = new Map<string, Agg>();
  for (const l of currentLots) {
    const key = `${l.rawMaterialId}:${l.warehouseId}`;
    const existing = aggregates.get(key);
    const value = l.quantityRemaining.mul(l.unitCost);
    const valueExclVat = l.quantityRemaining.mul(lotUnitCostExclVat(l));
    if (existing) {
      existing.quantity = existing.quantity.add(l.quantityRemaining);
      existing.value = existing.value.add(value);
      existing.valueExclVat = existing.valueExclVat.add(valueExclVat);
    } else {
      aggregates.set(key, {
        key,
        materialName: l.rawMaterial.name,
        unit: l.rawMaterial.unit,
        minStockLevel: l.rawMaterial.minStockLevel,
        warehouseName: l.warehouse.name,
        quantity: l.quantityRemaining,
        value,
        valueExclVat,
      });
    }
  }
  const aggregateRows = Array.from(aggregates.values());
  const furAggregateRows = aggregateRows.filter((a) => a.unit !== "M");
  const liningAggregateRows = aggregateRows.filter((a) => a.unit === "M");

  const furLots = lots.filter((l) => l.rawMaterial.unit !== "M");
  const liningLots = lots.filter((l) => l.rawMaterial.unit === "M");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Остатки и архив сырья</h1>

      <form className="grid grid-cols-4 items-end gap-2" method="get">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-neutral-500">Поиск (лот, материал, цвет, сорт)</label>
          <Input name="q" defaultValue={q} placeholder="напр. 15016 или соболь" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Сырьё</label>
          <Select name="material" defaultValue={materialId}>
            <option value="">Все материалы</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Найти
          </Button>
          <Link href="/lots" className="flex items-center text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        </div>
      </form>

      <h2 className="text-lg font-semibold">Мех</h2>

      <Card>
        <CardHeader>
          <CardTitle>Итоговый отчёт по меху</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Куплено всего</Th>
                <Th>Использовано</Th>
                <Th>Остаток</Th>
                <Th>Стоимость остатка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {furMaterialRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>
                    {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>
                    {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td className="font-medium">
                    {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td><Money incl={r.value} excl={r.valueExclVat} /></Td>
                </Tr>
              ))}
              {furMaterialRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Мех ещё не закупался
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <div className="mt-3 flex justify-end text-sm">
            <span className="text-neutral-500">Итого стоимость остатков меха: </span>
            <span className="ml-1 font-semibold text-neutral-900"><Money incl={furTotalValue} excl={furTotalValueExclVat} /></span>
          </div>
        </CardContent>
      </Card>

      <h3 className="text-sm font-medium text-neutral-500">Остатки меха по складам</h3>

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
          {furAggregateRows.map((a) => {
            const low = a.minStockLevel && a.quantity.lessThan(a.minStockLevel);
            return (
              <Tr key={a.key}>
                <Td className="font-medium">{a.materialName}</Td>
                <Td>{a.warehouseName}</Td>
                <Td>
                  {formatQty(a.quantity.toString())} {UNIT_LABELS[a.unit]}{" "}
                  {low && <Badge variant="danger">Мало</Badge>}
                </Td>
                <Td><Money incl={a.value} excl={a.valueExclVat} /></Td>
                <Td>{a.minStockLevel ? formatQty(a.minStockLevel.toString()) : "—"}</Td>
              </Tr>
            );
          })}
          {furAggregateRows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                Остатков мех сырья пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <Card>
        <CardHeader>
          <CardTitle>Архив лотов меха</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">
            Полная история поступивших лотов, включая израсходованные — чтобы найти нужную партию
            для ТЗ, смотрите «Использовано в»
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Лот</Th>
                <Th>Сорт/цвет</Th>
                <Th>Склад</Th>
                <Th>Получено</Th>
                <Th>Остаток</Th>
                <Th>Себест. за ед. (без НДС / НДС / всего)</Th>
                <Th>Поставщик / закупка</Th>
                <Th>Дата поступления</Th>
                <Th>Использовано в</Th>
              </Tr>
            </Thead>
            <Tbody>
              {furLots.map((l) => (
                <Tr key={l.id}>
                  <Td className="font-medium">{l.rawMaterial.name}</Td>
                  <Td>{l.lotNumber ?? "без номера"}</Td>
                  <Td>{[l.grade, l.color].filter(Boolean).join(" / ") || "—"}</Td>
                  <Td>{l.warehouse.name}</Td>
                  <Td>
                    {formatQty(l.quantityReceived.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                  </Td>
                  <Td>
                    {l.quantityRemaining.isZero() ? (
                      <Badge>Израсходован</Badge>
                    ) : (
                      <>
                        {formatQty(l.quantityRemaining.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                      </>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {formatMoney(l.materialCostExclVat.toString())} / {l.vatRate.toString()}% /{" "}
                    <span className="font-medium text-neutral-900"><Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} /></span>
                    {l.costBreakdown && <CostBreakdownToggle breakdown={l.costBreakdown as never} />}
                  </Td>
                  <Td>
                    {l.purchase ? (
                      <>
                        <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                          {l.purchase.supplier.name} ({l.purchase.number})
                        </Link>
                        {(l.purchase.auctionSession || l.purchase.transferDocument) && (
                          <div className="text-xs text-neutral-400">
                            {[l.purchase.auctionSession, l.purchase.transferDocument].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{formatDate(l.receivedDate)}</Td>
                  <Td>
                    {l.usages.length === 0
                      ? "—"
                      : l.usages.map((u, i) => (
                          <span key={u.id}>
                            {i > 0 && ", "}
                            <Link href={`/production/${u.productionOrderId}`} className="hover:underline">
                              {u.productionOrder.number}
                            </Link>
                          </span>
                        ))}
                  </Td>
                </Tr>
              ))}
              {furLots.length === 0 && (
                <Tr>
                  <Td colSpan={10} className="py-8 text-center text-neutral-400">
                    Ничего не найдено
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">Подкладка</h2>

      <Card>
        <CardHeader>
          <CardTitle>Итоговый отчёт по подкладке</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Ткань</Th>
                <Th>Куплено всего</Th>
                <Th>Использовано</Th>
                <Th>Остаток</Th>
                <Th>Стоимость остатка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {liningMaterialRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>
                    {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>
                    {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td className="font-medium">
                    {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td><Money incl={r.value} excl={r.valueExclVat} /></Td>
                </Tr>
              ))}
              {liningMaterialRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Подкладка ещё не закупалась
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <div className="mt-3 flex justify-end text-sm">
            <span className="text-neutral-500">Итого стоимость остатков подкладки: </span>
            <span className="ml-1 font-semibold text-neutral-900"><Money incl={liningTotalValue} excl={liningTotalValueExclVat} /></span>
          </div>
        </CardContent>
      </Card>

      <h3 className="text-sm font-medium text-neutral-500">Остатки подкладки по складам</h3>

      <Table>
        <Thead>
          <Tr>
            <Th>Ткань</Th>
            <Th>Склад</Th>
            <Th>Остаток</Th>
            <Th>Стоимость остатка</Th>
            <Th>Мин. уровень</Th>
          </Tr>
        </Thead>
        <Tbody>
          {liningAggregateRows.map((a) => {
            const low = a.minStockLevel && a.quantity.lessThan(a.minStockLevel);
            return (
              <Tr key={a.key}>
                <Td className="font-medium">{a.materialName}</Td>
                <Td>{a.warehouseName}</Td>
                <Td>
                  {formatQty(a.quantity.toString())} {UNIT_LABELS[a.unit]}{" "}
                  {low && <Badge variant="danger">Мало</Badge>}
                </Td>
                <Td><Money incl={a.value} excl={a.valueExclVat} /></Td>
                <Td>{a.minStockLevel ? formatQty(a.minStockLevel.toString()) : "—"}</Td>
              </Tr>
            );
          })}
          {liningAggregateRows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                Остатков подкладки пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      <Card>
        <CardHeader>
          <CardTitle>Архив лотов подкладки</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">
            Своя цена и своя ставка НДС на каждую партию ткани — как в остальном сырье.
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>Ткань</Th>
                <Th>Лот</Th>
                <Th>Сорт/цвет</Th>
                <Th>Склад</Th>
                <Th>Получено</Th>
                <Th>Остаток</Th>
                <Th>Себест. за ед. (без НДС / НДС / всего)</Th>
                <Th>Поставщик / закупка</Th>
                <Th>Дата поступления</Th>
                <Th>Использовано в</Th>
              </Tr>
            </Thead>
            <Tbody>
              {liningLots.map((l) => (
                <Tr key={l.id}>
                  <Td className="font-medium">{l.rawMaterial.name}</Td>
                  <Td>{l.lotNumber ?? "без номера"}</Td>
                  <Td>{[l.grade, l.color].filter(Boolean).join(" / ") || "—"}</Td>
                  <Td>{l.warehouse.name}</Td>
                  <Td>
                    {formatQty(l.quantityReceived.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                  </Td>
                  <Td>
                    {l.quantityRemaining.isZero() ? (
                      <Badge>Израсходован</Badge>
                    ) : (
                      <>
                        {formatQty(l.quantityRemaining.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                      </>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {formatMoney(l.materialCostExclVat.toString())} / {l.vatRate.toString()}% /{" "}
                    <span className="font-medium text-neutral-900"><Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} /></span>
                    {l.costBreakdown && <CostBreakdownToggle breakdown={l.costBreakdown as never} />}
                  </Td>
                  <Td>
                    {l.purchase ? (
                      <>
                        <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                          {l.purchase.supplier.name} ({l.purchase.number})
                        </Link>
                        {(l.purchase.auctionSession || l.purchase.transferDocument) && (
                          <div className="text-xs text-neutral-400">
                            {[l.purchase.auctionSession, l.purchase.transferDocument].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{formatDate(l.receivedDate)}</Td>
                  <Td>
                    {l.usages.length === 0
                      ? "—"
                      : l.usages.map((u, i) => (
                          <span key={u.id}>
                            {i > 0 && ", "}
                            <Link href={`/production/${u.productionOrderId}`} className="hover:underline">
                              {u.productionOrder.number}
                            </Link>
                          </span>
                        ))}
                  </Td>
                </Tr>
              ))}
              {liningLots.length === 0 && (
                <Tr>
                  <Td colSpan={10} className="py-8 text-center text-neutral-400">
                    Ничего не найдено
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
