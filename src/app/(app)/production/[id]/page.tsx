import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { UsageForm } from "./usage-form";
import { ProductionExpenseForm } from "./expense-form";
import { ApplyBomButton, CompleteOrderForm, CancelOrderButton } from "./order-actions";
import { removeMaterialUsage, removeProductionExpense } from "../actions";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function ProductionOrderPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const session = await requireSession();

  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      productModel: { include: { materials: { include: { rawMaterial: true } } } },
      rawWarehouse: true,
      finishedWarehouse: true,
      materialUsages: { include: { rawMaterial: true }, orderBy: { date: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
    },
  });
  if (!order) notFound();

  const open = order.status === "PLANNED" || order.status === "IN_PROGRESS";

  const [materials, expenseCategories] = open
    ? await Promise.all([
        prisma.rawMaterial.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          orderBy: { name: "asc" },
        }),
        prisma.expenseCategory.findMany({
          where: { organizationId: session.user.organizationId, kind: "PRODUCTION", isActive: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const projectedTotal = materialCost.add(expenseCost);
  const status = STATUS_LABELS[order.status];

  const boundRemoveUsage = removeMaterialUsage.bind(null, id);
  const boundRemoveExpense = removeProductionExpense.bind(null, id);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Заказ {order.number}</h1>
          <p className="text-sm text-neutral-500">
            {order.productModel.name} · план {formatQty(order.plannedQuantity.toString())} шт. ·{" "}
            {order.startDate ? formatDate(order.startDate) : "—"}
          </p>
          <div className="mt-2">
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>
        {order.status === "PLANNED" && order.materialUsages.length === 0 && (
          <CancelOrderButton orderId={id} />
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Стоимость сырья" value={formatMoney(materialCost.toString())} />
        <SummaryCard label="Произв. расходы" value={formatMoney(expenseCost.toString())} />
        <SummaryCard label="Итого себестоимость" value={formatMoney(projectedTotal.toString())} emphasis />
        <SummaryCard
          label="Факт. произведено"
          value={`${formatQty(order.producedQuantity.toString())} шт.`}
        />
      </div>

      {order.productModel.materials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Норма расхода по модели (BOM)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Сырьё</Th>
                  <Th>Норма на 1 изд.</Th>
                  <Th>Требуется на план ({formatQty(order.plannedQuantity.toString())} шт.)</Th>
                </Tr>
              </Thead>
              <Tbody>
                {order.productModel.materials.map((line) => (
                  <Tr key={line.id}>
                    <Td>{line.rawMaterial.name}</Td>
                    <Td>
                      {formatQty(line.quantityPerUnit.toString())} {UNIT_LABELS[line.rawMaterial.unit]}
                    </Td>
                    <Td>
                      {formatQty(line.quantityPerUnit.mul(order.plannedQuantity).toString())}{" "}
                      {UNIT_LABELS[line.rawMaterial.unit]}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Списание сырья в производство</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {open && (
            <div className="flex flex-col gap-3">
              <ApplyBomButton orderId={id} />
              <UsageForm orderId={id} materials={materials} />
            </div>
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Сырьё</Th>
                <Th>Количество</Th>
                <Th>Себестоимость</Th>
                {open && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {order.materialUsages.map((u) => (
                <Tr key={u.id}>
                  <Td>{formatDate(u.date)}</Td>
                  <Td>{u.rawMaterial.name}</Td>
                  <Td>
                    {formatQty(u.quantity.toString())} {UNIT_LABELS[u.rawMaterial.unit]}
                  </Td>
                  <Td>{formatMoney(u.totalCost.toString())}</Td>
                  {open && (
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemoveUsage(u.id);
                        }}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          Отменить
                        </Button>
                      </form>
                    </Td>
                  )}
                </Tr>
              ))}
              {order.materialUsages.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Сырьё ещё не списано
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Производственные расходы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {open && <ProductionExpenseForm orderId={id} categories={expenseCategories} />}
          <Table>
            <Thead>
              <Tr>
                <Th>Статья</Th>
                <Th>Описание</Th>
                <Th>Сумма</Th>
                {open && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {order.expenses.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.category.name}</Td>
                  <Td>{e.description ?? "—"}</Td>
                  <Td>{formatMoney(e.amount.toString())}</Td>
                  {open && (
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemoveExpense(e.id);
                        }}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          Удалить
                        </Button>
                      </form>
                    </Td>
                  )}
                </Tr>
              ))}
              {order.expenses.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="py-6 text-center text-neutral-400">
                    Расходов пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>Завершить заказ</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-neutral-500">
              При завершении себестоимость фиксируется, а готовая продукция поступает на склад «
              {order.finishedWarehouse.name}» по себестоимости за единицу.
            </p>
            <CompleteOrderForm orderId={id} plannedQuantity={order.plannedQuantity.toString()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${emphasis ? "text-neutral-900" : "text-neutral-700"}`}>
        {value}
      </div>
    </div>
  );
}
