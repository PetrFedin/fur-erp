import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { UsageForm, type LotOption } from "./usage-form";
import { ProductionExpenseForm } from "./expense-form";
import { ApplyBomButton, CompleteOrderForm, CancelOrderButton } from "./order-actions";
import { RetailPriceForm } from "./retail-price-form";
import { ProductionPaymentForm } from "./payment-form";
import { removeMaterialUsage, removeProductionExpense, removeProductionPayment } from "../actions";

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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "Банк. перевод",
  CASH: "Наличные",
  CARD: "Карта",
  OTHER: "Другое",
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
      client: true,
      materialUsages: { include: { rawMaterial: true, lot: true }, orderBy: { date: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!order) notFound();

  const open = order.status === "PLANNED" || order.status === "IN_PROGRESS";

  const [availableLots, expenseCategories] = open
    ? await Promise.all([
        prisma.rawMaterialLot.findMany({
          where: {
            organizationId: session.user.organizationId,
            warehouseId: order.rawWarehouseId,
            quantityRemaining: { gt: 0 },
          },
          include: { rawMaterial: true },
          orderBy: { receivedDate: "asc" },
        }),
        prisma.expenseCategory.findMany({
          where: { organizationId: session.user.organizationId, kind: "PRODUCTION", isActive: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  const lotOptions: LotOption[] = availableLots.map((l) => ({
    id: l.id,
    lotNumber: l.lotNumber,
    grade: l.grade,
    color: l.color,
    rawMaterialId: l.rawMaterialId,
    rawMaterialName: l.rawMaterial.name,
    unit: l.rawMaterial.unit,
    quantityRemaining: l.quantityRemaining.toString(),
    unitCost: l.unitCost.toString(),
  }));

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const projectedTotal = materialCost.add(expenseCost);
  const status = STATUS_LABELS[order.status];

  const producedOrPlanned = order.producedQuantity.greaterThan(0) ? order.producedQuantity : order.plannedQuantity;
  const clientRevenue = order.clientWorkPricePerUnit
    ? order.clientWorkPricePerUnit.mul(producedOrPlanned)
    : null;

  // unitCost is fixed once the order completes; while in progress, estimate
  // from costs booked so far so retail pricing can be planned ahead of time.
  const estimatedUnitCost = order.unitCost ?? (producedOrPlanned.isZero() ? new Decimal(0) : projectedTotal.div(producedOrPlanned));
  const markup =
    order.retailPrice && estimatedUnitCost.greaterThan(0) ? order.retailPrice.div(estimatedUnitCost) : null;

  const boundRemoveUsage = removeMaterialUsage.bind(null, id);
  const boundRemoveExpense = removeProductionExpense.bind(null, id);
  const boundRemovePayment = removeProductionPayment.bind(null, id);

  const paidTotal = order.payments.reduce((s, p) => s.add(p.amount), new Decimal(0));
  const balanceDue = clientRevenue ? clientRevenue.sub(paidTotal) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Заказ {order.number}</h1>
          <p className="text-sm text-neutral-500">
            {order.productModel.name}
            {order.color && ` · ${order.color}`}
            {order.size && ` · разм. ${order.size}`} · план {formatQty(order.plannedQuantity.toString())} шт. ·{" "}
            {order.startDate ? formatDate(order.startDate) : "—"}
          </p>
          {(order.materialDescription || order.lining) && (
            <p className="text-sm text-neutral-500">
              {order.materialDescription && `Материал: ${order.materialDescription}`}
              {order.lining && ` · Подкладка: ${order.lining}`}
            </p>
          )}
          {order.client && (
            <p className="mt-1 text-sm text-neutral-500">
              Заказчик: <span className="font-medium text-neutral-700">{order.client.name}</span>
              {order.contractNumber && ` · Договор ${order.contractNumber}`}
              {order.workOrderNumber && ` · ТЗ № ${order.workOrderNumber}`}
              {order.workOrderDate && ` от ${formatDate(order.workOrderDate)}`}
            </p>
          )}
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

      {clientRevenue && (
        <div className="grid grid-cols-4 gap-3">
          <SummaryCard
            label="Стоимость работ для заказчика"
            value={formatMoney(clientRevenue.toString())}
          />
          <SummaryCard label="Себестоимость" value={formatMoney(projectedTotal.toString())} />
          <SummaryCard
            label="Стоимость продукции за ед."
            value={
              producedOrPlanned.greaterThan(0)
                ? formatMoney(clientRevenue.add(materialCost).div(producedOrPlanned).toString())
                : "—"
            }
          />
          <SummaryCard
            label="Маржа"
            value={formatMoney(clientRevenue.sub(projectedTotal).toString())}
            warn={clientRevenue.sub(projectedTotal).lessThan(0)}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Розничная цена и маркап</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RetailPriceForm orderId={id} retailPrice={order.retailPrice?.toString() ?? ""} />
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard
              label={order.unitCost ? "Себестоимость за ед." : "Себестоимость за ед. (оценка)"}
              value={formatMoney(estimatedUnitCost.toString())}
            />
            <SummaryCard
              label="Розничная цена"
              value={order.retailPrice ? formatMoney(order.retailPrice.toString()) : "—"}
            />
            <SummaryCard label="Маркап" value={markup ? `×${markup.toFixed(2)}` : "—"} emphasis />
          </div>
        </CardContent>
      </Card>

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
              <UsageForm orderId={id} lots={lotOptions} />
            </div>
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Сырьё</Th>
                <Th>Лот</Th>
                <Th>Кол-во</Th>
                <Th>Цена лота без НДС</Th>
                <Th>НДС</Th>
                <Th>Себестоимость (с расходами закупки)</Th>
                {open && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {order.materialUsages.map((u) => (
                <Tr key={u.id}>
                  <Td>{formatDate(u.date)}</Td>
                  <Td>{u.rawMaterial.name}</Td>
                  <Td>{u.lot.lotNumber ?? "без номера"}</Td>
                  <Td>
                    {formatQty(u.quantity.toString())} {UNIT_LABELS[u.rawMaterial.unit]}
                  </Td>
                  <Td>{formatMoney(u.lot.materialCostExclVat.toString())}</Td>
                  <Td>{u.lot.vatRate.toString()}%</Td>
                  <Td className="font-medium">{formatMoney(u.totalCost.toString())}</Td>
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
                  <Td colSpan={8} className="py-6 text-center text-neutral-400">
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

      {order.client && (
        <Card>
          <CardHeader>
            <CardTitle>Оплаты от заказчика</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ProductionPaymentForm orderId={id} />
            {clientRevenue && (
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard label="Стоимость работ" value={formatMoney(clientRevenue.toString())} />
                <SummaryCard label="Оплачено" value={formatMoney(paidTotal.toString())} />
                <SummaryCard
                  label="Остаток к оплате"
                  value={formatMoney(balanceDue!.toString())}
                  warn={balanceDue!.greaterThan(0)}
                  emphasis
                />
              </div>
            )}
            <Table>
              <Thead>
                <Tr>
                  <Th>Дата</Th>
                  <Th>Сумма</Th>
                  <Th>Способ</Th>
                  <Th>Заметка</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {order.payments.map((p) => (
                  <Tr key={p.id}>
                    <Td>{formatDate(p.paidAt)}</Td>
                    <Td className="font-medium">{formatMoney(p.amount.toString())}</Td>
                    <Td>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</Td>
                    <Td>{p.notes ?? "—"}</Td>
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemovePayment(p.id);
                        }}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          Удалить
                        </Button>
                      </form>
                    </Td>
                  </Tr>
                ))}
                {order.payments.length === 0 && (
                  <Tr>
                    <Td colSpan={5} className="py-6 text-center text-neutral-400">
                      Оплат пока нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

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

function SummaryCard({
  label,
  value,
  emphasis,
  warn,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${warn ? "text-amber-600" : emphasis ? "text-neutral-900" : "text-neutral-700"}`}
      >
        {value}
      </div>
    </div>
  );
}
