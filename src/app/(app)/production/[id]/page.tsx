import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { materialCostExclVat, lotUnitCostExclVat } from "@/lib/purchase-totals";
import { UsageForm, type LotOption } from "./usage-form";
import { BulkUsageForm } from "./bulk-usage-form";
import { ProductionExpenseForm } from "./expense-form";
import { ApplyBomButton, CompleteOrderForm, CancelOrderButton } from "./order-actions";
import { RetailPriceForm } from "./retail-price-form";
import { ProductionPaymentForm } from "./payment-form";
import { OpenDetailsLink } from "./open-details-link";
import { ProducedQuantityForm } from "./produced-quantity-form";
import { UsageRow, type EditableLotOption } from "./usage-row";
import { ExpenseRow } from "./expense-row";
import { OrderEditForm } from "./order-edit-form";
import {
  removeMaterialUsage,
  removeProductionExpense,
  removeProductionPayment,
  updateMaterialUsage,
  updateProductionExpense,
  updateProductionOrder,
} from "../actions";

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

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Окончательная",
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
      paymentAllocations: {
        include: { productionPayment: { include: { orders: { include: { productionOrder: true } } } } },
        orderBy: { productionPayment: { paidAt: "asc" } },
      },
    },
  });
  if (!order) notFound();

  const payments = order.paymentAllocations.map((a) => a.productionPayment);

  // All ТЗ of this client (incl. the current one) for the payment form:
  // "К оплате" / "оплачено" per ТЗ follow the same rule as this page — work
  // price x quantity (produced, else planned) and the gross amount of every
  // payment touching the ТЗ (shared payments are not split per ТЗ).
  const clientOrders = order.clientId
    ? await prisma.productionOrder.findMany({
        where: { clientId: order.clientId, organizationId: session.user.organizationId },
        select: {
          id: true,
          number: true,
          workOrderNumber: true,
          plannedQuantity: true,
          producedQuantity: true,
          clientWorkPricePerUnit: true,
          paymentAllocations: { select: { productionPayment: { select: { amount: true } } } },
        },
      })
    : [];
  const paymentOrders = clientOrders
    .map((o) => {
      const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
      const due = o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.mul(qty) : null;
      const paid = o.paymentAllocations.reduce((sum, a) => sum.add(a.productionPayment.amount), new Decimal(0));
      return {
        id: o.id,
        label: o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`,
        sortKey: o.workOrderNumber ?? o.number,
        due: due ? due.toFixed(2) : null,
        paid: paid.toFixed(2),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ru", { numeric: true }))
    .map((o) => ({ id: o.id, label: o.label, due: o.due, paid: o.paid }));

  const open = order.status === "PLANNED" || order.status === "IN_PROGRESS";

  // Material usage / expenses stay editable regardless of status (fixing a
  // mistake in a COMPLETED order is normal, not exceptional — see
  // syncCompletedOrderCost in actions.ts), so these are always fetched.
  // allLots (unfiltered by quantityRemaining) feeds the usage-edit lot
  // picker only: a usage's own current lot is very often fully consumed by
  // that very usage, so it must still show up pre-selected in the edit
  // dropdown even though it has nothing left for the add-usage picker
  // (availableLots below, unchanged).
  const [availableLots, allLots, expenseCategories, models, warehouses, clients] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: {
        organizationId: session.user.organizationId,
        warehouseId: order.rawWarehouseId,
        quantityRemaining: { gt: 0 },
      },
      include: { rawMaterial: true },
      orderBy: { receivedDate: "asc" },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, warehouseId: order.rawWarehouseId },
      include: { rawMaterial: true },
      orderBy: { receivedDate: "asc" },
    }),
    prisma.expenseCategory.findMany({
      where: { organizationId: session.user.organizationId, kind: "PRODUCTION", isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.productModel.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // The order's current model/warehouses might have been deactivated since
  // creation (isActive: false) — the active-only lists above wouldn't offer
  // them as options, which would silently swap the selection on save. Add
  // them back in explicitly so the edit form always includes the order's
  // current values.
  const modelOptions = models.some((m) => m.id === order.productModelId)
    ? models
    : [{ id: order.productModelId, name: order.productModel.name }, ...models];
  const clientOptions =
    order.clientId && !clients.some((c) => c.id === order.clientId)
      ? [{ id: order.client!.id, name: order.client!.name }, ...clients]
      : clients;

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

  const allLotOptions: EditableLotOption[] = allLots.map((l) => ({
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

  const furLots = lotOptions.filter((l) => l.unit !== "M");
  const liningLots = lotOptions.filter((l) => l.unit === "M");
  const allFurLots = allLotOptions.filter((l) => l.unit !== "M");
  const allLiningLots = allLotOptions.filter((l) => l.unit === "M");
  const furUsages = order.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
  const liningUsages = order.materialUsages.filter((u) => u.rawMaterial.unit === "M");

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  // materialUsages.totalCost = quantity * lot.unitCost, and lot.unitCost is
  // VAT-inclusive by definition (see schema) — so materialCost above is
  // incl-VAT. Its excl-VAT counterpart uses the same lines' own excl-VAT lot
  // cost (materialCostExclVat + expenseCostExclVat, exact per the schema
  // comment on the latter). expenseCost has no excl-VAT counterpart:
  // ProductionExpense has no vatRate field at all (no VAT tracked for
  // production expenses in this schema) — shown the same in both modes.
  const materialCostExcl = materialCostExclVat(order.materialUsages);
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const projectedTotal = materialCost.add(expenseCost);
  const projectedTotalExclVat = materialCostExcl.add(expenseCost);
  const status = STATUS_LABELS[order.status];

  const producedOrPlanned = order.producedQuantity.greaterThan(0) ? order.producedQuantity : order.plannedQuantity;
  const clientRevenue = order.clientWorkPricePerUnit
    ? order.clientWorkPricePerUnit.mul(producedOrPlanned)
    : null;

  // unitCost is fixed once the order completes; while in progress, estimate
  // from costs booked so far so retail pricing can be planned ahead of time.
  const estimatedUnitCost = order.unitCost ?? (producedOrPlanned.isZero() ? new Decimal(0) : projectedTotal.div(producedOrPlanned));
  // No excl-VAT snapshot column exists for unitCost, so this is always
  // computed live from the same lines behind estimatedUnitCost above —
  // exact even once the order is COMPLETED, since materialUsages/expenses
  // are themselves fixed historical records by then.
  const estimatedUnitCostExclVat = producedOrPlanned.isZero() ? new Decimal(0) : projectedTotalExclVat.div(producedOrPlanned);
  const markup =
    order.retailPrice && estimatedUnitCost.greaterThan(0) ? order.retailPrice.div(estimatedUnitCost) : null;

  const boundRemoveUsage = removeMaterialUsage.bind(null, id);
  const boundRemoveExpense = removeProductionExpense.bind(null, id);
  const boundRemovePayment = removeProductionPayment.bind(null, id);
  const boundUpdateUsage = updateMaterialUsage.bind(null, id);
  const boundUpdateExpense = updateProductionExpense.bind(null, id);
  const boundUpdateOrder = updateProductionOrder.bind(null, id);
  const modelLocked = order.materialUsages.length > 0 || order.producedQuantity.greaterThan(0);

  const paidTotal = payments.reduce((s, p) => s.add(p.amount), new Decimal(0));
  const balanceDue = clientRevenue ? clientRevenue.sub(paidTotal) : null;
  // Some payments may cover this order together with sibling ТЗ for the same
  // client (many-to-many via ProductionPaymentOrder — see payment-form.tsx).
  // "Оплачено" above is deliberately the gross amount of every payment that
  // touches this order, not a proportional split — the codebase has no
  // convention for splitting a shared payment across orders, so inventing
  // one here would just be a different kind of guess. When that's the case,
  // "Остаток к оплате" is flagged as an approximation rather than presented
  // as exact.
  const sharedPayments = payments.filter((p) => p.orders.some((a) => a.productionOrder.id !== id));
  const hasSharedPayments = sharedPayments.length > 0;

  const usageRows = (list: typeof order.materialUsages, lots: EditableLotOption[]) =>
    list.map((u) => (
      <UsageRow
        key={u.id}
        usage={{
          id: u.id,
          date: u.date,
          rawMaterialName: u.rawMaterial.name,
          lotId: u.lotId,
          lotNumber: u.lot.lotNumber,
          quantity: u.quantity.toString(),
          unit: u.rawMaterial.unit,
          lotCostExclVat: u.lot.materialCostExclVat.toString(),
          lotVatRate: u.lot.vatRate.toString(),
          totalCost: u.totalCost.toString(),
          totalCostExclVat: u.quantity.mul(lotUnitCostExclVat(u.lot)).toString(),
          costBreakdown: u.lot.costBreakdown,
          lotUnitCostExcl: lotUnitCostExclVat(u.lot).toString(),
          lotUnitCostIncl: u.lot.unitCost.toString(),
        }}
        lots={lots}
        updateAction={boundUpdateUsage.bind(null, u.id)}
        removeAction={async () => {
          "use server";
          await boundRemoveUsage(u.id);
        }}
      />
    ));

  const furCost = furUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const furCostExcl = materialCostExclVat(furUsages);
  const liningCost = liningUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const liningCostExcl = materialCostExclVat(liningUsages);
  const margin = clientRevenue ? clientRevenue.sub(projectedTotal) : null;
  const canCancel = order.status === "PLANNED" && order.materialUsages.length === 0;
  const qtyLabel =
    order.status === "COMPLETED" || order.producedQuantity.greaterThan(0)
      ? `план ${formatQty(order.plannedQuantity.toString())} / факт ${formatQty(order.producedQuantity.toString())} шт.`
      : `план ${formatQty(order.plannedQuantity.toString())} шт.`;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            {order.workOrderNumber ? `ТЗ №${order.workOrderNumber}` : `Заказ ${order.number}`}
          </h1>
          {order.workOrderNumber && (
            <span className="text-sm text-neutral-500">заказ {order.number}</span>
          )}
          <Badge variant={status.variant}>{status.label}</Badge>
          <div className="ml-auto" />
          <OrderEditForm
            action={boundUpdateOrder}
            models={modelOptions}
            warehouses={warehouses}
            clients={clientOptions}
            modelLocked={modelLocked}
            defaults={{
              productModelId: order.productModelId,
              productModelName: order.productModel.name,
              rawWarehouseId: order.rawWarehouseId,
              finishedWarehouseId: order.finishedWarehouseId,
              plannedQuantity: order.plannedQuantity.toString(),
              color: order.color ?? "",
              size: order.size ?? "",
              materialDescription: order.materialDescription ?? "",
              lining: order.lining ?? "",
              startDate: order.startDate ? order.startDate.toISOString().slice(0, 10) : "",
              notes: order.notes ?? "",
              clientId: order.clientId ?? "",
              contractNumber: order.contractNumber ?? "",
              workOrderNumber: order.workOrderNumber ?? "",
              workOrderDate: order.workOrderDate ? order.workOrderDate.toISOString().slice(0, 10) : "",
              clientWorkPricePerUnit: order.clientWorkPricePerUnit?.toString() ?? "",
            }}
          />
          {open && (
            <CompleteOrderForm
              orderId={id}
              plannedQuantity={order.plannedQuantity.toString()}
              warehouseName={order.finishedWarehouse.name}
            />
          )}
          {canCancel && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100" title="Ещё">
                ⋯
              </summary>
              <div className="absolute right-0 z-10 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow">
                <CancelOrderButton orderId={id} />
              </div>
            </details>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {order.productModel.name}
          {order.color && ` · ${order.color}`}
          {order.size && ` · разм. ${order.size}`} · {qtyLabel}
          {order.startDate && ` · с ${formatDate(order.startDate)}`}
          {order.client && (
            <>
              {" · "}
              <span className="font-medium text-neutral-700">{order.client.name}</span>
              {order.contractNumber && ` · ${order.contractNumber}`}
              {order.workOrderDate && ` от ${formatDate(order.workOrderDate)}`}
            </>
          )}
          {order.materialDescription && ` · Материал: ${order.materialDescription}`}
          {order.lining && ` · Подкладка: ${order.lining}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Расчёт</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <Thead>
              <Tr>
                <Th>Лот</Th>
                <Th>Материал</Th>
                <Th>Кол-во</Th>
                <Th>Цена за ед. без НДС</Th>
                <Th>НДС</Th>
                <Th className="text-right" title="Сумма по лоту с НДС (переключатель НДС меняет отображение)">Сумма с НДС</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              <SectionRow>Мех</SectionRow>
              {usageRows(furUsages, allFurLots)}
              {furUsages.length === 0 && <EmptyRow>Мех ещё не списан</EmptyRow>}
              <TotalRow label="Итого мех" value={<Money incl={furCost} excl={furCostExcl} />} />

              <SectionRow>Подкладка</SectionRow>
              {usageRows(liningUsages, allLiningLots)}
              {liningUsages.length === 0 && (
                <EmptyRow>
                  Подкладка не указана — <OpenDetailsLink targetId="add-lining">добавить</OpenDetailsLink>
                </EmptyRow>
              )}
              <TotalRow label="Итого подкладка" value={<Money incl={liningCost} excl={liningCostExcl} />} />

              <SectionRow>Расходы</SectionRow>
              {order.expenses.map((e) => (
                <ExpenseRow
                  key={e.id}
                  expense={{
                    id: e.id,
                    categoryId: e.categoryId,
                    categoryName: e.category.name,
                    amount: e.amount.toString(),
                    description: e.description,
                  }}
                  categories={expenseCategories}
                  updateAction={boundUpdateExpense.bind(null, e.id)}
                  removeAction={async () => {
                    "use server";
                    await boundRemoveExpense(e.id);
                  }}
                />
              ))}
              <TotalRow label="Итого расходы" value={formatMoney(expenseCost.toString())} />

              <TotalRow
                label="Итого себестоимость"
                value={<Money incl={projectedTotal} excl={projectedTotalExclVat} />}
                strong
              />
              <TotalRow
                label={order.unitCost ? "Себестоимость за единицу" : "Себестоимость за единицу (оценка)"}
                value={<Money incl={estimatedUnitCost} excl={estimatedUnitCostExclVat} />}
                strong
              />
              <SectionRow>Работа для заказчика</SectionRow>
              {clientRevenue && margin ? (
                <>
                  <TotalRow
                    label={`Работы: ${formatMoney(order.clientWorkPricePerUnit!.toString())} × ${formatQty(producedOrPlanned.toString())} шт. =`}
                    value={formatMoney(clientRevenue.toString())}
                  />
                  <TotalRow
                    label="Маржа"
                    title="Работа для заказчика минус себестоимость ТЗ"
                    value={formatMoney(margin.toString())}
                    className={margin.lessThan(0) ? "text-amber-600" : undefined}
                  />
                </>
              ) : (
                <EmptyRow>Цена работы для заказчика не указана</EmptyRow>
              )}
            </Tbody>
          </Table>

          <div className="flex flex-col gap-2 text-sm">
            <details>
              <summary className="cursor-pointer text-neutral-600">+ лот</summary>
              <div className="mt-2">
                <UsageForm orderId={id} lots={furLots} />
              </div>
            </details>
            <BulkUsageForm orderId={id} />
            <details id="add-lining">
              <summary className="cursor-pointer text-neutral-600">+ подкладка</summary>
              <div className="mt-2">
                <UsageForm orderId={id} lots={liningLots} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-neutral-600">+ расход</summary>
              <div className="mt-2">
                <ProductionExpenseForm orderId={id} categories={expenseCategories} />
              </div>
            </details>
            {order.productModel.materials.length > 0 && (
              <details>
                <summary className="cursor-pointer text-neutral-600">Состав модели</summary>
                <div className="mt-2 flex flex-col gap-3">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Материал</Th>
                        <Th>На 1 изделие</Th>
                        <Th>На план ({formatQty(order.plannedQuantity.toString())} шт.)</Th>
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
                  <div>
                    <ApplyBomButton orderId={id} />
                  </div>
                </div>
              </details>
            )}
          </div>

          {order.status === "COMPLETED" && (
            <ProducedQuantityForm orderId={id} producedQuantity={order.producedQuantity.toString()} />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-white p-3">
        <RetailPriceForm orderId={id} retailPrice={order.retailPrice?.toString() ?? ""} />
        <div className="text-sm text-neutral-600">
          Наценка{" "}
          <span className="font-semibold text-neutral-900">{markup ? `×${markup.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      {order.client && (
        <Card>
          <CardHeader>
            <CardTitle>Оплаты от заказчика</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {clientRevenue && (
              <p className="text-sm text-neutral-600">
                К оплате <span className="font-medium text-neutral-900">{formatMoney(clientRevenue.toString())}</span>
                {" · "}
                {hasSharedPayments ? "оплачено (вкл. общие с др. ТЗ) " : "оплачено "}
                <span className="font-medium text-neutral-900">{formatMoney(paidTotal.toString())}</span>
                {" · "}
                {hasSharedPayments ? "остаток к оплате (примерно) " : "остаток к оплате "}
                <span className={`font-semibold ${balanceDue!.greaterThan(0) ? "text-amber-600" : "text-neutral-900"}`}>
                  {formatMoney(balanceDue!.toString())}
                </span>
                {hasSharedPayments && (
                  <span className="block text-xs text-neutral-500">
                    Оплат, общих с другими ТЗ: {sharedPayments.length} — учтены целиком, без разбивки по ТЗ.
                  </span>
                )}
              </p>
            )}
            <ProductionPaymentForm orderId={id} orders={paymentOrders} />
            <Table>
              <Thead>
                <Tr>
                  <Th>Дата</Th>
                  <Th>Тип</Th>
                  <Th>Сумма</Th>
                  <Th>Способ</Th>
                  <Th>Также покрывает</Th>
                  <Th>Заметка</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {payments.map((p) => {
                  const otherOrders = p.orders
                    .map((a) => a.productionOrder)
                    .filter((o) => o.id !== id);
                  return (
                    <Tr key={p.id}>
                      <Td>{formatDate(p.paidAt)}</Td>
                      <Td>{PAYMENT_TYPE_LABELS[p.paymentType] ?? p.paymentType}</Td>
                      <Td className="font-medium">{formatMoney(p.amount.toString())}</Td>
                      <Td>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</Td>
                      <Td>{otherOrders.length > 0 ? otherOrders.map((o) => o.number).join(", ") : "—"}</Td>
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
                  );
                })}
                {payments.length === 0 && <EmptyRow cols={7}>Оплат пока нет</EmptyRow>}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SectionRow({ children }: { children: React.ReactNode }) {
  return (
    <Tr className="bg-neutral-50/80">
      <Td colSpan={7} className="py-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {children}
      </Td>
    </Tr>
  );
}

function EmptyRow({ children, cols = 7 }: { children: React.ReactNode; cols?: number }) {
  return (
    <Tr>
      <Td colSpan={cols} className="py-3 text-center text-neutral-400">
        {children}
      </Td>
    </Tr>
  );
}

function TotalRow({
  label,
  value,
  strong,
  className,
  title,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <Tr title={title} className={`${strong ? "bg-neutral-100 font-semibold" : "font-medium"} ${className ?? ""}`}>
      <Td colSpan={5} className="text-right">
        {label}
      </Td>
      <Td className="text-right">{value}</Td>
      <Td></Td>
    </Tr>
  );
}
