import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
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
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
  ]);

  type MaterialAgg = {
    id: string;
    name: string;
    unit: string;
    minStockLevel: Decimal | null;
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
      minStockLevel: m.minStockLevel,
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

  const furLots = lots.filter((l) => l.rawMaterial.unit !== "M");

  const furLotsByMaterial = new Map<string, typeof furLots>();
  for (const l of furLots) {
    const arr = furLotsByMaterial.get(l.rawMaterialId);
    if (arr) arr.push(l);
    else furLotsByMaterial.set(l.rawMaterialId, [l]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Остатки и архив сырья</h1>
        <Link href="/materials/new" className={buttonVariants()}>
          + Добавить сырьё
        </Link>
      </div>

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
          <p className="mb-3 text-sm text-neutral-500">
            У нас один склад, поэтому отдельная разбивка «по складам» не нужна — остаток по
            материалу ниже это и есть весь остаток. Разверните строку, чтобы увидеть, из каких
            лотов он состоит.
          </p>
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
              {furMaterialRows.map((r) => {
                const rowLots = furLotsByMaterial.get(r.id) ?? [];
                const low = r.minStockLevel != null && r.remaining.lessThan(r.minStockLevel);
                return (
                  <Tr key={r.id}>
                    <Td colSpan={5} className="p-0">
                      <details className="group">
                        <summary className="grid cursor-pointer list-none grid-cols-5 gap-2 px-3 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                          <span className="font-medium">
                            <span className="mr-1 inline-block text-neutral-400 transition-transform group-open:rotate-90">
                              ›
                            </span>
                            {r.name}
                          </span>
                          <span>
                            {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                          </span>
                          <span>
                            {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                          </span>
                          <span className="font-medium">
                            {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}{" "}
                            {low && <Badge variant="danger">Мало</Badge>}
                          </span>
                          <span>
                            <Money incl={r.value} excl={r.valueExclVat} />
                          </span>
                        </summary>
                        <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-2">
                          <Table>
                            <Thead>
                              <Tr>
                                <Th>Лот</Th>
                                <Th>Сорт/цвет</Th>
                                <Th>Получено</Th>
                                <Th>Остаток</Th>
                                <Th>Себест. за ед. (без НДС / НДС / всего)</Th>
                                <Th>Поставщик / закупка</Th>
                                <Th>Дата поступления</Th>
                                <Th>Использовано в</Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {rowLots.map((l) => (
                                <Tr key={l.id}>
                                  <Td>{l.lotNumber ?? "без номера"}</Td>
                                  <Td>{[l.grade, l.color].filter(Boolean).join(" / ") || "—"}</Td>
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
                                    <span className="font-medium text-neutral-900">
                                      <Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                                    </span>
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
                                            {[l.purchase.auctionSession, l.purchase.transferDocument]
                                              .filter(Boolean)
                                              .join(" · ")}
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
                              {rowLots.length === 0 && (
                                <Tr>
                                  <Td colSpan={8} className="py-4 text-center text-neutral-400">
                                    Лоты не найдены (сузьте поиск/фильтр выше)
                                  </Td>
                                </Tr>
                              )}
                            </Tbody>
                          </Table>
                        </div>
                      </details>
                    </Td>
                  </Tr>
                );
              })}
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

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Подкладка</h2>
        <Link href="/lining" className="text-sm text-neutral-500 hover:underline">
          Смотреть все ткани →
        </Link>
      </div>

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

      <p className="text-sm text-neutral-500">
        Подробный архив по каждой ткани (куплено/использовано/остаток, себестоимость, какие
        закупки её пополнили) — на странице{" "}
        <Link href="/lining" className="underline">
          «Подкладка»
        </Link>
        . Подкладка ведётся одним агрегированным остатком по номеру ткани, а не отдельными
        партиями, поэтому «архива лотов» здесь больше нет — только сама ткань.
      </p>
    </div>
  );
}
