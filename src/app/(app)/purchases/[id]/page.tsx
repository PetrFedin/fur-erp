import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { RecordHistory } from "@/components/record-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatCurrency, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat, purchaseTotalExclVat } from "@/lib/purchase-totals";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { PurchaseItemForm } from "./item-form";
import { BulkItemForm } from "./bulk-item-form";
import { PurchaseExpenseForm } from "./expense-form";
import { PurchasePaymentForm } from "./payment-form";
import { PaymentDeleteButton } from "./payment-delete-button";
import { PurchaseActions } from "./purchase-actions";
import { ExchangeRateForm } from "./exchange-rate-form";
import { PurchaseEditForm } from "./purchase-edit-form";
import { ItemRowShared, PurchaseItemRow } from "./item-row";
import { DocumentsForm } from "./documents-form";
import { AddForm } from "@/components/drive-documents";
import { PurchaseDocumentsList, buildDocGroups } from "./documents-block";
import { toDriveView } from "@/lib/drive-docs-server";
import { countLabel } from "@/lib/drive-docs-group";
import { CostBreakdownToggle } from "../../lots/cost-breakdown-toggle";
import { CostPlanItemEditor, CostPlanRateForm } from "./cost-plan-editor";
import { deriveCostPlanInputs } from "@/lib/cost-plan";
import { CUSTOM_FIELD_ENTITY, formatExtra, readExtra } from "@/lib/custom-fields";
import { ACCESS, hasRole } from "@/lib/access";
import { getColorOptions } from "@/lib/colors";
import { loadAuctionSummaries } from "@/lib/auction-payments";
import { AuctionDocsPay } from "../../lots/auction-docs-pay";
import { VerifyBlock } from "../../verify/verify-block";
import { ConfirmSubmitButton } from "./documents-form";
import { rowVersion, PURCHASE_V, PURCHASE_ITEM_V } from "@/lib/concurrency";
import { removePurchaseItem, removePurchaseExpense, removePurchasePayment, updatePurchaseItem, updatePurchase, type OrderRef } from "../actions";

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

  // Документы Google Drive: закупки, её лотов и оплат.
  const driveLotIds = purchase.items.map((i) => i.lotId).filter((x): x is string => !!x);
  const driveRows = await prisma.driveDocument.findMany({
    where: {
      organizationId: session.user.organizationId,
      OR: [
        { purchaseId: purchase.id },
        ...(driveLotIds.length ? [{ lotId: { in: driveLotIds } }] : []),
        ...(purchase.payments.length ? [{ paymentId: { in: purchase.payments.map((p) => p.id) } }] : []),
      ],
    },
    include: { lot: { select: { lotNumber: true } } },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  const driveDocs = driveRows.map((d) =>
    toDriveView(d, d.lotId ? `лот ${d.lot?.lotNumber ?? "без номера"}` : d.paymentId ? "оплата" : null, session.user.role),
  );

  const docFiles = [
    ...purchase.documents.map((d) => ({ ...d, batch: false })),
    ...batchDocs.map((d) => ({ ...d, batch: true })),
  ];
  const docDrives = driveRows.map((d, i) => ({ view: driveDocs[i], fileId: d.driveFileId, createdAt: d.createdAt }));
  const docRecords = docFiles.length + docDrives.length;
  const docGroupCount = buildDocGroups(docFiles, docDrives).length;

  const statusEditable = purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED";
  // Роль из сессии: формы и кнопки правок видят только OWNER/ADMIN/PURCHASER (сервер всё равно отказывает остальным).
  const canEditRole = hasRole(session.user.role, ACCESS.purchases);
  const canReceive = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"].includes(session.user.role);
  const editable = statusEditable && canEditRole;
  const canEditPlan = editable;
  const colorOptions = canEditRole ? await getColorOptions(session.user.organizationId) : [];
  const canAddColor = hasRole(session.user.role, ACCESS.colors);

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
  // Копейки округления (|x| < 1 ₽) — это ноль, а не «−0,02».
  const near0 = (x: Decimal) => (x.abs().lessThan(1) ? new Decimal(0) : x);
  const extraExclVat = near0(itemsTotalExclVatRub.sub(goodsExclVatRub).add(expensesTotalExclVat));
  const vatTotal = near0(grandTotalRub.sub(itemsTotalExclVatRub).sub(expensesTotalExclVat));
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
  const boundRemovePayment = removePurchasePayment.bind(null, id);
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
  const hasPlan = planItems.length > 0;
  const currencySym = purchase.currency === "USD" ? "$" : purchase.currency === "RUB" ? "₽" : purchase.currency;
  const itemColSpan = 6 + (hasPlan ? 1 : 0) + (showGradeColor ? 1 : 0) + (itemsMutable ? 1 : 0) + customFields.length;

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

  const itemRow = (item: (typeof purchase.items)[number], variant: "row" | "card") => {
                  const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                  const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                  const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                  // Позиция с расчётом из расчётного листа: цена/кол-во/НДС не правятся никогда.
                  const itemPlan = item.costPlan != null;
                  const canEditFinancials = canEditRole && !itemPlan && (editable || (!!item.lot && !consumed));
                  const orders = item.lot ? ordersByLot.get(item.lot.id) : undefined;
                  const planInfo = itemPlan
                    ? (() => {
                        const plan = item.costPlan as unknown as {
                          manualEditedAt?: string;
                          unitCostInclVat: string;
                          materialExclVat: string;
                          expenseExclVat: string;
                          costBreakdown: never;
                        };
                        return {
                          plan,
                          excl: new Decimal(plan.materialExclVat).add(plan.expenseExclVat),
                          total: new Decimal(plan.unitCostInclVat).mul(item.quantity),
                        };
                      })()
                    : null;
                  const lotName = item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера";
                  const unitNode = planInfo ? (
                    <Money key="unit" incl={planInfo.plan.unitCostInclVat} excl={planInfo.excl.toString()} />
                  ) : null;
                  const totalNode = planInfo ? (
                    <Money key="total" incl={planInfo.total.toString()} excl={planInfo.excl.mul(item.quantity).toString()} />
                  ) : (
                    <Money key="total" incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                  );
                  const card = {
                    title: item.rawMaterial.name,
                    subtitle: [item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера", [item.grade, item.color].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
                    fields: [
                      { label: "Кол-во", value: `${formatQty(item.quantity.toString())} ${UNIT_LABELS[item.rawMaterial.unit]}` },
                      { label: hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС", value: formatCurrency(item.unitPrice.toString(), purchase.currency) },
                      { label: "НДС", value: `${item.vatRate.toString()}%` },
                      ...(hasPlan ? [{ label: <VatLabel key="unit-label" base="Себестоимость ед." />, value: unitNode ?? "—" }] : []),
                      { label: <VatLabel key="total-label" base={hasPlan ? "Всего" : `Сумма${isForeignCurrency ? ", RUB" : ""}`} />, value: totalNode, strong: true },
                    ],
                    details: customFields.map((f) => ({ label: f.name, value: formatExtra(f.type, readExtra(item.extra)[f.id]) || "—" })),
                    // То же, что в ячейках десктопной строки: «Из чего цена», пометка о ручной правке, «Править расчёт».
                    extra: planInfo ? (
                      <div key="extra" className="flex flex-col items-start gap-1.5">
                        <CostBreakdownToggle
                          breakdown={planInfo.plan.costBreakdown}
                          unitCostExcl={planInfo.excl.toString()}
                          unitCostIncl={planInfo.plan.unitCostInclVat}
                        />
                        {planInfo.plan.manualEditedAt && !Number.isNaN(Date.parse(planInfo.plan.manualEditedAt)) && (
                          <div className="text-xs text-amber-700">
                            изменён вручную {formatDate(new Date(planInfo.plan.manualEditedAt))}
                          </div>
                        )}
                        {canEditPlan && (
                          <CostPlanItemEditor
                            purchaseId={id}
                            currencySymbol={currencySym}
                            item={{
                              id: item.id,
                              lotNumber: item.lotNumber,
                              ...deriveCostPlanInputs(item.costPlan, {
                                quantity: Number(item.quantity.toString()),
                                price: Number(item.unitPrice.toString()),
                                rate: Number(purchase.exchangeRate.toString()),
                                vat: Number(item.vatRate.toString()),
                              }),
                            }}
                          />
                        )}
                      </div>
                    ) : undefined,
                  };
                  return (
                    <PurchaseItemRow
                      key={item.id}
                      variant={variant}
                      card={variant === "card" ? card : undefined}
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
                        itemPlan
                          ? "Цена и количество взяты из расчётного листа — меняйте их кнопкой «Править расчёт» в строке позиции. Здесь доступны только лот, сорт и цвет."
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
                      defaults={{
                        rawMaterialId: item.rawMaterialId,
                        rawMaterialName: item.rawMaterial.name,
                        quantity: item.quantity.toString(),
                        unitPrice: item.unitPrice.toString(),
                        vatRate: item.vatRate.toString(),
                        lotNumber: item.lotNumber ?? "",
                        grade: item.grade ?? "",
                        color: item.color ?? "",
                        colorRefId: item.colorRefId ?? "",
                        version: rowVersion(item, PURCHASE_ITEM_V),
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
                      {planInfo ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Money incl={planInfo.plan.unitCostInclVat} excl={planInfo.excl.toString()} />
                            <CostBreakdownToggle
                              breakdown={planInfo.plan.costBreakdown}
                              unitCostExcl={planInfo.excl.toString()}
                              unitCostIncl={planInfo.plan.unitCostInclVat}
                            />
                            {planInfo.plan.manualEditedAt && !Number.isNaN(Date.parse(planInfo.plan.manualEditedAt)) && (
                              <div className="text-xs font-normal text-amber-700">
                                изменён вручную {formatDate(new Date(planInfo.plan.manualEditedAt))}
                              </div>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">
                            <Money incl={planInfo.total.toString()} excl={planInfo.excl.mul(item.quantity).toString()} />
                            {canEditPlan && (
                              <div className="mt-1">
                                <CostPlanItemEditor
                                  purchaseId={id}
                                  currencySymbol={currencySym}
                                  item={{
                                    id: item.id,
                                    lotNumber: item.lotNumber,
                                    ...deriveCostPlanInputs(item.costPlan, {
                                      quantity: Number(item.quantity.toString()),
                                      price: Number(item.unitPrice.toString()),
                                      rate: Number(purchase.exchangeRate.toString()),
                                      vat: Number(item.vatRate.toString()),
                                    }),
                                  }}
                                />
                              </div>
                            )}
                          </Td>
                        </>
                      ) : hasPlan ? (
                        <>
                          <Td className="text-neutral-400">—</Td>
                          <Td className="whitespace-nowrap">
                            <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          </Td>
                        </>
                      ) : (
                        <Td>
                          <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          {isForeignCurrency && (
                            <span className="ml-1 text-xs text-neutral-400">
                              ({formatCurrency(item.subtotal.toString(), purchase.currency)} без НДС)
                            </span>
                          )}
                        </Td>
                      )}
                      {customFields.map((f) => (
                        <Td key={f.id}>{formatExtra(f.type, readExtra(item.extra)[f.id]) || "—"}</Td>
                      ))}
                    </PurchaseItemRow>
                  );
  };

  return (
    <ItemRowShared value={{ colorOptions, canAddColor, materials: allMaterials, currency: purchase.currency }}>
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="-mb-2 text-sm"><Link href="/purchases" className="text-neutral-500 hover:underline">← Закупки</Link></div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            Закупка {purchase.number}
            <InfoHint label="О закупке" wide>
              <p>Позиции сырья и подкладки, расходы закупки, расчёт себестоимости, оплаты и документы.</p>
              <p className="mt-1">Дата заказа {formatDate(purchase.orderDate)} — по ней закупка попадает в общий фильтр года (2025 / 2026) на страницах «Закупки» и «Сырьё».</p>
              <p className="mt-1">Переключатель «С 4%» эту страницу не меняет: 4% — наценка посредника на сырьё и подкладку при списании в ТЗ; закупка, оплаты и долг поставщику остаются как есть.</p>
            </InfoHint>
          </h1>
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
                version={rowVersion(purchase, PURCHASE_V)}
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
              orderDate={purchase.orderDate.toISOString().slice(0, 10)}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <SummaryCard
          label={isForeignCurrency ? `Сырьё, без НДС (${formatCurrency(itemsTotal.toString(), purchase.currency)})` : "Сырьё, без НДС"}
          value={formatMoney(goodsExclVatRub.toString())}
        />
        <SummaryCard
          label="Доп. расходы, без НДС"
          value={formatMoney(extraExclVat.toString())}
          note={purchase.expenses.length === 0 && extraExclVat.greaterThan(0) ? "в т.ч. сборы аукциона, выделка (из расчёта лотов)" : undefined}
        />
        <SummaryCard label="НДС" value={formatMoney(vatTotal.toString())} />
        <SummaryCard
          label={<VatLabel base="Итого, RUB" />}
          value={<Money incl={grandTotalRub} excl={itemsTotalExclVatRub.add(expensesTotalExclVat)} />}
          emphasis
        />
        {auctionPay ? (
          <SummaryCard
            label={
              <Link
                href={`/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block`}
                className="inline-block text-blue-600 hover:underline max-md:py-2"
                title={`Оплаты ведутся по аукциону «${auctionPay.name}» целиком`}
              >
                Оплачено по аукциону
              </Link>
            }
            value={
              <>
                {auctionPay.paid.greaterThan(0.005)
                  ? `${formatMoney(auctionPay.paid.toString())} из ${formatMoney(auctionPay.total.toString())}`
                  : "оплат нет"}
                <span className="mt-0.5 block text-xs font-normal text-neutral-500">
                  остаток по аукциону {formatMoney(auctionPay.remaining.toString())}
                  {auctionPay.planned.greaterThan(0) && ` · запланировано ${formatMoney(auctionPay.planned.toString())}`}
                </span>
              </>
            }
            warn={auctionPay.remaining.greaterThan(0)}
          />
        ) : (
          <SummaryCard label="Остаток к оплате" value={formatMoney(balanceDue.toString())} warn={balanceDue.greaterThan(0)} />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Позиции ({purchase.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <>
              <details open={purchase.items.length === 0} className="rounded-md border border-neutral-200 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium max-md:py-2">Вставить позиции из Excel</summary>
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
                <summary className="cursor-pointer text-sm text-neutral-600 max-md:py-2">Добавить одну позицию</summary>
                <div className="mt-3">
                  <PurchaseItemForm purchaseId={id} materials={allMaterials} currency={purchase.currency} colorOptions={colorOptions} canAddColor={canAddColor} />
                </div>
              </details>
            </>
          )}
          <details open={purchase.items.length <= EXPANDED_ITEMS_LIMIT}>
            <summary className="mb-2 cursor-pointer text-sm text-neutral-600 max-md:py-2">
              Список позиций
            </summary>
            <ResponsiveRows
              table={
            <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th>Лот</Th>
                  {showGradeColor && <Th>Сорт / цвет</Th>}
                  <Th>Кол-во</Th>
                  <Th>{hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС"}</Th>
                  <Th>НДС</Th>
                  {hasPlan ? (
                    <>
                      <Th>
                        Себестоимость единицы
                        <InfoHint label="Из чего складывается себестоимость единицы">
                          Расчёт из расчётного листа: цена лота, сборы аукциона, выделка, транспорт, брокерский %, НДС.
                        </InfoHint>
                      </Th>
                      <Th>Всего</Th>
                    </>
                  ) : (
                    <Th>Сумма{isForeignCurrency && " (RUB)"}</Th>
                  )}
                  {customFields.map((f) => (
                    <Th key={f.id}>
                      {f.name}
                      <InfoHint label="Свой столбец">Свой столбец организации — правится в режиме «Аукцион» (Сырьё → Лоты).</InfoHint>
                    </Th>
                  ))}
                  {itemsMutable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.items.map((item) => itemRow(item, "row"))}
                {purchase.items.length === 0 && (
                  <Tr>
                    <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-400">
                      Позиций пока нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
              }
            >
              {purchase.items.map((item) => itemRow(item, "card"))}
              {purchase.items.length === 0 && <p className="py-4 text-center text-sm text-neutral-400">Позиций пока нет</p>}
            </ResponsiveRows>
          </details>
        </CardContent>
      </Card>


      {planItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Расчёт себестоимости
              <InfoHint label="О расчёте себестоимости" wide>
                Себестоимость единицы в таблице позиций — предварительный расчёт из расчётного листа. При приёме на склад она
                переходит в лот, а расходы закупки (блок «Расходы») добавляются сверху пропорционально стоимости лотов. 4% сюда не входит: оно добавляется только при списании в ТЗ.
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {statusEditable ? (
                canEditRole ? (
                  <>Цена, количество и расходы лота правятся кнопкой «Править расчёт» в строке позиции.</>
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
                orderDate={purchase.orderDate.toISOString().slice(0, 10)}
              />
            )}
          </CardContent>
        </Card>
      )}

      <VerifyBlock kind="purchase" id={id} title="Подтверждение закупки" />

      <AuctionDocsPay organizationId={session.user.organizationId} purchaseId={id} />

      <Card>
        <CardHeader>
          <CardTitle>Документы ({countLabel(docGroupCount, docRecords)})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PurchaseDocumentsList
            purchaseId={id}
            files={docFiles}
            drives={docDrives}
            batchName={batchName}
            canEdit={canEditRole}
          />
          {canEditRole && (
            <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3">
              <DocumentsForm
                purchaseId={id}
                hasBatch={!!batchName}
                paymentTargets={
                  hasRole(session.user.role, ["OWNER", "ADMIN"])
                    ? purchase.payments.map((p) => ({ id: p.id, label: `${formatDate(p.paidAt)} · ${formatMoney(p.amount.toString())}` }))
                    : undefined
                }
              />
              <AddForm entity="purchase" entityId={id} />
            </div>
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
            <ResponsiveRows
              table={
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
                          <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." />
                        </form>
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </Table>
              }
            >
              {purchase.expenses.map((e) => (
                <RowCard
                  key={e.id}
                  title={e.category.name}
                  subtitle={e.description}
                  fields={[
                    { label: "Сумма (без НДС)", value: formatMoney(e.amount.toString()) },
                    { label: "НДС", value: `${e.vatRate.toString()}%` },
                    { label: <VatLabel base="Сумма" />, value: <Money incl={grossUp(e.amount, e.vatRate)} excl={e.amount} />, strong: true },
                  ]}
                  extra={
                    editable && (
                      <form
                        action={async () => {
                          "use server";
                          await boundRemoveExpense(e.id);
                        }}
                      >
                        <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." variant="outline" className="max-md:h-10" />
                      </form>
                    )
                  }
                />
              ))}
            </ResponsiveRows>
          )}
          {purchase.expenses.length === 0 && <p className="text-sm text-neutral-400">Расходов нет</p>}
          {purchase.expenses.length > 0 && expensesTotalInclVat.greaterThan(0) && (
            <div className="text-sm text-neutral-600">
              Расходы = {formatMoney(expensesTotalInclVat.toString())} (с НДС) → в цену единицы добавится ≈{" "}
              {expensePerUnit
                ? `${formatMoney(expensePerUnit.toFixed(2))} за 1 ${UNIT_LABELS[singleUnit!]}`
                : expensePct
                  ? `+${expensePct.toFixed(1)}% к цене каждой единицы`
                  : "—"}
              {expensePct && expensePerUnit && ` (+${expensePct.toFixed(1)}% к стоимости позиций)`}
              <InfoHint label="Как распределяются расходы">Справочно: при приёме на склад расходы распределяются по позициям пропорционально их сумме.</InfoHint>
            </div>
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
          <ResponsiveRows
            table={
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Способ</Th>
                <Th>Сумма</Th>
                <Th>Заметка</Th>
                {canEditRole && <Th></Th>}
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
                  {canEditRole && (
                    <Td>
                      <PaymentDeleteButton
                        amountLabel={`${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)}`}
                        action={async () => {
                          "use server";
                          await boundRemovePayment(p.id);
                        }}
                      />
                    </Td>
                  )}
                </Tr>
              ))}
              {purchase.payments.length === 0 && (
                <Tr>
                  <Td colSpan={canEditRole ? 5 : 4} className="py-6 text-center text-neutral-400">
                    Оплат пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
            }
          >
            {purchase.payments.map((p) => (
              <RowCard
                key={p.id}
                title={formatMoney(p.amount.toString())}
                subtitle={formatDate(p.paidAt)}
                badge={p.status === "PENDING" ? <span className="text-xs text-amber-600">запланирована</span> : undefined}
                fields={[
                  { label: "Способ", value: METHOD_LABELS[p.method] ?? p.method },
                  ...(p.notes ? [{ label: "Заметка", value: p.notes }] : []),
                ]}
                extra={
                  canEditRole && (
                    <PaymentDeleteButton
                      amountLabel={`${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)}`}
                      action={async () => {
                        "use server";
                        await boundRemovePayment(p.id);
                      }}
                    />
                  )
                }
              />
            ))}
            {purchase.payments.length === 0 && <p className="py-4 text-center text-sm text-neutral-400">Оплат пока нет</p>}
          </ResponsiveRows>
        </CardContent>
      </Card>
      <RecordHistory model="Purchase" recordId={purchase.id} />
    </div>
    </ItemRowShared>
  );
}

function SummaryCard({
  label,
  value,
  emphasis,
  warn,
  note,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
  warn?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 break-words text-base font-semibold sm:text-lg ${warn ? "text-amber-600" : emphasis ? "text-neutral-900" : "text-neutral-700"}`}
      >
        {value}
      </div>
      {note && <div className="mt-0.5 text-xs text-neutral-500">{note}</div>}
    </div>
  );
}
