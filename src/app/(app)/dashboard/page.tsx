import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { MonthlyPurchasesChart } from "./charts";

const MONTH_NAMES = [
  "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек",
];

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

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    finishedStock,
    recentPurchases,
    allPurchases,
    completedOrders,
    openPurchasesWithPayments,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    articleCount,
    clientOrders,
    clientPayments,
  ] = await Promise.all([
    prisma.finishedGoodsStock.findMany({ where: { organizationId } }),
    prisma.purchase.findMany({
      where: { organizationId, orderDate: { gte: sixMonthsAgo } },
      include: { items: true, expenses: true },
    }),
    prisma.purchase.findMany({
      where: { organizationId },
      include: { items: true, expenses: true },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId, status: "COMPLETED" },
      include: { productModel: true },
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
    prisma.productionMaterialUsage.aggregate({
      where: { productionOrder: { organizationId } },
      _sum: { totalCost: true },
    }),
    prisma.productModel.count({ where: { organizationId } }),
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
  const finishedStockValue = finishedStock.reduce((s, r) => s.add(r.quantity.mul(r.avgUnitCost)), new Decimal(0));

  // Monthly purchases (last 6 months)
  const monthBuckets: { month: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    monthBuckets.push({ month: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, total: 0 });
  }
  for (const p of recentPurchases) {
    const total = purchaseTotalInclVat(p).toNumber();
    const d = new Date(p.orderDate);
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    const bucket = monthBuckets.find((b) => b.month === label);
    if (bucket) bucket.total += total;
  }

  // Supplier balance due
  const supplierBalances = openPurchasesWithPayments
    .map((p) => {
      const total = purchaseTotalInclVat(p);
      const paid = p.payments.reduce((s, pay) => s.add(pay.amount), new Decimal(0));
      return { supplier: p.supplier.name, purchaseNumber: p.number, due: total.sub(paid) };
    })
    .filter((x) => x.due.greaterThan(0))
    .sort((a, b) => (b.due.greaterThan(a.due) ? 1 : -1))
    .slice(0, 5);

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
    };
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
  const clientDebtUnpricedTotal = clientDebts.reduce((s, c) => s + c.unpricedOrders, 0);

  // Low stock: sum remaining quantity per material across lots/warehouses, compare to the threshold.
  const materialTotals = new Map<string, { name: string; quantity: Decimal; minStockLevel: Decimal | null }>();
  for (const lot of lowStockMaterials) {
    const entry = materialTotals.get(lot.rawMaterialId) ?? {
      name: lot.rawMaterial.name,
      quantity: new Decimal(0),
      minStockLevel: lot.rawMaterial.minStockLevel,
    };
    entry.quantity = entry.quantity.add(lot.quantityRemaining);
    materialTotals.set(lot.rawMaterialId, entry);
  }
  const lowStock = Array.from(materialTotals.entries())
    .map(([id, v]) => ({ id, ...v }))
    .filter((m) => m.minStockLevel && m.quantity.lessThan(m.minStockLevel));

  // Lifetime raw material purchased/used/remaining, by material (used = purchased - remaining).
  type MaterialFlow = {
    id: string;
    name: string;
    unit: string;
    purchased: Decimal;
    remaining: Decimal;
    remainingValue: Decimal;
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
    }
  }
  const materialFlowRows = Array.from(materialFlowMap.values()).filter(
    (r) => r.purchased.greaterThan(0) || r.remaining.greaterThan(0)
  );
  const unusedMaterials = materialFlowRows.filter((r) => r.remaining.greaterThan(0));

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalMaterialUsedValue = new Decimal(materialUsedAgg._sum.totalCost ?? 0);
  const totalProducedQty = completedOrders.reduce((s, o) => s.add(o.producedQuantity), new Decimal(0));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Дашборд</h1>

      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Стоимость остатков сырья" value={formatMoney(rawStockValue.toString())} />
        <KpiCard label="Стоимость готовой продукции" value={formatMoney(finishedStockValue.toString())} />
        <KpiCard
          label="Закупок за 6 мес."
          value={formatMoney(
            recentPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0)).toString()
          )}
        />
        <KpiCard label="Долг поставщикам" value={formatMoney(supplierBalances.reduce((s, x) => s.add(x.due), new Decimal(0)).toString())} warn={supplierBalances.length > 0} />
      </div>

      <div className="grid grid-cols-5 gap-3">
        <KpiCard label="Артикулов (моделей)" value={String(articleCount)} />
        <KpiCard label="Сырья закуплено, всего" value={formatMoney(totalPurchasedValue.toString())} />
        <KpiCard label="Сырья использовано в производстве" value={formatMoney(totalMaterialUsedValue.toString())} />
        <KpiCard label="Товара выпущено" value={`${formatQty(totalProducedQty.toString())} шт.`} />
        <KpiCard
          label="Долг заказчиков"
          value={formatMoney(clientDebtTotal.toString())}
          warn={clientDebtTotal.greaterThan(0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сырьё: куплено / использовано / остаток по материалам</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Куплено всего</Th>
                <Th>Использовано</Th>
                <Th>Остаток (не использовано)</Th>
                <Th>Стоимость остатка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {materialFlowRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>
                    {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>
                    {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td className={r.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>
                    {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>{formatMoney(r.remainingValue.toString())}</Td>
                </Tr>
              ))}
              {materialFlowRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Сырьё ещё не закупалось
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          {unusedMaterials.length > 0 && (
            <p className="mt-3 text-sm text-neutral-500">
              Не использовано ({unusedMaterials.length}):{" "}
              {unusedMaterials.map((m) => m.name).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Закупки по месяцам</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyPurchasesChart data={monthBuckets} />
        </CardContent>
      </Card>

      {clientDebts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Задолженность заказчиков</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Заказчик</Th>
                  <Th>К оплате (за выполненную/план. работу)</Th>
                  <Th>Оплачено</Th>
                  <Th>Остаток</Th>
                </Tr>
              </Thead>
              <Tbody>
                {clientDebts.map((c) => (
                  <Tr key={c.clientId}>
                    <Td>
                      {c.clientName}
                      {c.unpricedOrders > 0 && (
                        <span className="ml-1 text-xs text-neutral-400">
                          ({c.unpricedOrders} ТЗ без цены работ — не учтены)
                        </span>
                      )}
                    </Td>
                    <Td>{formatMoney(c.billable.toString())}</Td>
                    <Td>{formatMoney(c.paid.toString())}</Td>
                    <Td className={c.balance.greaterThan(0) ? "text-amber-600" : ""}>
                      {formatMoney(c.balance.toString())}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            {clientDebtUnpricedTotal > 0 && (
              <p className="mt-3 text-sm text-neutral-500">
                Всего ТЗ без указанной стоимости работ (не входят в расчёт): {clientDebtUnpricedTotal}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Задолженность поставщикам</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Поставщик</Th>
                  <Th>Закупка</Th>
                  <Th>Долг</Th>
                </Tr>
              </Thead>
              <Tbody>
                {supplierBalances.map((s, i) => (
                  <Tr key={i}>
                    <Td>{s.supplier}</Td>
                    <Td>{s.purchaseNumber}</Td>
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Низкие остатки сырья</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Сырьё</Th>
                  <Th>Остаток</Th>
                  <Th>Мин.</Th>
                </Tr>
              </Thead>
              <Tbody>
                {lowStock.map((m) => (
                  <Tr key={m.id}>
                    <Td>
                      <Link href="/lots" className="hover:underline">
                        {m.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge variant="danger">{formatQty(m.quantity.toString())}</Badge>
                    </Td>
                    <Td>{formatQty(m.minStockLevel?.toString() ?? "0")}</Td>
                  </Tr>
                ))}
                {lowStock.length === 0 && (
                  <Tr>
                    <Td colSpan={3} className="py-6 text-center text-neutral-400">
                      Все остатки в норме
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

function KpiCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? "text-amber-600" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}
