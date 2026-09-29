import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { CostBreakdownToggle } from "../lots/cost-breakdown-toggle";

// Canonical "home" page for lining fabric — see the /lots and /purchases
// lining cards, which link here. Unlike /lots (which mixes fur and lining
// in one archive) this page exists only for the 7 "Подкладочная ткань №…"
// materials (RawMaterial.unit === "M"), so every fabric-specific question
// (remaining, which purchases fed the pool, itemized cost if known) has one
// obvious place to answer it — see commit cfc5cd6 for why lining is now a
// single aggregate RawMaterialLot per fabric rather than one lot per usage.

export default async function LiningPage() {
  const session = await requireSession();

  const materials = await prisma.rawMaterial.findMany({
    where: { organizationId: session.user.organizationId, unit: "M" },
    orderBy: { name: "asc" },
  });

  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: session.user.organizationId, rawMaterial: { unit: "M" } },
    include: {
      warehouse: true,
      purchase: { include: { supplier: true } },
      usages: { include: { productionOrder: true } },
    },
    orderBy: { receivedDate: "asc" },
  });

  type Row = {
    id: string;
    name: string;
    purchased: Decimal;
    remaining: Decimal;
    valueIncl: Decimal;
    valueExcl: Decimal;
    lots: typeof lots;
  };
  const rows = new Map<string, Row>();
  for (const m of materials) {
    rows.set(m.id, {
      id: m.id,
      name: m.name,
      purchased: new Decimal(0),
      remaining: new Decimal(0),
      valueIncl: new Decimal(0),
      valueExcl: new Decimal(0),
      lots: [],
    });
  }
  for (const l of lots) {
    const row = rows.get(l.rawMaterialId);
    if (!row) continue;
    row.purchased = row.purchased.add(l.quantityReceived);
    row.remaining = row.remaining.add(l.quantityRemaining);
    row.valueIncl = row.valueIncl.add(l.quantityRemaining.mul(l.unitCost));
    row.valueExcl = row.valueExcl.add(l.quantityRemaining.mul(lotUnitCostExclVat(l)));
    row.lots.push(l);
  }
  const materialRows = Array.from(rows.values());
  const totalValueIncl = materialRows.reduce((s, r) => s.add(r.valueIncl), new Decimal(0));
  const totalValueExcl = materialRows.reduce((s, r) => s.add(r.valueExcl), new Decimal(0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Подкладка</h1>
        <Link href="/materials/new?unit=M" className={buttonVariants()}>
          + Добавить ткань
        </Link>
      </div>
      <p className="text-sm text-neutral-500">
        Единая страница по каждой подкладочной ткани: сколько куплено, сколько израсходовано,
        сколько осталось в общем пуле и какие закупки его пополнили. Ткань ведётся без повторов —
        по номеру, суммами (см. коммит о консолидации лотов подкладки), а не как отдельная партия
        на каждое ТЗ.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Остатки по тканям</CardTitle>
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
              {materialRows.map((r) => {
                const depleted = r.remaining.lessThanOrEqualTo(0);
                return (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td>{formatQty(r.purchased.toString())} м</Td>
                    <Td>{formatQty(r.purchased.sub(r.remaining).toString())} м</Td>
                    <Td className="font-medium">
                      {formatQty(r.remaining.toString())} м{" "}
                      {depleted && <Badge variant="danger">Остаток исчерпан</Badge>}
                    </Td>
                    <Td>
                      <Money incl={r.valueIncl} excl={r.valueExcl} />
                    </Td>
                  </Tr>
                );
              })}
              {materialRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-8 text-center text-neutral-400">
                    Подкладка ещё не заведена
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <div className="mt-3 flex justify-end text-sm">
            <span className="text-neutral-500">Итого стоимость остатков подкладки: </span>
            <span className="ml-1 font-semibold text-neutral-900">
              <Money incl={totalValueIncl} excl={totalValueExcl} />
            </span>
          </div>
        </CardContent>
      </Card>

      {materialRows.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>
              {r.name}
              {r.remaining.lessThanOrEqualTo(0) && (
                <Badge variant="danger" className="ml-2">
                  Остаток исчерпан
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-neutral-500">
              Куплено {formatQty(r.purchased.toString())} м · использовано{" "}
              {formatQty(r.purchased.sub(r.remaining).toString())} м · остаток{" "}
              <span className="font-medium text-neutral-900">{formatQty(r.remaining.toString())} м</span>
            </p>
            <Table>
              <Thead>
                <Tr>
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
                {r.lots.map((l) => (
                  <Tr key={l.id}>
                    <Td>{l.warehouse.name}</Td>
                    <Td>{formatQty(l.quantityReceived.toString())} м</Td>
                    <Td>
                      {l.quantityRemaining.isZero() ? (
                        <Badge>Израсходован</Badge>
                      ) : (
                        <>{formatQty(l.quantityRemaining.toString())} м</>
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
                {r.lots.length === 0 && (
                  <Tr>
                    <Td colSpan={7} className="py-6 text-center text-neutral-400">
                      Эта ткань пока не закупалась
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
