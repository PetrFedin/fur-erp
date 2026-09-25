import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { MonthlyPurchasesChart, ExpenseBreakdownChart, ModelCostChart } from "./charts";

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
    purchaseExpensesByCategory,
    productionExpensesByCategory,
    completedOrders,
    openPurchasesWithPayments,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    articleCount,
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
    prisma.purchaseExpense.groupBy({
      by: ["categoryId"],
      where: { purchase: { organizationId } },
      _sum: { amount: true },
    }),
    prisma.productionExpense.groupBy({
      by: ["categoryId"],
      where: { productionOrder: { organizationId } },
      _sum: { amount: true },
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

  // Expense breakdown by category (purchase + production combined)
  const categoryIds = [
    ...purchaseExpensesByCategory.map((c) => c.categoryId),
    ...productionExpensesByCategory.map((c) => c.categoryId),
  ];
  const categories = await prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } } });
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const expenseTotals = new Map<string, number>();
  for (const row of purchaseExpensesByCategory) {
    const name = categoryMap.get(row.categoryId) ?? "—";
    expenseTotals.set(name, (expenseTotals.get(name) ?? 0) + Number(row._sum.amount ?? 0));
  }
  for (const row of productionExpensesByCategory) {
    const name = categoryMap.get(row.categoryId) ?? "—";
    expenseTotals.set(name, (expenseTotals.get(name) ?? 0) + Number(row._sum.amount ?? 0));
  }
  const expenseBreakdown = Array.from(expenseTotals.entries()).map(([name, value]) => ({ name, value }));

  // Model unit cost (average across completed orders)
  const modelCostMap = new Map<string, { total: number; count: number }>();
  for (const o of completedOrders) {
    if (!o.unitCost) continue;
    const entry = modelCostMap.get(o.productModel.name) ?? { total: 0, count: 0 };
    entry.total += Number(o.unitCost);
    entry.count += 1;
    modelCostMap.set(o.productModel.name, entry);
  }
  const modelCosts = Array.from(modelCostMap.entries()).map(([name, { total, count }]) => ({
    name,
    unitCost: Math.round(total / count),
  }));

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

      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Артикулов (моделей)" value={String(articleCount)} />
        <KpiCard label="Сырья закуплено, всего" value={formatMoney(totalPurchasedValue.toString())} />
        <KpiCard label="Сырья использовано в производстве" value={formatMoney(totalMaterialUsedValue.toString())} />
        <KpiCard label="Товара выпущено" value={`${formatQty(totalProducedQty.toString())} шт.`} />
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

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Закупки по месяцам</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyPurchasesChart data={monthBuckets} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Структура расходов по статьям</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseBreakdownChart data={expenseBreakdown} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Себестоимость за единицу по моделям</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelCostChart data={modelCosts} />
        </CardContent>
      </Card>

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
