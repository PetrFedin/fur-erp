import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, lotUnitCostExclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { InclVatOnlyLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { CompactMoney } from "./compact-money";
import { formatCompactMoney } from "./compact";
import { computeAttention, countAttention } from "@/lib/attention";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export const metadata = { title: "Сводка" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  // requireRole() redirects here with ?error=forbidden when a role may not do an action.
  const sp = await searchParams;
  const forbidden = sp.error === "forbidden";
  const organizationId = session.user.organizationId;

  const [
    allPurchases,
    supplierDebt,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    clientOrders,
    clientPayments,
    attentionChecks,
  ] = await Promise.all([
    // Отменённые закупки в «Куплено сырья» не входят.
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: { items: true, expenses: true },
    }),
    // Единый расчёт «Долга поставщику» (то же число — везде, см. src/lib/supplier-debt.ts).
    loadSupplierDebt(prisma, organizationId),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId },
      select: { rawMaterialId: true, quantityReceived: true },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId } },
      select: {
        quantity: true,
        totalCost: true,
        commission4: true,
        lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
      },
    }),
    // ТЗ производства под заказчика (давальческая схема) — заказы без
    // clientId — это собственное производство, не подлежит взысканию.
    prisma.productionOrder.findMany({
      where: { organizationId, clientId: { not: null }, status: { not: "CANCELLED" } },
      include: { client: true },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId },
      include: { orders: { select: { id: true } } },
    }),
    computeAttention(prisma, organizationId),
  ]);
  const attention = countAttention(attentionChecks);

  // Raw + finished stock value
  const rawStockValue = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(l.unitCost)),
    new Decimal(0)
  );
  const rawStockValueExclVat = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(lotUnitCostExclVat(l))),
    new Decimal(0)
  );
  // Client production debt (задолженность заказчиков): what clients owe us
  // for давальческая (ТЗ) production work. Billable amount uses
  // clientWorkPricePerUnit — the price charged to the client for the work
  // itself — the same field and "produced or, until then, planned" quantity
  // rule already used on the order detail page's own "Остаток к оплате"
  // figure (see production/[id]/page.tsx), for consistency. retailPrice is
  // a different, unrelated field (own retail channel markup, not давалец
  // billing) and is intentionally not used here. Orders without
  // clientWorkPricePerUnit set are not billable (can't invent a price) and
  // are counted separately as a caveat rather than treated as zero.
  type ClientDebt = {
    clientId: string;
    clientName: string;
    billable: Decimal;
    paid: Decimal;
    unpricedOrders: number;
    orders: number;
  };
  const clientDebtMap = new Map<string, ClientDebt>();
  for (const o of clientOrders) {
    if (!o.clientId || !o.client) continue;
    const entry = clientDebtMap.get(o.clientId) ?? {
      clientId: o.clientId,
      clientName: o.client.name,
      billable: new Decimal(0),
      paid: new Decimal(0),
      unpricedOrders: 0,
      orders: 0,
    };
    entry.orders += 1;
    if (o.clientWorkPricePerUnit) {
      const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
      entry.billable = entry.billable.add(o.clientWorkPricePerUnit.mul(qty));
    } else {
      entry.unpricedOrders += 1;
    }
    clientDebtMap.set(o.clientId, entry);
  }
  // Авансы заказчика без ТЗ (clientId есть, ни к одному ТЗ не привязаны) вычитаются из долга этого заказчика
  // наравне с остальными оплатами; оплаты без заказчика в долг не входят.
  let advancesDeducted = new Decimal(0); // авансы без ТЗ, вычтенные из долга
  let advancesNotCounted = new Decimal(0); // авансы без ТЗ, которые в долг не вошли (нет заказчика или у него нет ТЗ)
  for (const p of clientPayments) {
    const entry = p.clientId ? clientDebtMap.get(p.clientId) : undefined;
    if (entry) entry.paid = entry.paid.add(p.amount);
    if (p.orders.length === 0) {
      if (entry) advancesDeducted = advancesDeducted.add(p.amount);
      else advancesNotCounted = advancesNotCounted.add(p.amount);
    }
  }
  const clientDebts = Array.from(clientDebtMap.values())
    .map((c) => ({ ...c, balance: c.billable.sub(c.paid) }))
    .sort((a, b) => (b.balance.greaterThan(a.balance) ? 1 : -1));
  const clientDebtTotal = clientDebts.reduce((s, c) => s.add(c.balance), new Decimal(0));

  // Lifetime raw material purchased/used/remaining, by material (used = purchased - remaining).
  type MaterialFlow = {
    id: string;
    name: string;
    unit: string;
    purchased: Decimal;
    remaining: Decimal;
    remainingValue: Decimal;
    remainingValueExclVat: Decimal;
  };
  const materialFlowMap = new Map<string, MaterialFlow>();
  for (const m of materials) {
    materialFlowMap.set(m.id, {
      id: m.id,
      name: m.name,
      unit: m.unit,
      purchased: new Decimal(0),
      remaining: new Decimal(0),
      remainingValue: new Decimal(0),
      remainingValueExclVat: new Decimal(0),
    });
  }
  for (const l of allLots) {
    const agg = materialFlowMap.get(l.rawMaterialId);
    if (agg) agg.purchased = agg.purchased.add(l.quantityReceived);
  }
  for (const l of lowStockMaterials) {
    const agg = materialFlowMap.get(l.rawMaterialId);
    if (agg) {
      agg.remaining = agg.remaining.add(l.quantityRemaining);
      agg.remainingValue = agg.remainingValue.add(l.quantityRemaining.mul(l.unitCost));
      agg.remainingValueExclVat = agg.remainingValueExclVat.add(l.quantityRemaining.mul(lotUnitCostExclVat(l)));
    }
  }
  const materialFlowRows = Array.from(materialFlowMap.values()).filter(
    (r) => r.purchased.greaterThan(0) || r.remaining.greaterThan(0)
  );
  // Сводка: 5 строк меха (по стоимости остатка), вся подкладка (единица «м») — одной строкой.
  // Полностью израсходованные материалы скрыты; полный список — в разделе «Сырьё».
  const liveRows = materialFlowRows.filter((r) => !(r.remaining.isZero() && r.remainingValue.isZero()));
  const allFurRows = liveRows.filter((r) => r.unit !== "M").sort((a, b) => b.remainingValue.comparedTo(a.remainingValue));
  const furRows = allFurRows.slice(0, 5);
  const moreFurRows = allFurRows.length - furRows.length;
  const liningRows = liveRows.filter((r) => r.unit === "M");
  const liningRow = liningRows.length
    ? {
        key: "lining",
        name: liningRows.length > 1 ? `Подкладка (${liningRows.length} вида)` : liningRows[0].name,
        unit: "M",
        href: "/lots?tab=lining",
        purchased: liningRows.reduce((s, r) => s.add(r.purchased), new Decimal(0)),
        remaining: liningRows.reduce((s, r) => s.add(r.remaining), new Decimal(0)),
        remainingValue: liningRows.reduce((s, r) => s.add(r.remainingValue), new Decimal(0)),
        remainingValueExclVat: liningRows.reduce((s, r) => s.add(r.remainingValueExclVat), new Decimal(0)),
      }
    : null;

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalPurchasedValueExclVat = allPurchases.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));
  // «Использовано в ТЗ» в режиме «С 4%»: +4% к строкам списаний с commission4 = true.
  // Закупки, остатки сырья и долги — всегда без 4%.
  const usedSum = sumUsagesWith4(materialUsedAgg, c4Mode);
  const totalMaterialUsedValue = usedSum.incl;
  const totalMaterialUsedValueExclVat = usedSum.excl;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Сводка</h1>
        <Link href="/payments" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center">
          Оплаты →
        </Link>
      </div>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Куплено сырья"
          hint="Все закупки, кроме отменённых, вместе с черновиками (мех по ним ещё не принят)."
          value={<CompactMoney incl={totalPurchasedValue.toString()} excl={totalPurchasedValueExclVat.toString()} />}
        />
        <KpiCard
          label={`Списано в ТЗ${c4Suffix(c4Mode)}`}
          hint="Стоимость сырья, уже ушедшего в производство."
          value={<CompactMoney incl={totalMaterialUsedValue.toString()} excl={totalMaterialUsedValueExclVat.toString()} />}
        />
        <KpiCard
          label="Сырьё на складе"
          hint="Во сколько оценивается мех и подкладка, которые лежат на складе."
          value={<CompactMoney incl={rawStockValue.toString()} excl={rawStockValueExclVat.toString()} />}
        />
        <KpiCard
          label={<InclVatOnlyLabel base="Долг поставщику" />}
          hint={
            supplierDebt.draftDebt.greaterThan(0)
              ? `Сколько ещё заплатить. Из них ${formatMoney(supplierDebt.draftDebt.toString())} — за черновики (мех не принят).`
              : "Сколько ещё заплатить поставщику."
          }
          note={`стоимость закупок ${formatCompactMoney(supplierDebt.total.toString())} − оплачено ${formatCompactMoney(supplierDebt.paid.toString())} − авансы без привязки ${formatCompactMoney(supplierDebt.unlinkedAdvances.toString())}`}
          value={<CompactMoney incl={supplierDebt.debt.toString()} />}
          warn={supplierDebt.debt.greaterThan(0)}
        />
        <KpiCard
          label={<InclVatOnlyLabel base="Долг заказчиков" />}
          hint="Сколько заказчики ещё должны за работу по ТЗ."
          note={
            advancesDeducted.greaterThan(0) || advancesNotCounted.greaterThan(0)
              ? [
                  advancesDeducted.greaterThan(0) ? `авансы без ТЗ ${formatCompactMoney(advancesDeducted.toString())} уже вычтены` : "",
                  advancesNotCounted.greaterThan(0) ? `авансы без ТЗ ${formatCompactMoney(advancesNotCounted.toString())} не вычтены (нет заказчика или его ТЗ)` : "",
                ]
                  .filter(Boolean)
                  .join("; ")
              : "авансов без ТЗ нет"
          }
          value={<CompactMoney incl={clientDebtTotal.toString()} />}
          warn={clientDebtTotal.greaterThan(0)}
        />
        <KpiCard
          label="Требует внимания"
          hint={
            attention.main === 0
              ? "Всё заведено."
              : "Не заведены документы, даты, оплаты (красные и жёлтые пункты). Серые — справочно, могут быть нормой."
          }
          note={
            attention.main === 0
              ? attention.gray > 0
                ? `+${attention.gray} серых`
                : undefined
              : `срочных: ${attention.red}${attention.gray > 0 ? `; +${attention.gray} серых` : ""}`
          }
          value={attention.main === 0 ? "Всё заведено ✓" : String(attention.main)}
          warn={attention.main > 0}
          danger={attention.red > 0}
          href="/attention"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сырьё по материалам</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const matRows = [...furRows.map((r) => ({ ...r, key: r.id, name: r.name, href: "/lots" })), ...(liningRow ? [liningRow] : [])];
            const emptyText = "Сырьё ещё не закупалось";
            return (
              <ResponsiveRows
                table={
            <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th>Куплено</Th>
                  <Th>Использовано</Th>
                  <Th>Остаток</Th>
                  <Th>Стоимость остатка</Th>
                </Tr>
              </Thead>
              <Tbody>
                {[...furRows.map((r) => ({ ...r, key: r.id, name: r.name, href: "/lots" })), ...(liningRow ? [liningRow] : [])].map((r) => (
                  <Tr key={r.key}>
                    <Td className="font-medium">
                      <Link href={r.href} className="hover:underline">
                        {r.name}
                      </Link>
                    </Td>
                    <Td>
                      {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                    </Td>
                    <Td>
                      {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                    </Td>
                    <Td className={r.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>
                      {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                    </Td>
                    <Td>
                      <Money incl={r.remainingValue} excl={r.remainingValueExclVat} />
                    </Td>
                  </Tr>
                ))}
                {furRows.length === 0 && !liningRow && (
                  <Tr>
                    <Td colSpan={5} className="py-6 text-center text-neutral-400">
                      Сырьё ещё не закупалось
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
                }
              >
                {matRows.map((r) => (
                  <RowCard
                    key={r.key}
                    title={r.name}
                    href={r.href}
                    fields={[
                      { label: "Куплено", value: `${formatQty(r.purchased.toString())} ${UNIT_LABELS[r.unit]}` },
                      { label: "Использовано", value: `${formatQty(r.purchased.sub(r.remaining).toString())} ${UNIT_LABELS[r.unit]}` },
                      {
                        label: "Остаток",
                        value: (
                          <span className={r.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>
                            {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                          </span>
                        ),
                      },
                      { label: "Стоимость остатка", value: <Money incl={r.remainingValue} excl={r.remainingValueExclVat} /> },
                    ]}
                  />
                ))}
                {matRows.length === 0 && <p className="py-6 text-center text-neutral-400">{emptyText}</p>}
              </ResponsiveRows>
            );
          })()}
          <p className="mt-3 text-sm">
            <Link href="/lots" className="inline-block text-neutral-600 hover:underline max-md:py-2">
              Все материалы → Сырьё
            </Link>
            {moreFurRows > 0 && <span className="ml-3 text-neutral-400">Меха ещё: {moreFurRows}</span>}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><InclVatOnlyLabel base="Долг по аукционам" /></CardTitle>
          </CardHeader>
          <CardContent>
            {supplierDebt.byAuction.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400">Задолженностей нет</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-neutral-500">Топ-5 по остатку. Нажмите на аукцион — откроются его оплаты.</p>
                <div className="flex flex-col gap-2">
                  {supplierDebt.byAuction.slice(0, 5).map((a) => (
                    <Link
                      key={a.name}
                      href={`/payments?auction=${encodeURIComponent(a.name)}#auction-block`}
                      className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50"
                    >
                      <span>
                        <span className="font-medium">{a.name}</span>
                        <span className="block text-xs text-neutral-500">
                          оплачено {formatMoney(a.paid.toString())} из {formatMoney(a.total.toString())}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-semibold text-amber-600">{formatMoney(a.due.toString())}</span>
                    </Link>
                  ))}
                </div>
                {supplierDebt.byAuction.length > 5 && (
                  <p className="mt-1 text-xs text-neutral-500">Ещё аукционов с остатком: {supplierDebt.byAuction.length - 5}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><InclVatOnlyLabel base="Долг заказчиков" /></CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Заказчик</Th>
                  <Th>ТЗ</Th>
                  <Th>Остаток к оплате</Th>
                </Tr>
              </Thead>
              <Tbody>
                {clientDebts.map((c) => (
                  <Tr key={c.clientId}>
                    <Td>
                      <Link href={`/production?q=${encodeURIComponent(c.clientName)}`} className="hover:underline">
                        {c.clientName}
                      </Link>
                      {c.unpricedOrders > 0 && (
                        <span className="ml-1 text-xs text-neutral-400">
                          ({c.unpricedOrders} ТЗ без цены работ — не учтены)
                        </span>
                      )}
                    </Td>
                    <Td>{c.orders}</Td>
                    <Td className={c.balance.greaterThan(0) ? "text-amber-600" : ""}>
                      {formatMoney(c.balance.toString())}
                    </Td>
                  </Tr>
                ))}
                {clientDebts.length === 0 && (
                  <Tr>
                    <Td colSpan={3} className="py-6 text-center text-neutral-400">
                      Задолженностей нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  warn,
  danger,
  hint,
  note,
  href,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  warn?: boolean;
  danger?: boolean;
  hint?: string;
  note?: string;
  href?: string;
}) {
  const body = (
    <div
      title={hint}
      className={`h-full rounded-lg border bg-white p-4 ${danger ? "border-red-300" : "border-neutral-200"} ${href ? "transition-colors hover:bg-neutral-50" : ""}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 break-words text-lg font-semibold sm:text-xl ${danger ? "text-red-600" : warn ? "text-amber-600" : "text-neutral-900"}`}
      >
        {value}
      </div>
      {(note ?? hint) && <div className="mt-1 text-xs text-neutral-400">{note ?? hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
