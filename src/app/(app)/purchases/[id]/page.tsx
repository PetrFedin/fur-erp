import { notFound } from "next/navigation";
import Link from "next/link";
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
import { removePurchaseItem, removePurchaseExpense, updatePurchaseItem, updatePurchase } from "../actions";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Черновик", variant: "default" },
  ORDERED: { label: "Заказано", variant: "info" },
  IN_TRANSIT: { label: "В пути", variant: "warning" },
  RECEIVED: { label: "Оприходовано", variant: "success" },
  CANCELLED: { label: "Отменено", variant: "danger" },
};

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
  const status = STATUS_LABELS[purchase.status];

  const boundUpdatePurchase = updatePurchase.bind(null, id);
  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundUpdateItem = updatePurchaseItem.bind(null, id);
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);
  // Item rows can be edited even after receipt (cosmetic fields always; qty/
  // price/VAT only while the resulting lot hasn't been consumed yet) — see
  // updatePurchaseItem. Only a cancelled purchase locks items down entirely.
  const itemsMutable = purchase.status !== "CANCELLED";
  const itemColSpan = itemsMutable ? 8 : 7;

  const furItems = purchase.items.filter((i) => i.rawMaterial.unit !== "M");
  const liningItems = purchase.items.filter((i) => i.rawMaterial.unit === "M");
  const furMaterials = materials.filter((m) => m.unit !== "M");
  const liningMaterials = materials.filter((m) => m.unit === "M");

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
            <p className="text-xs text-neutral-500">
              Позиции введены в {purchase.currency}. Курс применяется при оприходовании — обновите
              его перед приёмкой, если он изменился.
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
          <CardTitle>Позиции сырья (мех)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && (
            <>
              <PurchaseItemForm purchaseId={id} materials={furMaterials} currency={purchase.currency} />
              <BulkItemForm purchaseId={id} />
            </>
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Лот</Th>
                <Th>Сорт/цвет</Th>
                <Th>Кол-во</Th>
                <Th>Цена (без НДС)</Th>
                <Th>НДС</Th>
                <Th>Сумма{isForeignCurrency && " (RUB)"}</Th>
                {itemsMutable && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {furItems.map((item) => {
                const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                const canEditFinancials = editable || (!!item.lot && !consumed);
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
                        ? `Сырьё уже списано в производство (${formatQty(item.lot.quantityReceived.sub(item.lot.quantityRemaining).toString())} ${UNIT_LABELS[item.rawMaterial.unit]}) — доступны только лот/сорт/цвет`
                        : undefined
                    }
                    canEditMaterial={editable}
                    materials={furMaterials}
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
                    <Td>{[item.grade, item.color].filter(Boolean).join(" / ") || "—"}</Td>
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
              {furItems.length === 0 && (
                <Tr>
                  <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-400">
                    Позиций пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Подкладка</CardTitle>
          <Link href="/lining" className="text-sm text-neutral-500 hover:underline">
            Смотреть все ткани →
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && (
            <PurchaseItemForm purchaseId={id} materials={liningMaterials} currency={purchase.currency} />
          )}
          <Table>
            <Thead>
              <Tr>
                <Th>Ткань</Th>
                <Th>Лот</Th>
                <Th>Сорт/цвет</Th>
                <Th>Кол-во</Th>
                <Th>Цена (без НДС)</Th>
                <Th>НДС</Th>
                <Th>Сумма{isForeignCurrency && " (RUB)"}</Th>
                {itemsMutable && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {liningItems.map((item) => {
                const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                const canEditFinancials = editable || (!!item.lot && !consumed);
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
                        ? `Сырьё уже списано в производство (${formatQty(item.lot.quantityReceived.sub(item.lot.quantityRemaining).toString())} ${UNIT_LABELS[item.rawMaterial.unit]}) — доступны только лот/сорт/цвет`
                        : undefined
                    }
                    canEditMaterial={editable}
                    materials={liningMaterials}
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
                    <Td>{[item.grade, item.color].filter(Boolean).join(" / ") || "—"}</Td>
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
              {liningItems.length === 0 && (
                <Tr>
                  <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-400">
                    Подкладка ещё не заведена
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дополнительные расходы по закупке</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <PurchaseExpenseForm purchaseId={id} categories={expenseCategories} />}
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
              {purchase.expenses.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="py-6 text-center text-neutral-400">
                    Доп. расходов нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <p className="text-xs text-neutral-400">
            При оприходовании расходы распределяются на позиции сырья пропорционально их сумме —
            себестоимость на складе учитывает доставку, растаможку и прочие затраты.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Оплаты поставщику</CardTitle>
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
                  <Td>{p.method}</Td>
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
