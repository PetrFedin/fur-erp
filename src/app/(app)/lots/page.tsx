import Link from "next/link";
import { cleanSearch } from "@/lib/input";
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
import { LiningPurchaseForm } from "./lining-purchase-form";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export const metadata = { title: "Сырьё" };

/** Сколько лотов меха показываем в развёрнутых списках (остатки по материалам считаются по всем). */
const FUR_LOTS_LIMIT = 1000;

export default async function RawStockPage({ searchParams }: PageProps<"/lots">) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab: "fur" | "lining" = sp.tab === "lining" ? "lining" : "fur";
  const q = cleanSearch(sp.q);
  const materialId = cleanSearch(sp.material);

  const lotsWhere = {
    organizationId: session.user.organizationId,
    rawMaterial: tab === "lining" ? { unit: "M" as const } : { unit: { not: "M" as const } },
    ...(tab === "fur" && materialId ? { rawMaterialId: materialId } : {}),
    ...(tab === "fur" && q
      ? {
          OR: [
            { lotNumber: { contains: q, mode: "insensitive" as const } },
            { color: { contains: q, mode: "insensitive" as const } },
            { grade: { contains: q, mode: "insensitive" as const } },
            { rawMaterial: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [currentLots, allLots, lots, materials, lotsTotal] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId },
      select: { rawMaterialId: true, quantityReceived: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: lotsWhere,
      include: {
        rawMaterial: true,
        purchase: { include: { supplier: true, documents: { orderBy: { createdAt: "asc" } } } },
        usages: { include: { productionOrder: true } },
      },
      orderBy: { receivedDate: tab === "lining" ? "asc" : "desc" },
      ...(tab === "fur" ? { take: FUR_LOTS_LIMIT } : {}),
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, unit: true, minStockLevel: true },
      orderBy: { name: "asc" },
    }),
    tab === "fur" ? prisma.rawMaterialLot.count({ where: lotsWhere }) : Promise.resolve(0),
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

  const furLots = lots;

  const furLotsByMaterial = new Map<string, typeof furLots>();
  for (const l of furLots) {
    const arr = furLotsByMaterial.get(l.rawMaterialId);
    if (arr) arr.push(l);
    else furLotsByMaterial.set(l.rawMaterialId, [l]);
  }

  const liningLotsByMaterial = furLotsByMaterial; // (та же группировка: на вкладке «Подкладка» lots — только ткани)

  const tabLink = (t: string, label: string) => (
    <Link
      href={t === "fur" ? "/lots" : `/lots?tab=${t}`}
      className={
        "rounded-md px-3 py-1.5 text-sm " +
        (tab === t ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Сырьё</h1>
          <p className="text-sm text-neutral-500">Остаток по материалу — разверните, чтобы увидеть лоты.</p>
        </div>
        <Link
          href={tab === "lining" ? "/materials/new?unit=M" : "/materials/new"}
          className={buttonVariants()}
        >
          + Добавить материал
        </Link>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        {tabLink("fur", "Мех")}
        {tabLink("lining", "Подкладка")}
      </div>

      {tab === "fur" ? (
        <>
          <details className="rounded-md border border-neutral-200 bg-white" open={Boolean(q || materialId)}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Фильтры</summary>
            <form className="grid grid-cols-2 sm:grid-cols-4 items-end gap-2 border-t border-neutral-100 p-3" method="get">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-neutral-500">Поиск (лот, материал, цвет, сорт)</label>
                <Input name="q" defaultValue={q} placeholder="напр. 15016 или соболь" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Материал</label>
                <Select name="material" defaultValue={materialId}>
                  <option value="">Все материалы</option>
                  {materials
                    .filter((m) => m.unit !== "M")
                    .map((m) => (
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
              <div className="col-span-2 sm:col-span-4">
                <Link href="/raw-materials" className="text-sm text-neutral-500 hover:underline">
                  Расширенный поиск по лотам и аукционам →
                </Link>
              </div>
            </form>
          </details>

          {lotsTotal > lots.length && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              В раскрытых списках показаны первые {lots.length} лотов из {lotsTotal} (самые свежие) — уточните поиск или
              выберите материал. Остатки и итоги по материалам считаются по всем лотам.
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Мех</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Материал</Th>
                    <Th>Куплено всего</Th>
                    <Th>Использовано</Th>
                    <Th>Остаток</Th>
                    <Th>Стоимость остатка</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {furMaterialRows.map((r) => {
                    const rowLots = furLotsByMaterial.get(r.id) ?? [];
                    const filtering = Boolean(q || materialId);
                    if (filtering && rowLots.length === 0) return null;
                    const low = r.minStockLevel != null && r.remaining.lessThan(r.minStockLevel);
                    return (
                      <Tr key={r.id}>
                        <Td colSpan={5} className="p-0">
                          <details className="group" open={filtering}>
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
                                    <Th>Куплено</Th>
                                    <Th>Остаток</Th>
                                    <Th>Без НДС</Th>
                                    <Th>НДС</Th>
                                    <Th>Всего</Th>
                                    <Th>Использован в ТЗ</Th>
                                    <Th>Закупка / аукцион</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {rowLots.map((l) => {
                                    const excl = lotUnitCostExclVat(l);
                                    const vat = l.unitCost.sub(excl);
                                    const unit = UNIT_LABELS[l.rawMaterial.unit];
                                    return (
                                      <Tr key={l.id}>
                                        <Td>
                                          {l.lotNumber ?? "без номера"}
                                          {(l.grade || l.color) && (
                                            <div className="text-xs text-neutral-400">
                                              {[l.grade, l.color].filter(Boolean).join(" / ")}
                                            </div>
                                          )}
                                        </Td>
                                        <Td>
                                          {formatQty(l.quantityReceived.toString())} {unit}
                                        </Td>
                                        <Td>
                                          {l.quantityRemaining.isZero() ? (
                                            <Badge>Израсходован</Badge>
                                          ) : (
                                            <>
                                              {formatQty(l.quantityRemaining.toString())} {unit}
                                            </>
                                          )}
                                        </Td>
                                        <Td className="whitespace-nowrap">{formatMoney(excl.toString())}</Td>
                                        <Td className="whitespace-nowrap">
                                          {formatMoney(vat.toString())}
                                          <div className="text-xs text-neutral-400">{l.vatRate.toString()}%</div>
                                        </Td>
                                        <Td className="whitespace-nowrap font-medium">
                                          {formatMoney(l.unitCost.toString())}
                                          {l.costBreakdown && (
                                            <CostBreakdownToggle
                                              breakdown={l.costBreakdown as never}
                                              unitCostExcl={excl.toString()}
                                              unitCostIncl={l.unitCost.toString()}
                                            />
                                          )}
                                        </Td>
                                        <Td>
                                          {l.usages.length === 0
                                            ? "—"
                                            : l.usages.map((u) => (
                                                <div key={u.id} className="whitespace-nowrap">
                                                  <Link
                                                    href={`/production/${u.productionOrderId}`}
                                                    className="hover:underline"
                                                  >
                                                    ТЗ {u.productionOrder.number}
                                                  </Link>
                                                  {" — "}
                                                  {formatQty(u.quantity.toString())} {unit}
                                                </div>
                                              ))}
                                        </Td>
                                        <Td>
                                          {l.purchase ? (
                                            <>
                                              <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                                                {l.purchase.supplier.name} ({l.purchase.number})
                                              </Link>
                                              <div className="text-xs text-neutral-400">
                                                {[
                                                  formatDate(l.receivedDate),
                                                  l.purchase.auctionSession,
                                                  l.purchase.transferDocument,
                                                ]
                                                  .filter(Boolean)
                                                  .join(" · ")}
                                              </div>
                                              {l.purchase.documents.map((d) => (
                                                <a
                                                  key={d.id}
                                                  href={`/api/purchase-docs/${d.id}`}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="block text-xs text-blue-600 hover:underline"
                                                >
                                                  📄 {d.title}
                                                </a>
                                              ))}
                                            </>
                                          ) : (
                                            formatDate(l.receivedDate)
                                          )}
                                        </Td>
                                      </Tr>
                                    );
                                  })}
                                  {rowLots.length === 0 && (
                                    <Tr>
                                      <Td colSpan={8} className="py-4 text-center text-neutral-400">
                                        Лоты не найдены (сузьте поиск/фильтр выше)
                                      </Td>
                                    </Tr>
                                  )}
                                </Tbody>
                              </Table>
                              <p className="mt-1 text-xs text-neutral-400">Цены — за единицу материала.</p>
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
                <span className="ml-1 font-semibold text-neutral-900">
                  <Money incl={furTotalValue} excl={furTotalValueExclVat} />
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Подкладка</CardTitle>
          </CardHeader>
          <CardContent>
            <LiningPurchaseForm
              materials={materials
                .filter((m) => m.unit === "M")
                .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }))
                .map((m) => ({ id: m.id, name: m.name }))}
            />
            <Table>
              <Thead>
                <Tr>
                  <Th>№ ткани</Th>
                  <Th>Куплено</Th>
                  <Th>Использовано</Th>
                  <Th>Остаток</Th>
                  <Th>Стоимость</Th>
                </Tr>
              </Thead>
              <Tbody>
                {liningMaterialRows.map((r) => {
                  const rowLots = liningLotsByMaterial.get(r.id) ?? [];
                  const perOrder = new Map<string, { id: string; number: string; qty: Decimal }>();
                  for (const l of rowLots) {
                    for (const u of l.usages) {
                      const e = perOrder.get(u.productionOrderId);
                      if (e) e.qty = e.qty.add(u.quantity);
                      else
                        perOrder.set(u.productionOrderId, {
                          id: u.productionOrderId,
                          number: u.productionOrder.number,
                          qty: u.quantity,
                        });
                    }
                  }
                  const depleted = r.remaining.lessThanOrEqualTo(0);
                  // Real остаток incl. negative pools (currentLots only sees > 0).
                  const poolRemaining = rowLots.reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
                  const shortage = poolRemaining.lessThan(0) ? poolRemaining.neg() : null;
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
                            <span>{formatQty(r.purchased.toString())} м</span>
                            <span>{formatQty(r.purchased.sub(r.remaining).toString())} м</span>
                            <span className="font-medium">
                              {shortage ? "0" : formatQty(r.remaining.toString())} м{" "}
                              {shortage ? (
                                <Badge variant="warning">Не хватает {formatQty(shortage.toString())} м</Badge>
                              ) : (
                                depleted && <span className="text-xs font-normal text-neutral-500">остаток 0</span>
                              )}
                            </span>
                            <span>
                              <Money incl={r.value} excl={r.valueExclVat} />
                            </span>
                          </summary>
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2">
                            <div>
                              <div className="mb-1 text-xs font-semibold text-neutral-500">Закупки</div>
                              <Table>
                                <Thead>
                                  <Tr>
                                    <Th>Закупка</Th>
                                    <Th>Дата</Th>
                                    <Th>Куплено</Th>
                                    <Th>Цена за м</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {rowLots.map((l) => (
                                    <Tr key={l.id}>
                                      <Td>
                                        {l.purchase ? (
                                          <Link href={`/purchases/${l.purchase.id}`} className="hover:underline">
                                            {l.purchase.supplier.name} ({l.purchase.number})
                                          </Link>
                                        ) : (
                                          "—"
                                        )}
                                      </Td>
                                      <Td>{formatDate(l.receivedDate)}</Td>
                                      <Td>{formatQty(l.quantityReceived.toString())} м</Td>
                                      <Td>
                                        <Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                                      </Td>
                                    </Tr>
                                  ))}
                                  {rowLots.length === 0 && (
                                    <Tr>
                                      <Td colSpan={4} className="py-3 text-center text-neutral-400">
                                        Эта ткань пока не закупалась
                                      </Td>
                                    </Tr>
                                  )}
                                </Tbody>
                              </Table>
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-semibold text-neutral-500">Использована в ТЗ</div>
                              <Table>
                                <Thead>
                                  <Tr>
                                    <Th>ТЗ</Th>
                                    <Th>Метров</Th>
                                  </Tr>
                                </Thead>
                                <Tbody>
                                  {Array.from(perOrder.values()).map((o) => (
                                    <Tr key={o.id}>
                                      <Td>
                                        <Link href={`/production/${o.id}`} className="hover:underline">
                                          ТЗ {o.number}
                                        </Link>
                                      </Td>
                                      <Td>{formatQty(o.qty.toString())} м</Td>
                                    </Tr>
                                  ))}
                                  {perOrder.size === 0 && (
                                    <Tr>
                                      <Td colSpan={2} className="py-3 text-center text-neutral-400">
                                        Пока не использовалась
                                      </Td>
                                    </Tr>
                                  )}
                                </Tbody>
                              </Table>
                            </div>
                          </div>
                        </details>
                      </Td>
                    </Tr>
                  );
                })}
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
              <span className="ml-1 font-semibold text-neutral-900">
                <Money incl={liningTotalValue} excl={liningTotalValueExclVat} />
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
