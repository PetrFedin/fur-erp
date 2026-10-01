import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatCurrency, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat, purchaseTotalExclVat } from "@/lib/purchase-totals";
import { Money } from "@/components/money";
import { PurchaseItemForm } from "./item-form";
import { BulkItemForm } from "./bulk-item-form";
import { PurchaseExpenseForm } from "./expense-form";
import { PurchasePaymentForm } from "./payment-form";
import { PurchaseActions } from "./purchase-actions";
import { ExchangeRateForm } from "./exchange-rate-form";
import { PurchaseEditForm } from "./purchase-edit-form";
import { PurchaseItemRow } from "./item-row";
import { DocumentsForm, ConfirmSubmitButton } from "./documents-form";
import { CostBreakdownToggle } from "../../lots/cost-breakdown-toggle";
import { CostPlanItemEditor, CostPlanRateForm } from "./cost-plan-editor";
import { deriveCostPlanInputs } from "@/lib/cost-plan";
import { CUSTOM_FIELD_ENTITY, formatExtra, readExtra } from "@/lib/custom-fields";
import { ACCESS, hasRole } from "@/lib/access";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { loadAuctionSummaries } from "@/lib/auction-payments";
import { deletePurchaseDocument } from "../doc-actions";
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
      documents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!purchase) notFound();

  // Документы партии (спецификация, расчётный лист, счёт на аванс) лежат на
  // аукционе целиком: показываем их на каждой закупке с тем же auctionSession.
  const batchName = purchase.auctionSession?.split(/\r?\n/)[0].trim() || null;
  const batchDocs = batchName
    ? await prisma.purchaseDocument.findMany({
        where: { organizationId: session.user.organizationId, purchaseId: null, batch: batchName },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const planItems = purchase.items.filter((i) => i.costPlan != null);

  const statusEditable = purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED";
  // Роль из сессии: формы и кнопки правок видят только OWNER/ADMIN/PURCHASER (сервер всё равно отказывает остальным).
  const canEditRole = hasRole(session.user.role, ACCESS.purchases);
  const canReceive = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"].includes(session.user.role);
  const editable = statusEditable && canEditRole;
  const canEditPlan = editable;

  const [materials, expenseCategories, suppliers, warehouses, existingLots] = editable
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
        prisma.rawMaterialLot.findMany({
          where: { organizationId: session.user.organizationId, lotNumber: { not: null } },
          select: { lotNumber: true },
        }),
      ])
    : [[], [], [], [], []];

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
  // С расчётом из расчётного листа (costPlan) суммы берутся из него — см. purchase-totals.
  const itemsOnly = { exchangeRate: purchase.exchangeRate, items: purchase.items, expenses: [] };
  const itemsTotalExclVatRub = purchaseTotalExclVat(itemsOnly);
  const itemsTotalInclVatRub = purchaseTotalInclVat(itemsOnly);
  const expensesTotalExclVat = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const expensesTotalInclVat = purchase.expenses.reduce(
    (s, e) => s.add(grossUp(e.amount, e.vatRate)),
    new Decimal(0)
  );
  const grandTotalRub = itemsTotalInclVatRub.add(expensesTotalInclVat);
  const goodsExclVatRub = itemsTotal.mul(purchase.exchangeRate);
  // Расходы, заложенные в расчёт лотов (сборы аукциона, выделка, транспорт, брокер), — тоже «доп. расходы».
  const extraExclVat = itemsTotalExclVatRub.sub(goodsExclVatRub).add(expensesTotalExclVat);
  const vatTotal = grandTotalRub.sub(itemsTotalExclVatRub).sub(expensesTotalExclVat);
  // В «Оплачено» — только факт (запланированные оплаты не в счёт).
  const paidTotal = purchase.payments.filter((p) => p.status === "COMPLETED").reduce((s, p) => s.add(p.amount), new Decimal(0));
  const auctionPay = batchName
    ? (await loadAuctionSummaries(prisma, session.user.organizationId, [batchName]))[0] ?? null
    : null;
  const balanceDue = grandTotalRub.sub(paidTotal);
  const status = statusView(purchase.status);

  const boundUpdatePurchase = updatePurchase.bind(null, id);
  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundUpdateItem = updatePurchaseItem.bind(null, id);
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);
  // Item rows can be edited even after receipt (cosmetic fields always; qty/
  // price/VAT only while the resulting lot hasn't been consumed yet) — see
  // updatePurchaseItem. Only a cancelled purchase locks items down entirely.
  const itemsMutable = purchase.status !== "CANCELLED" && canEditRole;

  const allMaterials = materials;
  const showGradeColor = purchase.items.some((i) => i.grade || i.color);
  // Свои столбцы организации (общие с режимом «Аукцион»): здесь только показ значений.
  const customFields = await prisma.customField.findMany({
    where: { organizationId: session.user.organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, type: true, position: true },
  });
  const itemColSpan = 6 + (showGradeColor ? 1 : 0) + (itemsMutable ? 1 : 0) + customFields.length;

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
                currencyLocked={planItems.length > 0}
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
        <PurchaseActions
          purchaseId={id}
          status={purchase.status}
          canReceive={canReceive}
          canCancel={canEditRole}
          hasCostPlan={planItems.length > 0}
        />
      </div>

      {isForeignCurrency && editable && planItems.length === 0 && (
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

      {auctionPay && (
        <p className="text-sm text-neutral-600">
          <Link href={`/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block`} className="font-medium text-blue-600 hover:underline">
            Оплаты Веллмех по аукциону «{auctionPay.name}»
          </Link>
          : оплачено {formatMoney(auctionPay.paid.toString())} из {formatMoney(auctionPay.total.toString())}, остаток{" "}
          {formatMoney(auctionPay.remaining.toString())}
          {auctionPay.planned.greaterThan(0) && `, запланировано ${formatMoney(auctionPay.planned.toString())}`}.
          <span className="block text-xs text-neutral-400">
            Оплаты по аукциону целиком в «Остаток к оплате» этой закупки ниже не входят — он считает только оплаты, внесённые в саму закупку.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <SummaryCard
          label={isForeignCurrency ? `Сырьё, без НДС (${formatCurrency(itemsTotal.toString(), purchase.currency)})` : "Сырьё, без НДС"}
          value={formatMoney(goodsExclVatRub.toString())}
        />
        <SummaryCard label="Доп. расходы, без НДС" value={formatMoney(extraExclVat.toString())} />
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
                    existingLotNumbers={existingLots.map((l) => l.lotNumber as string)}
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
                  <Th title={planItems.length > 0 ? "Цена самого лота; выделка и транспорт из расчёта себестоимости (ниже) сюда не входят" : undefined}>
                    {planItems.length > 0 ? "Цена лота (без расходов)" : "Сумма"}
                    {isForeignCurrency && " (RUB)"}
                  </Th>
                  {customFields.map((f) => (
                    <Th key={f.id} title="Свой столбец — правится в режиме «Аукцион» (Лоты)">
                      {f.name}
                    </Th>
                  ))}
                  {itemsMutable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.items.map((item) => {
                  const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                  const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                  const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                  // Позиция с расчётом из расчётного листа: цена/кол-во/НДС не правятся никогда.
                  const hasPlan = item.costPlan != null;
                  const canEditFinancials = canEditRole && !hasPlan && (editable || (!!item.lot && !consumed));
                  const orders = item.lot ? ordersByLot.get(item.lot.id) : undefined;
                  const lotName = item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера";
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
                        hasPlan
                          ? "Цена и количество взяты из расчётного листа — меняйте их кнопкой «Править расчёт» в блоке расчёта ниже. Здесь доступны только лот, сорт и цвет."
                          : item.lot && consumed
                          ? orders && orders.length > 0
                            ? `${lotName} уже списан в ТЗ (${orders
                                .map((o) => `${o.number}: ${formatQty(o.quantity)} ${UNIT_LABELS[item.rawMaterial.unit]}`)
                                .join(", ")}). Сначала удалите там списание. Доступны только лот, сорт и цвет:`
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
                      {customFields.map((f) => (
                        <Td key={f.id}>{formatExtra(f.type, readExtra(item.extra)[f.id]) || "—"}</Td>
                      ))}
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


      {planItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Расчёт себестоимости по лотам</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-neutral-500">
              Предварительный расчёт из расчётного листа: цена лота, сборы аукциона, выделка, транспорт, брокерский %,
              НДС. При приёме на склад эта стоимость единицы переходит в лот, а расходы закупки (блок «Расходы»)
              добавляются сверху пропорционально стоимости лотов. Колонка «Цена лота (без расходов)» в таблице позиций —
              только цена лота без этих сборов и расходов, поэтому она меньше итога закупки.
            </p>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {statusEditable ? (
                canEditRole ? (
                  <>Цена, количество и расходы лота правятся кнопкой «Править расчёт».</>
                ) : (
                  <>Расчёт могут менять только владелец, администратор и закупщик.</>
                )
              ) : (
                <>
                  Закупка уже {purchase.status === "RECEIVED" ? "принята на склад" : "закрыта"} — расчёт менять нельзя;
                  обратитесь к администратору.
                  {batchName && canEditRole && (
                    <>
                      {" "}
                      Документы можно заменить или переименовать в режиме «Аукцион»:{" "}
                      <Link href={`/lots?auction=${encodeURIComponent(batchName)}`} className="underline">
                        открыть аукцион {batchName}
                      </Link>
                      .
                    </>
                  )}
                </>
              )}
            </p>
            {canEditPlan && (
              <CostPlanRateForm
                key={purchase.exchangeRate.toString()}
                purchaseId={id}
                currency={purchase.currency}
                exchangeRate={purchase.exchangeRate.toString()}
              />
            )}
            <Table>
              <Thead>
                <Tr>
                  <Th>Лот</Th>
                  <Th>Кол-во</Th>
                  <Th>Цена лота, $</Th>
                  <Th>Себестоимость единицы</Th>
                  <Th>Всего</Th>
                  {canEditPlan && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {planItems.map((i) => {
                  const plan = i.costPlan as unknown as {
                    manualEditedAt?: string;
                    unitCostInclVat: string;
                    materialExclVat: string;
                    expenseExclVat: string;
                    costBreakdown: never;
                  };
                  const excl = new Decimal(plan.materialExclVat).add(plan.expenseExclVat);
                  const total = new Decimal(plan.unitCostInclVat).mul(i.quantity);
                  return (
                    <Tr key={i.id}>
                      <Td>
                        {i.lotNumber ?? "—"}
                        {plan.manualEditedAt && !Number.isNaN(Date.parse(plan.manualEditedAt)) && (
                          <div className="text-xs font-normal text-amber-700">
                            расчёт изменён вручную {formatDate(new Date(plan.manualEditedAt))}
                          </div>
                        )}
                      </Td>
                      <Td>{formatQty(i.quantity.toString())} шт.</Td>
                      <Td>{formatCurrency(i.unitPrice.toString(), purchase.currency)}</Td>
                      <Td className="whitespace-nowrap">
                        <Money incl={plan.unitCostInclVat} excl={excl.toString()} />
                        <CostBreakdownToggle
                          breakdown={plan.costBreakdown}
                          unitCostExcl={excl.toString()}
                          unitCostIncl={plan.unitCostInclVat}
                        />
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Money incl={total.toString()} excl={excl.mul(i.quantity).toString()} />
                      </Td>
                      {canEditPlan && (
                        <Td>
                          <CostPlanItemEditor
                            purchaseId={id}
                            currencySymbol={purchase.currency === "USD" ? "$" : purchase.currency}
                            item={{
                              id: i.id,
                              lotNumber: i.lotNumber,
                              ...deriveCostPlanInputs(i.costPlan, {
                                quantity: Number(i.quantity.toString()),
                                price: Number(i.unitPrice.toString()),
                                rate: Number(purchase.exchangeRate.toString()),
                                vat: Number(i.vatRate.toString()),
                              }),
                            }}
                          />
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Документы ({purchase.documents.length + batchDocs.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[...purchase.documents.map((d) => ({ d, batch: false })), ...batchDocs.map((d) => ({ d, batch: true }))].map(
            ({ d, batch }) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <a href={`/api/purchase-docs/${d.id}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {d.title}
                  </a>
                  <span className="ml-2 text-xs text-neutral-500">
                    {DOC_KIND_LABELS[d.kind]}
                    {batch ? ` · вся партия ${batchName}` : " · эта закупка"} · {formatDate(d.createdAt)}
                  </span>
                </div>
                {canEditRole && (
                <form
                  action={async () => {
                    "use server";
                    await deletePurchaseDocument(id, d.id);
                  }}
                >
                  <ConfirmSubmitButton
                    message={
                      batch
                        ? `Удалить документ «${d.title}»? Он относится ко всей партии ${batchName} и пропадёт на всех её закупках.`
                        : `Удалить документ «${d.title}»?`
                    }
                  />
                </form>
                )}
              </div>
            ),
          )}
          {purchase.documents.length + batchDocs.length === 0 && (
            <p className="text-sm text-neutral-400">Документов пока нет</p>
          )}
          {canEditRole && <DocumentsForm purchaseId={id} hasBatch={!!batchName} />}
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
          {purchase.status === "CANCELLED" ? (
            <p className="text-sm text-neutral-500">Закупка отменена — оплаты добавлять нельзя.</p>
          ) : !canEditRole ? null : (
            <PurchasePaymentForm purchaseId={id} balanceDue={balanceDue.toFixed(2)} />
          )}
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
                  <Td>
                    {formatMoney(p.amount.toString())}
                    {p.status === "PENDING" && <span className="block text-xs text-amber-600">запланирована</span>}
                  </Td>
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
        className={`mt-1 break-words text-base font-semibold sm:text-lg ${warn ? "text-amber-600" : emphasis ? "text-neutral-900" : "text-neutral-700"}`}
      >
        {value}
      </div>
    </div>
  );
}
