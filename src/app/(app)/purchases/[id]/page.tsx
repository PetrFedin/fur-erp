import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatCurrency, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { PurchaseItemForm } from "./item-form";
import { BulkItemForm } from "./bulk-item-form";
import { PurchaseExpenseForm } from "./expense-form";
import { PurchasePaymentForm } from "./payment-form";
import { PurchaseActions } from "./purchase-actions";
import { ExchangeRateForm } from "./exchange-rate-form";
import { PurchaseEditForm } from "./purchase-edit-form";
import { PurchaseItemRow } from "./item-row";
import { removePurchaseItem, removePurchaseExpense, updatePurchaseItem, updatePurchase, type OrderRef } from "../actions";

// Two states in the UI. ORDERED / IN_TRANSIT rows that already exist in the DB
// are shown (and behave) as a draft; the enum itself is untouched.
function statusView(status: string): { label: string; variant: "default" | "success" | "danger" } {
  if (status === "RECEIVED") return { label: "Принято на склад", variant: "success" };
  if (status === "CANCELLED") return { label: "Отменено", variant: "danger" };
  return { label: "Черновик", variant: "default" };
}

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "Банк. перевод",
  CASH: "Наличные",
  CARD: "Карта",
  OTHER: "Другое",
};

/** Cap for the always-expanded item list; bigger purchases start collapsed. */
const EXPANDED_ITEMS_LIMIT = 25;

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function PurchaseDetailPage({ params }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  const session = await requireSession();

  const purchase = await prisma.purchase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      supplier: true,
      warehouse: true,
      items: { include: { rawMaterial: true, lot: true }, orderBy: { id: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!purchase) notFound();

  const editable = purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED";

  const [materials, expenseCategories, suppliers, warehouses] = editable
    ? await Promise.all([
        prisma.rawMaterial.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          select: { id: true, name: true, unit: true },
          orderBy: { name: "asc" },
        }),
        prisma.expenseCategory.findMany({
          where: { organizationId: session.user.organizationId, kind: "PURCHASE", isActive: true },
          orderBy: { name: "asc" },
        }),
        prisma.supplier.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          orderBy: { name: "asc" },
        }),
        prisma.warehouse.findMany({
          where: { organizationId: session.user.organizationId },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], [], []];

  // The current supplier/warehouse must always be selectable even if it was
  // since deactivated — otherwise the edit form's <select> would silently
  // fall back to whatever option happens to be first, changing the purchase's
  // supplier/warehouse without anyone asking for that.
  const supplierOptions = suppliers.some((s) => s.id === purchase.supplierId)
    ? suppliers
    : [purchase.supplier, ...suppliers];
  const warehouseOptions = warehouses.some((w) => w.id === purchase.warehouseId)
    ? warehouses
    : [purchase.warehouse, ...warehouses];

  const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));

  const isForeignCurrency = purchase.currency !== "RUB";
  const itemsTotal = purchase.items.reduce((s, i) => s.add(i.subtotal), new Decimal(0));
  const itemsTotalExclVatRub = itemsTotal.mul(purchase.exchangeRate);
  const itemsTotalInclVatRub = purchase.items.reduce(
    (s, i) => s.add(grossUp(i.subtotal.mul(purchase.exchangeRate), i.vatRate)),
    new Decimal(0)
  );
  const expensesTotalExclVat = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const expensesTotalInclVat = purchase.expenses.reduce(
    (s, e) => s.add(grossUp(e.amount, e.vatRate)),
    new Decimal(0)
  );
  const grandTotalRub = itemsTotalInclVatRub.add(expensesTotalInclVat);
  const vatTotal = grandTotalRub.sub(itemsTotalExclVatRub).sub(expensesTotalExclVat);
  const paidTotal = purchase.payments.reduce((s, p) => s.add(p.amount), new Decimal(0));
  const balanceDue = grandTotalRub.sub(paidTotal);
  const status = statusView(purchase.status);

  const boundUpdatePurchase = updatePurchase.bind(null, id);
  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundUpdateItem = updatePurchaseItem.bind(null, id);
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);
  // Item rows can be edited even after receipt (cosmetic fields always; qty/
  // price/VAT only while the resulting lot hasn't been consumed yet) — see
  // updatePurchaseItem. Only a cancelled purchase locks items down entirely.
  const itemsMutable = purchase.status !== "CANCELLED";

  const allMaterials = materials;
  const showGradeColor = purchase.items.some((i) => i.grade || i.color);
  const itemColSpan = 6 + (showGradeColor ? 1 : 0) + (itemsMutable ? 1 : 0);

  // Which production orders already drew from each consumed lot — so the
  // "locked" hint and the edit error can name them and link to them.
  const consumedLotIds = purchase.items
    .filter((i) => i.lot && !i.lot.quantityRemaining.equals(i.lot.quantityReceived))
    .map((i) => i.lot!.id);
  const usages = consumedLotIds.length
    ? await prisma.productionMaterialUsage.findMany({
        where: { lotId: { in: consumedLotIds } },
        include: { productionOrder: { select: { id: true, number: true } } },
      })
    : [];
  const ordersByLot = new Map<string, OrderRef[]>();
  for (const u of usages) {
    const list = ordersByLot.get(u.lotId) ?? [];
    const existing = list.find((o) => o.id === u.productionOrderId);
    if (existing) existing.quantity = new Decimal(existing.quantity).add(u.quantity).toString();
    else list.push({ id: u.productionOrder.id, number: u.productionOrder.number, quantity: u.quantity.toString() });
    ordersByLot.set(u.lotId, list);
  }

  const itemsInclVatRub = itemsTotalInclVatRub;
  const totalQty = purchase.items.reduce((s, i) => s.add(i.quantity), new Decimal(0));
  const units = new Set(purchase.items.map((i) => i.rawMaterial.unit));
  const singleUnit = units.size === 1 ? [...units][0] : null;
  const expensePerUnit = singleUnit && totalQty.greaterThan(0) ? expensesTotalInclVat.div(totalQty) : null;
  const expensePct = itemsInclVatRub.greaterThan(0) ? expensesTotalInclVat.div(itemsInclVatRub).mul(100) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Закупка {purchase.number}</h1>
          <p className="text-sm text-neutral-500">
            {purchase.supplier.name} · склад «{purchase.warehouse.name}» · {formatDate(purchase.orderDate)}
            {isForeignCurrency && ` · валюта позиций: ${purchase.currency}`}
          </p>
          {(purchase.auctionSession || purchase.invoiceNumber || purchase.transferDocument) && (
            <p className="text-sm text-neutral-500">
              {purchase.auctionSession && `Аукцион: ${purchase.auctionSession}`}
              {purchase.invoiceNumber && ` · Счёт № ${purchase.invoiceNumber}`}
              {purchase.transferDocument && ` · УПД ${purchase.transferDocument}`}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          {editable && (
            <div className="mt-2 max-w-md">
              <PurchaseEditForm
                action={boundUpdatePurchase}
                suppliers={supplierOptions}
                warehouses={warehouseOptions}
                defaults={{
                  supplierId: purchase.supplierId,
                  warehouseId: purchase.warehouseId,
                  currency: purchase.currency,
                  orderDate: purchase.orderDate.toISOString().slice(0, 10),
                  auctionSession: purchase.auctionSession ?? "",
                  invoiceNumber: purchase.invoiceNumber ?? "",
                  transferDocument: purchase.transferDocument ?? "",
                }}
              />
            </div>
          )}
        </div>
        <PurchaseActions purchaseId={id} status={purchase.status} />
      </div>

      {isForeignCurrency && editable && (
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <p
              className="text-xs text-neutral-500"
              title="Курс применяется при приёме на склад — обновите его перед приёмкой, если он изменился."
            >
              Позиции введены в {purchase.currency}
            </p>
            <ExchangeRateForm
              purchaseId={id}
              currency={purchase.currency}
              exchangeRate={purchase.exchangeRate.toString()}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-5 gap-3">
        <SummaryCard
          label={isForeignCurrency ? `Сырьё, без НДС (${formatCurrency(itemsTotal.toString(), purchase.currency)})` : "Сырьё, без НДС"}
          value={formatMoney(itemsTotalExclVatRub.toString())}
        />
        <SummaryCard label="Доп. расходы, без НДС" value={formatMoney(expensesTotalExclVat.toString())} />
        <SummaryCard label="НДС" value={formatMoney(vatTotal.toString())} />
        <SummaryCard
          label="Итого (RUB)"
          value={<Money incl={grandTotalRub} excl={itemsTotalExclVatRub.add(expensesTotalExclVat)} />}
          emphasis
        />
        <SummaryCard
          label="Остаток к оплате"
          value={formatMoney(balanceDue.toString())}
          warn={balanceDue.greaterThan(0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Позиции ({purchase.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <>
              <details open={purchase.items.length === 0} className="rounded-md border border-neutral-200 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">Вставить позиции из Excel</summary>
                <div className="mt-3">
                  <BulkItemForm
                    purchaseId={id}
                    materialNames={allMaterials.map((m) => m.name)}
                    currency={purchase.currency}
                  />
                </div>
              </details>
              <details className="rounded-md border border-neutral-200 px-3 py-2">
                <summary className="cursor-pointer text-sm text-neutral-600">Добавить одну позицию</summary>
                <div className="mt-3">
                  <PurchaseItemForm purchaseId={id} materials={allMaterials} currency={purchase.currency} />
                </div>
              </details>
            </>
          )}
          <details open={purchase.items.length <= EXPANDED_ITEMS_LIMIT}>
            <summary className="mb-2 cursor-pointer text-sm text-neutral-600">
              {purchase.items.length > EXPANDED_ITEMS_LIMIT
                ? `Список позиций (${purchase.items.length})`
                : "Список позиций"}
            </summary>
            <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th>Лот</Th>
                  {showGradeColor && <Th>Сорт / цвет</Th>}
                  <Th>Кол-во</Th>
                  <Th>Цена без НДС</Th>
                  <Th>НДС</Th>
                  <Th>Сумма{isForeignCurrency && " (RUB)"}</Th>
                  {itemsMutable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.items.map((item) => {
                  const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                  const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                  const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                  const canEditFinancials = editable || (!!item.lot && !consumed);
                  const orders = item.lot ? ordersByLot.get(item.lot.id) : undefined;
                  const lotName = item.lotNumber ? `Лот ${item.lotNumber}` : "Партия без номера";
                  return (
                    <PurchaseItemRow
                      key={item.id}
                      colSpan={itemColSpan}
                      removeAction={
                        editable
                          ? async () => {
                              "use server";
                              await boundRemoveItem(item.id);
                            }
                          : undefined
                      }
                      updateAction={itemsMutable ? boundUpdateItem.bind(null, item.id) : undefined}
                      canEditFinancials={canEditFinancials}
                      lockedNote={
                        item.lot && consumed
                          ? orders && orders.length > 0
                            ? `${lotName} уже списан в ${orders.length > 1 ? "заказы" : "заказ"} (${orders
                                .map((o) => `${o.number}: ${formatQty(o.quantity)} ${UNIT_LABELS[item.rawMaterial.unit]}`)
                                .join(", ")}). Сначала удалите там списание. Здесь доступны только лот, сорт и цвет:`
                            : `${lotName} уже частично израсходован (${formatQty(item.lot.quantityReceived.sub(item.lot.quantityRemaining).toString())} ${UNIT_LABELS[item.rawMaterial.unit]}) — доступны только лот, сорт и цвет`
                          : undefined
                      }
                      lockedOrders={orders}
                      canEditMaterial={editable}
                      materials={allMaterials}
                      currency={purchase.currency}
                      defaults={{
                        rawMaterialId: item.rawMaterialId,
                        rawMaterialName: item.rawMaterial.name,
                        quantity: item.quantity.toString(),
                        unitPrice: item.unitPrice.toString(),
                        vatRate: item.vatRate.toString(),
                        lotNumber: item.lotNumber ?? "",
                        grade: item.grade ?? "",
                        color: item.color ?? "",
                      }}
                    >
                      <Td>{item.rawMaterial.name}</Td>
                      <Td>{item.lotNumber ?? "—"}</Td>
                      {showGradeColor && <Td>{[item.grade, item.color].filter(Boolean).join(" / ") || "—"}</Td>}
                      <Td>
                        {formatQty(item.quantity.toString())} {UNIT_LABELS[item.rawMaterial.unit]}
                      </Td>
                      <Td>{formatCurrency(item.unitPrice.toString(), purchase.currency)}</Td>
                      <Td>{item.vatRate.toString()}%</Td>
                      <Td>
                        <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                        {isForeignCurrency && (
                          <span className="ml-1 text-xs text-neutral-400">
                            ({formatCurrency(item.subtotal.toString(), purchase.currency)} без НДС)
                          </span>
                        )}
                      </Td>
                    </PurchaseItemRow>
                  );
                })}
                {purchase.items.length === 0 && (
                  <Tr>
                    <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-400">
                      Позиций пока нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </details>
          {purchase.items.length > EXPANDED_ITEMS_LIMIT && (
            <p className="text-right text-sm font-medium">
              Итого по закупке ({purchase.items.length} поз.): <Money incl={itemsTotalInclVatRub} excl={itemsTotalExclVatRub} />
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Расходы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <PurchaseExpenseForm purchaseId={id} categories={expenseCategories} />}
          {purchase.expenses.length > 0 && (
            <Table>
              <Thead>
                <Tr>
                  <Th>Статья</Th>
                  <Th>Описание</Th>
                  <Th>Сумма (без НДС)</Th>
                  <Th>НДС</Th>
                  <Th>Сумма</Th>
                  {editable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.expenses.map((e) => (
                  <Tr key={e.id}>
                    <Td>{e.category.name}</Td>
                    <Td>{e.description ?? "—"}</Td>
                    <Td>{formatMoney(e.amount.toString())}</Td>
                    <Td>{e.vatRate.toString()}%</Td>
                    <Td>
                      <Money incl={grossUp(e.amount, e.vatRate)} excl={e.amount} />
                    </Td>
                    {editable && (
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
              </Tbody>
            </Table>
          )}
          {purchase.expenses.length === 0 && <p className="text-sm text-neutral-400">Расходов нет</p>}
          {purchase.expenses.length > 0 && expensesTotalInclVat.greaterThan(0) && (
            <p
              className="text-sm text-neutral-600"
              title="Справочно: при приёме на склад расходы распределяются по позициям пропорционально их сумме."
            >
              Расходы = {formatMoney(expensesTotalInclVat.toString())} (с НДС) → в цену единицы добавится ≈{" "}
              {expensePerUnit
                ? `${formatMoney(expensePerUnit.toFixed(2))} за 1 ${UNIT_LABELS[singleUnit!]}`
                : expensePct
                  ? `+${expensePct.toFixed(1)}% к цене каждой единицы`
                  : "—"}
              {expensePct && expensePerUnit && ` (+${expensePct.toFixed(1)}% к стоимости позиций)`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Оплаты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PurchasePaymentForm purchaseId={id} />
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Способ</Th>
                <Th>Сумма</Th>
                <Th>Заметка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {purchase.payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatDate(p.paidAt)}</Td>
                  <Td>{METHOD_LABELS[p.method] ?? p.method}</Td>
                  <Td>{formatMoney(p.amount.toString())}</Td>
                  <Td>{p.notes ?? "—"}</Td>
                </Tr>
              ))}
              {purchase.payments.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="py-6 text-center text-neutral-400">
                    Оплат пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
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
  value: React.ReactNode;
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
