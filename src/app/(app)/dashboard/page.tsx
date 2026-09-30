import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, lotUnitCostExclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function DashboardPage() {
  const session = await requireSession();
  const organizationId = session.user.organizationId;

  const [
    allPurchases,
    openPurchasesWithPayments,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    clientOrders,
    clientPayments,
  ] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId },
      include: { items: true, expenses: true },
    }),
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: { items: true, expenses: true, payments: true, supplier: true },
    }),
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
      select: { quantity: true, totalCost: true, lot: { select: { materialCostExclVat: true, expenseCostExclVat: true } } },
    }),
    // ТЗ производства под заказчика (давальческая схема) — заказы без
    // clientId — это собственное производство, не подлежит взысканию.
    prisma.productionOrder.findMany({
      where: { organizationId, clientId: { not: null }, status: { not: "CANCELLED" } },
      include: { client: true },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId, clientId: { not: null } },
    }),
  ]);

  // Raw + finished stock value
  const rawStockValue = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(l.unitCost)),
    new Decimal(0)
  );
  const rawStockValueExclVat = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(lotUnitCostExclVat(l))),
    new Decimal(0)
  );
  // Supplier balance due: per purchase (real amounts, not affected by the VAT toggle),
  // then one row per supplier (sum of debt + number of purchases with debt).
  const supplierMap = new Map<string, { supplier: string; due: Decimal; purchases: number }>();
  for (const p of openPurchasesWithPayments) {
    const paid = p.payments.reduce((s, pay) => s.add(pay.amount), new Decimal(0));
    const due = purchaseTotalInclVat(p).sub(paid);
    if (!due.greaterThan(0)) continue;
    const e = supplierMap.get(p.supplierId) ?? { supplier: p.supplier.name, due: new Decimal(0), purchases: 0 };
    e.due = e.due.add(due);
    e.purchases += 1;
    supplierMap.set(p.supplierId, e);
  }
  const supplierBalances = Array.from(supplierMap.values()).sort((a, b) => (b.due.greaterThan(a.due) ? 1 : -1));
  const supplierDebtTotal = supplierBalances.reduce((s, x) => s.add(x.due), new Decimal(0));

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
  for (const p of clientPayments) {
    if (!p.clientId) continue;
    const entry = clientDebtMap.get(p.clientId);
    if (entry) entry.paid = entry.paid.add(p.amount);
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
  // Скрываем строки, где и остаток, и его стоимость нулевые (полностью израсходованная подкладка);
  // информация не теряется: сырьё по-прежнему в разделе «Сырьё», ссылка «Подкладка →» под таблицей.
  const visibleMaterialRows = materialFlowRows.filter(
    (r) => !(r.remaining.isZero() && r.remainingValue.isZero())
  );
  const hiddenMaterialRows = materialFlowRows.length - visibleMaterialRows.length;

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalPurchasedValueExclVat = allPurchases.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));
  const totalMaterialUsedValue = materialUsedAgg.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const totalMaterialUsedValueExclVat = materialUsedAgg.reduce(
    (s, u) => s.add(u.quantity.mul(lotUnitCostExclVat(u.lot))),
    new Decimal(0)
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Сводка</h1>

      <div className="grid grid-cols-5 gap-3">
        <KpiCard label="Куплено сырья" value={<Money incl={totalPurchasedValue} excl={totalPurchasedValueExclVat} />} />
        <KpiCard
          label="Использовано в ТЗ"
          value={<Money incl={totalMaterialUsedValue} excl={totalMaterialUsedValueExclVat} />}
        />
        <KpiCard label="Остаток сырья (в деньгах)" value={<Money incl={rawStockValue} excl={rawStockValueExclVat} />} />
        <KpiCard label="Долг поставщикам" value={formatMoney(supplierDebtTotal.toString())} warn={supplierDebtTotal.greaterThan(0)} />
        <KpiCard label="Долг заказчиков" value={formatMoney(clientDebtTotal.toString())} warn={clientDebtTotal.greaterThan(0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сырьё по материалам</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Куплено</Th>
                <Th>Использовано</Th>
                <Th>Остаток</Th>
                <Th>Стоимость остатка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {visibleMaterialRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">
                    <Link href={r.unit === "M" ? "/lots?tab=lining" : "/lots"} className="hover:underline">
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
              {visibleMaterialRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Сырьё ещё не закупалось
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <p className="mt-3 flex gap-4 text-sm">
            <Link href="/lots" className="text-neutral-600 hover:underline">
              Мех →
            </Link>
            <Link href="/lots?tab=lining" className="text-neutral-600 hover:underline">
              Подкладка →
            </Link>
            {hiddenMaterialRows > 0 && (
              <span className="text-neutral-400">
                Скрыто строк с нулевым остатком: {hiddenMaterialRows}
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Долг поставщикам</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Поставщик</Th>
                  <Th>Закупок</Th>
                  <Th>Долг</Th>
                </Tr>
              </Thead>
              <Tbody>
                {supplierBalances.map((s) => (
                  <Tr key={s.supplier}>
                    <Td>{s.supplier}</Td>
                    <Td>{s.purchases}</Td>
                    <Td className="text-amber-600">{formatMoney(s.due.toString())}</Td>
                  </Tr>
                ))}
                {supplierBalances.length === 0 && (
                  <Tr>
                    <Td colSpan={3} className="py-6 text-center text-neutral-400">
                      Задолженностей нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
            <p className="mt-3 text-sm">
              <Link href="/purchases" className="text-neutral-600 hover:underline">
                Все закупки →
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Долг заказчиков</CardTitle>
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

function KpiCard({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? "text-amber-600" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}
