import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { SearchableCheckboxList } from "./searchable-checkbox-list";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

type Breakdown = {
  furDescription?: string | null;
  exchangeRateInvoice?: string | null;
  exchangeRateFixed?: string | null;
  items: { label: string; value: number }[];
};

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function RawMaterialsPage({ searchParams }: PageProps<"/raw-materials">) {
  const session = await requireSession();
  const sp = await searchParams;
  const selectedMaterials = toArray(sp.material as string | string[] | undefined);
  const selectedAuctions = toArray(sp.auction as string | string[] | undefined);
  const selectedLots = toArray(sp.lot as string | string[] | undefined);

  const [materials, auctionRows, lotNumberRows] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.purchase.findMany({
      where: { organizationId: session.user.organizationId, auctionSession: { not: null } },
      select: { auctionSession: true },
      distinct: ["auctionSession"],
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, lotNumber: { not: null } },
      select: { lotNumber: true },
      distinct: ["lotNumber"],
    }),
  ]);

  const auctionOptions = auctionRows
    .map((r) => r.auctionSession as string)
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((a) => ({ value: a, label: a }));

  const lotOptions = lotNumberRows
    .map((r) => r.lotNumber as string)
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
    .map((l) => ({ value: l, label: l }));

  const hasFilters = selectedMaterials.length > 0 || selectedAuctions.length > 0 || selectedLots.length > 0;

  const lots = hasFilters
    ? await prisma.rawMaterialLot.findMany({
        where: {
          organizationId: session.user.organizationId,
          ...(selectedMaterials.length > 0 ? { rawMaterialId: { in: selectedMaterials } } : {}),
          ...(selectedLots.length > 0 ? { lotNumber: { in: selectedLots } } : {}),
          ...(selectedAuctions.length > 0
            ? { purchase: { auctionSession: { in: selectedAuctions } } }
            : {}),
        },
        include: {
          rawMaterial: true,
          purchase: { include: { supplier: true } },
        },
        orderBy: { receivedDate: "desc" },
      })
    : [];

  // Aggregate summary for the current selection.
  const totalQuantityReceived = lots.reduce((s, l) => s.add(l.quantityReceived), new Decimal(0));
  const totalValueInclVat = lots.reduce((s, l) => s.add(l.totalCost), new Decimal(0));

  // Union of cost-breakdown item labels across the filtered lots, in first-seen order,
  // so different report seasons' components all get a column even if not every lot has it.
  const breakdownLabels: string[] = [];
  const seenLabels = new Set<string>();
  let anyExchangeRate = false;
  for (const l of lots) {
    const bd = l.costBreakdown as Breakdown | null;
    if (!bd) continue;
    if (bd.exchangeRateInvoice || bd.exchangeRateFixed) anyExchangeRate = true;
    for (const item of bd.items ?? []) {
      if (!seenLabels.has(item.label)) {
        seenLabels.add(item.label);
        breakdownLabels.push(item.label);
      }
    }
  }
  const lotsWithBreakdown = lots.filter((l) => l.costBreakdown);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Сырьё</h1>
      <p className="text-sm text-neutral-500">Выберите аукцион, материал или лот — покажем закупленное и себестоимость.</p>

      <form method="get" className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Аукцион / сессия закупки</label>
            <SearchableCheckboxList
              name="auction"
              options={auctionOptions}
              selected={selectedAuctions}
              placeholder="Фильтр по аукциону…"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Материал</label>
            <SearchableCheckboxList
              name="material"
              options={materials.map((m) => ({ value: m.id, label: m.name }))}
              selected={selectedMaterials}
              placeholder="Фильтр по материалу…"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Номер лота</label>
            <SearchableCheckboxList
              name="lot"
              options={lotOptions}
              selected={selectedLots}
              placeholder="Фильтр по номеру лота…"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Показать
          </Button>
          <Link href="/raw-materials" className="flex items-center text-sm text-neutral-500 hover:underline">
            Сбросить все фильтры
          </Link>
        </div>
      </form>

      {!hasFilters ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-neutral-400">
            Выберите хотя бы один фильтр (аукцион, материал или лот), чтобы увидеть закупленное
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Лотов найдено</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-neutral-900">{lots.length}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Куплено всего (получено)</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-neutral-900">
                {formatQty(totalQuantityReceived.toString())}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Стоимость закупки (с НДС)</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-neutral-900">
                {formatMoney(totalValueInclVat.toString())}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Закупленные лоты по выбранным фильтрам</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Материал</Th>
                    <Th>Лот</Th>
                    <Th>Сорт/цвет</Th>
                    <Th>Получено</Th>
                    <Th>Остаток</Th>
                    <Th>Себестоимость за ед. (без НДС / НДС / всего)</Th>
                    <Th>Аукцион/сессия</Th>
                    <Th>Закупка</Th>
                    <Th>Дата поступления</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lots.map((l) => (
                    <Tr key={l.id}>
                      <Td className="font-medium">{l.rawMaterial.name}</Td>
                      <Td>{l.lotNumber ?? "без номера"}</Td>
                      <Td>{[l.grade, l.color].filter(Boolean).join(" / ") || "—"}</Td>
                      <Td>
                        {formatQty(l.quantityReceived.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                      </Td>
                      <Td>
                        {formatQty(l.quantityRemaining.toString())} {UNIT_LABELS[l.rawMaterial.unit]}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatMoney(l.materialCostExclVat.toString())} / {l.vatRate.toString()}% /{" "}
                        <span className="font-medium text-neutral-900">
                          <Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                        </span>
                      </Td>
                      <Td>{l.purchase?.auctionSession ?? "—"}</Td>
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
                    </Tr>
                  ))}
                  {lots.length === 0 && (
                    <Tr>
                      <Td colSpan={9} className="py-8 text-center text-neutral-400">
                        По выбранным фильтрам ничего не найдено
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Из чего сложилась цена по лотам</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-neutral-500">
                Лоты с сохранённым расчётом: {lotsWithBreakdown.length} из {lots.length}. Пусто — составляющей у лота нет.
              </p>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Материал</Th>
                    <Th>Лот</Th>
                    <Th>Аукцион/сессия</Th>
                    {anyExchangeRate && <Th>Курс инвойса</Th>}
                    {anyExchangeRate && <Th>Курс ЦБ (фиксация)</Th>}
                    {breakdownLabels.map((label) => (
                      <Th key={label}>{label}</Th>
                    ))}
                    <Th>Себестоимость за ед. (итог)</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lotsWithBreakdown.map((l) => {
                    const bd = l.costBreakdown as Breakdown;
                    const itemMap = new Map(bd.items.map((i) => [i.label, i.value]));
                    return (
                      <Tr key={l.id}>
                        <Td className="font-medium whitespace-nowrap">{l.rawMaterial.name}</Td>
                        <Td className="whitespace-nowrap">{l.lotNumber ?? "без номера"}</Td>
                        <Td className="whitespace-nowrap">{l.purchase?.auctionSession ?? "—"}</Td>
                        {anyExchangeRate && (
                          <Td className="whitespace-nowrap">{bd.exchangeRateInvoice ?? "—"}</Td>
                        )}
                        {anyExchangeRate && (
                          <Td className="whitespace-nowrap">{bd.exchangeRateFixed ?? "—"}</Td>
                        )}
                        {breakdownLabels.map((label) => {
                          const v = itemMap.get(label);
                          return (
                            <Td key={label} className="whitespace-nowrap font-mono text-xs">
                              {v === undefined ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                            </Td>
                          );
                        })}
                        <Td className="whitespace-nowrap font-medium text-neutral-900">
                          <Money incl={l.unitCost} excl={lotUnitCostExclVat(l)} />
                        </Td>
                      </Tr>
                    );
                  })}
                  {lotsWithBreakdown.length === 0 && (
                    <Tr>
                      <Td
                        colSpan={4 + (anyExchangeRate ? 2 : 0) + breakdownLabels.length}
                        className="py-8 text-center text-neutral-400"
                      >
                        Для лотов выборки детальный расчёт цены не сохранён
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
