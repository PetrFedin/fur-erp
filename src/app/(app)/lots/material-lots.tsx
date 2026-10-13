import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { escapeLike } from "@/lib/input";
import { shortAuctionName } from "@/lib/auction-names";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { ruGradeLabel } from "@/lib/fur-ref";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { getYearFilter, type YearFilter } from "@/lib/year-filter";
import { lotYear } from "@/lib/year-scope";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Ref4 } from "@/components/c4-note";
import { CostBreakdownToggle } from "./cost-breakdown-toggle";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

/** Сколько лотов одного материала показываем в раскрытом списке (остатки и итоги считаются по всем). */
export const FUR_LOTS_LIMIT = 1000;

/** Условие выборки лотов меха: организация + (материал) + (поиск по № лота / цвету / сорту / названию). */
export function furLotsWhere(organizationId: string, opts: { materialId?: string; q?: string; year?: YearFilter }) {
  const { materialId, q, year = "all" } = opts;
  return {
    organizationId,
    ...lotYear(year),
    rawMaterial: { unit: { not: "M" as const } },
    ...(materialId ? { rawMaterialId: materialId } : {}),
    ...(q
      ? {
          OR: [
            { lotNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
            { color: { contains: escapeLike(q), mode: "insensitive" as const } },
            { grade: { contains: escapeLike(q), mode: "insensitive" as const } },
            { rawMaterial: { name: { contains: escapeLike(q), mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

/**
 * Лоты одного материала (таблица на десктопе, карточки на телефоне).
 * Грузятся только при раскрытии материала — не вместе со всей страницей «Сырьё».
 */
export async function MaterialLots({ organizationId, materialId, q }: { organizationId: string; materialId: string; q: string }) {
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const rowLots = await prisma.rawMaterialLot.findMany({
    where: furLotsWhere(organizationId, { materialId, q, year }),
    include: {
      rawMaterial: true,
      purchase: { include: { supplier: true, documents: { orderBy: { createdAt: "asc" } } } },
      usages: { include: { productionOrder: true } },
    },
    orderBy: { receivedDate: "desc" },
    take: FUR_LOTS_LIMIT,
  });
  return (
  <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-2">
    <ResponsiveRows
      table={
    <Table>
      <Thead>
        <Tr>
          <Th>Лот</Th>
          <Th>Куплено</Th>
          <Th>Остаток</Th>
          <Th>Без НДС</Th>
          <Th>НДС</Th>
          <Th>Всего, ₽</Th>
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
                  <div className="text-xs text-neutral-500">
                    {[ruGradeLabel(l.grade), l.color].filter(Boolean).join(" / ")}
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
                <div className="text-xs text-neutral-500">{l.vatRate.toString()}%</div>
              </Td>
              <Td className="whitespace-nowrap font-medium">
                {formatMoney(l.unitCost.toString())}
                <Ref4 mode={c4Mode} incl={l.unitCost} excl={excl} />
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
                      {l.purchase.number}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {[
                        formatDate(l.receivedDate),
                        l.purchase.auctionSession ? shortAuctionName(l.purchase.auctionSession.split("\n")[0], 60) : null,
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
            <Td colSpan={8} className="py-4 text-center text-neutral-500">
              Лоты не найдены (сузьте поиск/фильтр выше)
            </Td>
          </Tr>
        )}
      </Tbody>
    </Table>
      }
    >
      {rowLots.map((l) => {
        const excl = lotUnitCostExclVat(l);
        const unit = UNIT_LABELS[l.rawMaterial.unit];
        return (
          <RowCard
            key={l.id}
            title={l.lotNumber ?? "без номера"}
            subtitle={[ruGradeLabel(l.grade), l.color].filter(Boolean).join(" / ") || undefined}
            badge={l.quantityRemaining.isZero() ? <Badge>Израсходован</Badge> : undefined}
            fields={[
              { label: "Куплено", value: `${formatQty(l.quantityReceived.toString())} ${unit}` },
              { label: "Остаток", value: `${formatQty(l.quantityRemaining.toString())} ${unit}`, strong: true },
              { label: "Цена за ед. (всего)", value: <>{formatMoney(l.unitCost.toString())}<Ref4 mode={c4Mode} incl={l.unitCost} excl={excl} /></>, strong: true },
              { label: "Без НДС", value: formatMoney(excl.toString()) },
            ]}
            details={[
              {
                label: "НДС",
                value: `${formatMoney(l.unitCost.sub(excl).toString())} (${l.vatRate.toString()}%)`,
              },
              {
                label: "Использован в ТЗ",
                value:
                  l.usages.length === 0 ? null : (
                    <>
                      {l.usages.map((u) => (
                        <div key={u.id}>
                          <Link href={`/production/${u.productionOrderId}`} className="underline">
                            ТЗ {u.productionOrder.number}
                          </Link>
                          {" — "}
                          {formatQty(u.quantity.toString())} {unit}
                        </div>
                      ))}
                    </>
                  ),
              },
              {
                label: "Закупка / аукцион",
                value: l.purchase ? (
                  <>
                    <Link href={`/purchases/${l.purchase.id}`} className="underline">
                      {l.purchase.number}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {[
                        formatDate(l.receivedDate),
                        l.purchase.auctionSession ? shortAuctionName(l.purchase.auctionSession.split("\n")[0], 60) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </>
                ) : (
                  formatDate(l.receivedDate)
                ),
              },
            ]}
          />
        );
      })}
      {rowLots.length === 0 && (
        <p className="py-4 text-center text-neutral-500">Лоты не найдены (сузьте поиск/фильтр выше)</p>
      )}
    </ResponsiveRows>
    <p className="mt-1 text-xs text-neutral-500">Цены — за единицу материала.</p>
  </div>
  );
}
