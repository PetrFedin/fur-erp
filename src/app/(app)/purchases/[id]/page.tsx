import { RawStagesBlock, RawNow } from "@/components/raw-stages";
import { SortTh } from "@/components/sort-th";
import { readSort, sortRows } from "@/lib/table-sort";
import { StatementBlock } from "@/components/auction-statement";
import { buildStatement } from "@/lib/auction-statement";
import { calcAll, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { ChatLink } from "@/components/chat-link";
import { TotalLabel } from "@/components/total-label";

import { WidgetRow } from "@/components/widget-row";
import { IntegrityBanner } from "@/components/integrity-banner";
import Link from "next/link";
import { cleanNote } from "@/lib/note-tags";
import { InfoHint } from "@/components/info-hint";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../../dashboard/tile";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatDate, formatMoney, formatQty, isRoundingRest, OVERPAY_FROM, roundingRestHint } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat, purchaseTotalExclVat } from "@/lib/purchase-totals";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { vatPeriodLabel, vatRateForDate } from "@/lib/vat-by-date";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { CreateDialog } from "@/components/create-dialog";
import { PurchaseItemForm } from "./item-form";
import { BulkItemForm } from "./bulk-item-form";
import { PurchaseExpenseForm } from "./expense-form";
import { PaymentFormButton } from "@/components/payment-form";
import { PurchaseActions } from "./purchase-actions";
import { purchaseCancelBlocker } from "@/lib/purchase-cancel";
import { ExchangeRateForm } from "./exchange-rate-form";
import { PurchaseEditForm } from "./purchase-edit-form";
import { ItemRowShared, PurchaseItemRow } from "./item-row";
import { PurchaseDocumentsList, buildDocGroups } from "./documents-block";
import { toDriveView } from "@/lib/drive-docs-server";
import { getFurIndex } from "@/lib/fur-ref-server";
import { canonicalFur } from "@/lib/fur-ref";
import { countLabel } from "@/lib/drive-docs-group";
import { CostPlanItemEditor, CostPlanRateForm } from "./cost-plan-editor";
import { deriveCostPlanInputs } from "@/lib/cost-plan";
import { CUSTOM_FIELD_ENTITY, formatExtra, readExtra } from "@/lib/custom-fields";
import { ACCESS, hasRole } from "@/lib/access";
import { findAuctionIn, auctionKeys } from "@/lib/auction-ref-core";
import { auctionKey } from "@/lib/auction-key";
import { getColorOptions } from "@/lib/colors";
import { loadAuctionSummaries } from "@/lib/auction-payments";
import { AuctionDocsPay } from "../../lots/auction-docs-pay";
import { SourceDocs } from "@/components/source-docs";
import { loadPurchaseSourceDocs } from "@/lib/source-docs-server";
import { ConfirmSubmitButton } from "./documents-form";
import { rowVersion, PURCHASE_V, PURCHASE_ITEM_V, PURCHASE_EXPENSE_V, PAYMENT_EDIT_V } from "@/lib/concurrency";
import { ExpenseEditButton, PaymentEditButton } from "./edit-buttons";
import { PlanExpenses } from "./plan-expenses";
import { planExpenseLines } from "@/lib/plan-expenses";
import { PaymentDeleteButton } from "./payment-delete-button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ruGradeLabel } from "@/lib/fur-ref";
import { removePurchaseItem, removePurchaseExpense, removePurchasePayment, updatePurchaseItem, updatePurchase, type OrderRef } from "../actions";

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const p = await prisma.purchase.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { number: true } });
  return { title: p ? `Закупка ${p.number}` : "Закупка" };
}

export default async function PurchaseDetailPage({ params, searchParams }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
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
  // сортировка позиций кликом по заголовку (?sort=…&dir=…)
  const itemSort = readSort(sp, ["material", "lot", "qty", "price", "total"]);
  purchase.items = sortRows(purchase.items, itemSort, {
    material: (i) => i.rawMaterial.name, lot: (i) => i.lotNumber, qty: (i) => Number(i.quantity), price: (i) => Number(i.unitPrice), total: (i) => Number(i.subtotal),
  });
  // принятый расчёт Веллмеха, из которого создана закупка: по нему «За что заплачено»
  const calcRow = await prisma.supplierInbox.findFirst({
    where: { organizationId: session.user.organizationId, kind: "AUCTION_CALC", status: "ACCEPTED", createdEntityType: "Purchase", createdEntityId: { contains: purchase.id } },
    orderBy: { decidedAt: "desc" },
    select: { id: true, title: true, payload: true },
  });
  const calcPayload = calcRow && (calcRow.payload as unknown as CalcPayload)?.v === 1 && Array.isArray((calcRow.payload as unknown as CalcPayload).rows) ? ensureRowIds(calcRow.payload as unknown as CalcPayload) : null;
  const furIdx = await getFurIndex(session.user.organizationId);

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
  // Где сырьё — этапы, которые вносит Веллмех (у нас только чтение).
  const rawStages = await prisma.supplierRawStage.findMany({
    where: { organizationId: session.user.organizationId, purchaseId: purchase.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, stage: true, status: true, place: true, lotNumber: true, qty: true, note: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true },
  });

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
  // Принятая закупка: № счёта, УПД, дата и аукцион правятся (поставщик, склад, валюта — нет: лоты уже посчитаны).
  const headerEditable = canEditRole && purchase.status !== "CANCELLED";
  const receivedHeader = headerEditable && !statusEditable;
  const canEditPlan = editable;
  const colorOptions = canEditRole ? await getColorOptions(session.user.organizationId) : [];
  const canAddColor = hasRole(session.user.role, ACCESS.colors);

  const [materials, expenseCategories, suppliers, existingLots] = editable
    ? await Promise.all([
        prisma.rawMaterial.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          select: { id: true, name: true, unit: true, defaultVatRate: true },
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
        prisma.rawMaterialLot.findMany({
          where: { organizationId: session.user.organizationId, lotNumber: { not: null } },
          select: { lotNumber: true },
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

  const auctionRefs = headerEditable
    ? await prisma.auction.findMany({
        where: { organizationId: session.user.organizationId, isService: false },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, fullName: true, house: true, year: true, aliases: true, isService: true, confirmed: true },
      })
    : [];
  // Закупка без привязки, но с текстом из справочника, открывается уже с выбранным аукционом.
  // Привязка показывается, только если кэш-текст закупки совпадает с именем/написанием этого аукциона (заглушки «Нет информации» остаются старым текстом).
  const linked = purchase.auctionId ? auctionRefs.find((a) => a.id === purchase.auctionId) : undefined;
  const textKey = auctionKey(purchase.auctionSession);
  const auctionIdDefault = linked
    ? (!textKey || auctionKeys(linked).has(textKey) ? linked.id : null)
    : findAuctionIn(purchase.auctionSession, auctionRefs)?.id ?? null;

  // Другие закупки этого поставщика — куда можно перенести оплату при правке.
  const payTargets =
    canEditRole && purchase.payments.length > 0
      ? (
          await prisma.purchase.findMany({
            where: { organizationId: session.user.organizationId, supplierId: purchase.supplierId, id: { not: purchase.id }, status: { not: "CANCELLED" } },
            orderBy: { orderDate: "desc" },
            take: 60,
            select: { id: true, number: true, orderDate: true, auctionSession: true },
          })
        ).map((t) => ({ id: t.id, label: `${t.number} · ${formatDate(t.orderDate)}${t.auctionSession ? ` · ${t.auctionSession.split(/\r?\n/)[0].trim()}` : ""}` }))
      : [];
  const payEdit = (p: (typeof purchase.payments)[number]) =>
    canEditRole ? (
      <PaymentEditButton
        purchaseId={id}
        paymentId={p.id}
        version={rowVersion(p, PAYMENT_EDIT_V)}
        targets={payTargets}
        defaults={{ amount: p.amount.toString(), paidAt: p.paidAt.toISOString().slice(0, 10), method: p.method, status: p.status === "PENDING" ? "PENDING" : "COMPLETED", docRef: p.docRef ?? "", notes: p.notes ?? "" }}
      />
    ) : null;
  const expenseEdit = (e: (typeof purchase.expenses)[number]) =>
    editable ? (
      <ExpenseEditButton
        purchaseId={id}
        expenseId={e.id}
        version={rowVersion(e, PURCHASE_EXPENSE_V)}
        categories={expenseCategories.map((c) => ({ id: c.id, name: c.name }))}
        defaults={{ categoryId: e.categoryId, amount: e.amount.toString(), vatRate: e.vatRate.toString(), description: e.description ?? "" }}
      />
    ) : null;

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
  // Один счёт/УПД на несколько закупок (split purchase): показываем соседние закупки с тем же счётом или УПД у того же поставщика.
  const sharedKeys = [
    ...(purchase.invoiceNumber ? [{ invoiceNumber: purchase.invoiceNumber }] : []),
    ...(purchase.transferDocument ? [{ transferDocument: purchase.transferDocument }] : []),
  ];
  const sharedDocPurchases = sharedKeys.length
    ? await prisma.purchase.findMany({
        where: { organizationId: session.user.organizationId, supplierId: purchase.supplierId, id: { not: purchase.id }, status: { not: "CANCELLED" }, OR: sharedKeys },
        include: { items: true, expenses: true },
        orderBy: { number: "asc" },
      })
    : [];
  const vatRatesText = [...new Set(purchase.items.map((i) => i.vatRate.toString()))].join(" / ");

  const boundUpdatePurchase = updatePurchase.bind(null, id);
  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundUpdateItem = updatePurchaseItem.bind(null, id);
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);
  // Item rows can be edited even after receipt (cosmetic fields always; qty/
  // price/VAT only while the resulting lot hasn't been consumed yet) — see
  // updatePurchaseItem. Only a cancelled purchase locks items down entirely.
  const itemsMutable = purchase.status !== "CANCELLED" && canEditRole;

  const allMaterials = materials.map((m) => ({ ...m, defaultVatRate: m.defaultVatRate?.toString() ?? null }));
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


  const itemRow = (item: (typeof purchase.items)[number], variant: "row" | "card") => {
                  const furKind = canonicalFur(item.rawMaterial.name, furIdx)?.name ?? null;
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
                    subtitle: [item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера", [ruGradeLabel(item.grade), item.color].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
                    fields: [
                      { label: "Кол-во", value: `${formatQty(item.quantity.toString())} ${UNIT_LABELS[item.rawMaterial.unit]}` },
                      { label: hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС", value: formatCurrency(item.unitPrice.toString(), purchase.currency) },
                      { label: "НДС", value: `${item.vatRate.toString()}% · ${vatPeriodLabel(purchase.orderDate)}` },
                      ...(hasPlan ? [{ label: <VatLabel key="unit-label" base="Себестоимость ед." />, value: unitNode ?? "—" }] : []),
                      { label: <VatLabel key="total-label" base={hasPlan ? "Всего, ₽" : `Сумма${isForeignCurrency ? ", RUB" : ""}`} />, value: totalNode, strong: true },
                    ],
                    details: customFields.map((f) => ({ label: f.name, value: formatExtra(f.type, readExtra(item.extra)[f.id]) || "—" })),
                    // То же, что в ячейках десктопной строки: пометка о ручной правке, «Править расчёт».
                    extra: planInfo ? (
                      <div key="extra" className="flex flex-col items-start gap-1.5">
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
                        lotId: item.lotId ?? undefined,
                        version: rowVersion(item, PURCHASE_ITEM_V),
                      }}
                    >
                      <Td>{furKind ? <Link href={`/lots/fur/${encodeURIComponent(furKind)}`} className="text-blue-700 hover:underline" title="Вид меха: все лоты и аукционы">{item.rawMaterial.name}</Link> : item.rawMaterial.name}</Td>
                      <Td>{item.lotId && item.lotNumber ? <Link href={`/analytics/raw/lot/${item.lotId}`} className="text-blue-700 hover:underline" title="Карточка лота: куплено, использовано, остаток, ТЗ">{item.lotNumber}</Link> : (item.lotNumber ?? "—")}</Td>
                      {showGradeColor && <Td>{[ruGradeLabel(item.grade), item.color].filter(Boolean).join(" / ") || "—"}</Td>}
                      <Td>
                        {formatQty(item.quantity.toString())} {UNIT_LABELS[item.rawMaterial.unit]}
                      </Td>
                      <Td>{formatCurrency(item.unitPrice.toString(), purchase.currency)}</Td>
                      <Td>
                        {item.vatRate.toString()}%
                        <span className={`block text-[11px] ${Number(item.vatRate) === vatRateForDate(purchase.orderDate) ? "text-neutral-400" : "text-amber-700"}`} title={Number(item.vatRate) === vatRateForDate(purchase.orderDate) ? undefined : `По дате закупки ${formatDate(purchase.orderDate)} должна быть ${vatRateForDate(purchase.orderDate)}%`}>{vatPeriodLabel(purchase.orderDate)}</span>
                      </Td>
                      {planInfo ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Money incl={planInfo.plan.unitCostInclVat} excl={planInfo.excl.toString()} />
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
                          <Td className="text-neutral-500">—</Td>
                          <Td className="whitespace-nowrap">
                            <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          </Td>
                        </>
                      ) : (
                        <Td>
                          <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          {isForeignCurrency && (
                            <span className="ml-1 text-xs text-neutral-500">
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

  // «Как считается» — расчёт себестоимости внутри блока «Из чего сложилась цена единицы» (свёрнуто).
  const calcHow = planItems.length > 0 ? (
    <details className="rounded-md border border-neutral-200">
      <summary className="cursor-pointer px-2 py-1.5 text-sm text-neutral-700">Как считается <span className="text-xs text-neutral-500">· {planItems.length} поз. · справочно</span></summary>
      <div className="border-t border-neutral-100 p-2">
          <div className="flex flex-col gap-2">
            <InfoHint label="О расчёте себестоимости" wide>
                Себестоимость единицы в таблице позиций — предварительный расчёт из расчётного листа. При приёме на склад она
                переходит в лот, а расходы закупки (блок «Расходы») добавляются сверху пропорционально стоимости лотов. 4% сюда не входит: оно добавляется только при списании в ТЗ.
              </InfoHint>
            
            <div className="flex items-center gap-1 text-xs text-neutral-600">
              {statusEditable ? "Править: «Править расчёт» в строке позиции" : "Расчёт закрыт для правок"}
              <InfoHint wide label="Кто и как правит расчёт">
                <p>
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
              </InfoHint>
            </div>
            {canEditPlan && (
              <CostPlanRateForm
                key={purchase.exchangeRate.toString()}
                purchaseId={id}
                currency={purchase.currency}
                exchangeRate={purchase.exchangeRate.toString()}
                orderDate={purchase.orderDate.toISOString().slice(0, 10)}
              />
            )}
          </div>
      </div>
    </details>
  ) : null;

  return (
    <ItemRowShared value={{ colorOptions, canAddColor, materials: allMaterials, currency: purchase.currency }}>
    <div className="flex flex-col gap-4">
      <IntegrityBanner kind="purchase" id={purchase.id} />
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Закупки", href: "/purchases" }, { label: purchase.number }]} />
      <div className="flex items-start justify-between">
        <div>
          {/* «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Закупка З-… О закупке». */}
          <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Закупка {purchase.number}</h1>
          <ChatLink type="Purchase" id={purchase.id} role={session.user.role} label={purchase.supplier?.name?.includes("Веллмех") ? "Запросить у Веллмеха" : undefined} />
            <InfoHint label="О закупке" wide>
              <p>Позиции сырья и подкладки, расходы закупки, оплаты и документы. Дата заказа {formatDate(purchase.orderDate)} — по ней закупка попадает в общий фильтр года.</p>
            </InfoHint>
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-neutral-500">
            <span>{formatDate(purchase.orderDate)}</span>
            <span aria-hidden>·</span>
            <span>
              поставщик{" "}
              <Link href={`/suppliers/${purchase.supplierId}`} className="text-blue-700 hover:underline" title="Карточка поставщика">{purchase.supplier.name}</Link>
            </span>
            {purchase.auctionSession ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  партия{" "}
                  {batchName ? (
                    <Link href={`/lots?auction=${encodeURIComponent(batchName)}`} className="text-blue-700 hover:underline" title="Аукцион-партия: все закупки и лоты партии">{purchase.auctionSession}</Link>
                  ) : (
                    purchase.auctionSession
                  )}
                </span>
              </>
            ) : null}
            {[
              purchase.invoiceNumber ? `счёт № ${purchase.invoiceNumber}${purchase.invoiceDate ? ` от ${formatDate(purchase.invoiceDate)}` : ""}` : purchase.invoiceDate ? `счёт от ${formatDate(purchase.invoiceDate)}` : null,
              purchase.transferDocument ? `УПД ${purchase.transferDocument}` : null,
              isForeignCurrency ? `валюта позиций ${purchase.currency}, курс ${Number(purchase.exchangeRate.toString()).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}` : null,
              vatRatesText ? `НДС ${vatRatesText}%` : null,
            ].filter(Boolean).map((t) => (
              <span key={t} className="flex items-center gap-x-1.5"><span aria-hidden>·</span>{t}</span>
            ))}
          </p>
          <p className="mt-1 text-sm text-neutral-700">
            Лотов <b className="tabular-nums">{purchase.items.length}</b> · шкур <b className="tabular-nums">{formatQty(purchase.items.reduce((a, i) => a + Number(i.quantity), 0).toString())}</b>
          </p>
          {rawStages.length > 0 && <RawNow stages={rawStages} className="mt-2 max-w-3xl" />}
          {sharedDocPurchases.length > 0 && (
            <p className="mt-1 text-xs text-neutral-600">
              Тот же {purchase.invoiceNumber ? `счёт № ${purchase.invoiceNumber}` : "УПД"} оформлен ещё на:{" "}
              {sharedDocPurchases.map((o, i) => (
                <span key={o.id}>
                  {i > 0 ? "; " : ""}
                  <Link href={`/purchases/${o.id}`} className="text-blue-700 hover:underline">{o.number}</Link>{" "}
                  ({formatMoney(purchaseTotalInclVat(o).toString())})
                </span>
              ))}
            </p>
          )}
          {purchase.notes && (
            <details className="mt-1 max-w-3xl text-xs text-neutral-600">
              <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">Примечание: {purchase.notes.split("\n")[0].slice(0, 110)}{purchase.notes.length > 110 || purchase.notes.includes("\n") ? "…" : ""}</summary>
              <p className="mt-1 whitespace-pre-line">{purchase.notes}</p>
            </details>
          )}
          {headerEditable && (
            <div className="mt-2 max-w-md">
              <PurchaseEditForm
                receivedMode={receivedHeader}
                action={boundUpdatePurchase}
                currencyLocked={planItems.length > 0}
                auctions={auctionRefs}
                canCreateAuction={hasRole(session.user.role, ACCESS.auctions)}
                version={rowVersion(purchase, PURCHASE_V)}
                suppliers={supplierOptions}
                defaults={{
                  supplierId: purchase.supplierId,
                  warehouseId: purchase.warehouseId,
                  currency: purchase.currency,
                  orderDate: purchase.orderDate.toISOString().slice(0, 10),
                  auctionSession: purchase.auctionSession ?? "",
                  auctionId: auctionIdDefault,
                  invoiceNumber: purchase.invoiceNumber ?? "",
                  invoiceDate: purchase.invoiceDate ? purchase.invoiceDate.toISOString().slice(0, 10) : "",
                  transferDocument: purchase.transferDocument ?? "",
                  notes: purchase.notes ?? "",
                }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
        {canEditRole && purchase.status !== "CANCELLED" && <PaymentFormButton label="+ Оплата" preset={{ side: "supplier", purchaseId: id }} />}
        <PurchaseActions
          purchaseId={id}
          status={purchase.status}
          canReceive={canReceive}
          canCancel={canEditRole}
          hasCostPlan={planItems.length > 0}
          cancelBlocker={purchase.status === "RECEIVED" ? await purchaseCancelBlocker(prisma, session.user.organizationId, id) : null}
        />
        </div>
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

      <WidgetRow id="purchase" title="Закупка — итоги" headerEnd={<Link href={auctionPay ? `/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block` : "/payments"} className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
        <SummaryCard
          label={<VatLabel base="Всего, ₽" />}
          value={<Money incl={grandTotalRub} excl={itemsTotalExclVatRub.add(expensesTotalExclVat)} />}
          note={`сырьё ${formatMoney(goodsExclVatRub.toString())}${extraExclVat.isZero() ? "" : ` · расходы без НДС ${formatMoney(extraExclVat.toString())}`} · НДС ${formatMoney(vatTotal.toString())}${isForeignCurrency ? ` · позиции ${formatCurrency(itemsTotal.toString(), purchase.currency)}` : ""}`}
          emphasis
        />
        {auctionPay ? (
          <>
            <SummaryCard
              label={
                <Link href={`/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block`} className="inline-block text-blue-600 hover:underline max-md:py-2" title={`Оплаты ведутся по партии «${auctionPay.name}» целиком`}>
                  Оплачено
                </Link>
              }
              value={auctionPay.paid.greaterThan(0.005) ? formatMoney(auctionPay.paid.toString()) : "—"}
              note={`по партии «${auctionPay.name}» из ${formatMoney(auctionPay.total.toString())}`}
            />
            <SummaryCard
              label="Остаток"
              value={isRoundingRest(auctionPay.remaining.toNumber(), auctionPay.total.toNumber()) ? "оплачено" : auctionPay.remaining.lessThan(-0.005) ? `Переплата ${formatMoney(auctionPay.remaining.abs().toString())}` : formatMoney(auctionPay.remaining.abs().lessThan(0.005) ? "0" : auctionPay.remaining.toString())}
              note={isRoundingRest(auctionPay.remaining.toNumber(), auctionPay.total.toNumber()) ? roundingRestHint(auctionPay.remaining.toNumber()) : auctionPay.planned.greaterThan(0) ? `по партии, запланировано ${formatMoney(auctionPay.planned.toString())}` : "по партии"}
              warn={auctionPay.remaining.greaterThan(0) && !isRoundingRest(auctionPay.remaining.toNumber(), auctionPay.total.toNumber())}
            />
          </>
        ) : (
          <>
            <SummaryCard label="Оплачено" note="по закупке" value={formatMoney(grandTotalRub.sub(balanceDue).toString())} />
            <SummaryCard label="Остаток" note={isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber()) ? roundingRestHint(balanceDue.toNumber()) : "по закупке"} value={isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber()) ? "оплачено" : balanceDue.lessThan(-OVERPAY_FROM) ? `Переплата ${formatMoney(balanceDue.abs().toString())}` : formatMoney(balanceDue.toString())} warn={balanceDue.greaterThan(0) && !isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber())} />
          </>
        )}
      </div>
      </WidgetRow>

      {(() => {
        if (!calcPayload || !calcRow) return null;
        const inv = (purchase.invoiceNumber ?? "").trim();
        const st = buildStatement(calcPayload, calcAll(calcPayload), inv ? (r) => (r.invoice ?? "").trim() === inv : undefined);
        if (st.lots.length === 0) return null;
        return (
          <StatementBlock
            st={st}
            source={`выдержка из расчёта Веллмеха «${calcRow.title}»${inv ? `, счёт ${inv}` : ""}`}
            action={<span className="flex flex-wrap items-center gap-3 text-sm"><Link href={`/supplier/auction-calcs/${calcRow.id}`} className="inline-flex min-h-11 items-center text-blue-700 underline md:min-h-0">Открыть расчёт</Link>{editable && <a href="#items" className="inline-flex min-h-11 items-center text-blue-700 underline md:min-h-0">Править расчёт лотов</a>}</span>}
          />
        );
      })()}

      <Card id="items" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Позиции ({purchase.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editable && (
            <>
              <div className="flex flex-wrap gap-2">
                <CreateDialog label="+ Позиция" title="Новая позиция закупки" variant="outline" wide>
                  <PurchaseItemForm purchaseId={id} materials={allMaterials} currency={purchase.currency} colorOptions={colorOptions} canAddColor={canAddColor} purchaseDate={purchase.orderDate.toISOString().slice(0, 10)} />
                </CreateDialog>
                <CreateDialog label="Вставить из Excel" title="Вставить позиции из Excel" variant="outline" wide>
                  <BulkItemForm
                    purchaseId={id}
                    materialNames={allMaterials.map((m) => m.name)}
                    existingLotNumbers={existingLots.map((l) => l.lotNumber as string)}
                    currency={purchase.currency}
                    purchaseDate={purchase.orderDate.toISOString().slice(0, 10)}
                  />
                </CreateDialog>
              </div>
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
                  <SortTh path={`/purchases/${id}`} sp={sp} k="material" cur={itemSort} label="Материал" />
                  <SortTh path={`/purchases/${id}`} sp={sp} k="lot" cur={itemSort} label="Лот" />
                  {showGradeColor && <Th>Сорт / цвет</Th>}
                  <SortTh path={`/purchases/${id}`} sp={sp} k="qty" cur={itemSort} label="Кол-во" />
                  <SortTh path={`/purchases/${id}`} sp={sp} k="price" cur={itemSort} label={hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС"} />
                  <Th>НДС</Th>
                  {hasPlan ? (
                    <>
                      <Th>
                        Себестоимость единицы
                        <InfoHint label="Из чего складывается себестоимость единицы">
                          Из расчётного листа: цена, сборы, выделка, транспорт, брокерский %, НДС.
                        </InfoHint>
                      </Th>
                      <Th>Всего, ₽</Th>
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
                    <Td colSpan={itemColSpan} className="py-6 text-center text-neutral-500">
                      Позиций пока нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
              }
            >
              {purchase.items.map((item) => itemRow(item, "card"))}
              {purchase.items.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">Позиций пока нет</p>}
            </ResponsiveRows>
          </details>
        </CardContent>
      </Card>


      {(() => {
        // Как образовалась цена единицы: расчётный лист лота (цена, курс, сборы, выделка, перевозка, комиссия, НДС) и итог в рублях.
        type BItem = { label: string; value: number };
        const breakdownOf = (item: (typeof purchase.items)[number]): BItem[] => {
          const raw = (item.lot?.costBreakdown ?? (item.costPlan as { costBreakdown?: unknown } | null)?.costBreakdown) as { items?: BItem[] } | null | undefined;
          return Array.isArray(raw?.items) ? raw!.items! : [];
        };
        const rows = purchase.items
          .map((item) => {
            const plan = item.costPlan as { unitCostInclVat?: string } | null;
            const unit = item.lot ? item.lot.unitCost : plan?.unitCostInclVat != null ? new Decimal(plan.unitCostInclVat) : null;
            return { item, unit, qty: item.lot ? item.lot.quantityReceived : item.quantity, items: breakdownOf(item) };
          })
          .filter((r) => r.unit != null);
        if (rows.length === 0) return calcHow ? <Card><CardHeader><CardTitle>Из чего сложилась цена единицы</CardTitle></CardHeader><CardContent>{calcHow}</CardContent></Card> : null;
        const num = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v);
        const totalAll = rows.reduce((a, r) => a.add(r.unit!.mul(r.qty)), new Decimal(0));
        return (
          <Card>
            <CardHeader>
              <CardTitle>Из чего сложилась цена единицы</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <div className="hidden grid-cols-[1fr_6rem_9rem_9rem] gap-2 px-2 pb-1 text-xs text-neutral-500 sm:grid">
                <span>Лот</span><span className="text-right">Кол-во</span><span className="text-right">Цена за ед., ₽ с НДС</span><span className="text-right">Всего, ₽</span>
              </div>
              {rows.map(({ item, unit, qty, items }) => (
                <details key={item.id} className="rounded-md border border-neutral-200">
                  <summary className="grid cursor-pointer grid-cols-2 gap-x-2 gap-y-0.5 px-2 py-1.5 text-sm sm:grid-cols-[1fr_6rem_9rem_9rem]">
                    <span className="col-span-2 sm:col-span-1">
                      <span className="font-medium">{item.rawMaterial.name}</span>{" "}
                      <span className="ml-1 text-xs text-neutral-500">{item.lotNumber ? `лот ${item.lotNumber}` : "лот без номера"}</span>
                    </span>
                    <span className="text-right tabular-nums">{formatQty(qty.toString())} {UNIT_LABELS[item.rawMaterial.unit] ?? ""}</span>
                    <span className="text-right font-medium tabular-nums">{formatMoney(unit!.toFixed(2))}</span>
                    <span className="col-span-2 text-right tabular-nums sm:col-span-1">{formatMoney(unit!.mul(qty).toFixed(2))}</span>
                  </summary>
                  <div className="border-t border-neutral-100 px-2 py-2 text-sm">
                    {items.length === 0 ? (
                      <p className="text-neutral-500">Расчётного листа по лоту нет: цена внесена как есть — {formatMoney(item.unitPrice.toFixed(2))} за ед. без НДС, НДС {item.vatRate.toString()}%.</p>
                    ) : (
                      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 sm:max-w-xl">
                        {items.map((b, i) => (
                          <div key={i} className="contents">
                            <dt className="text-neutral-600">{b.label}</dt>
                            <dd className="text-right tabular-nums">{num(b.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <p className="mt-2 text-xs text-neutral-500">Итоговая цена за единицу в рублях с НДС: <b className="text-neutral-800">{formatMoney(unit!.toFixed(2))}</b> × {formatQty(qty.toString())} = {formatMoney(unit!.mul(qty).toFixed(2))}</p>
                  </div>
                </details>
              ))}
              <div className="row-total mt-1 flex justify-between px-2 py-2 text-sm">
                <span><TotalLabel extra="по лотам" /></span>
                <span className="tabular-nums">{formatMoney(totalAll.toFixed(2))}</span>
              </div>
              {calcHow}
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle>Расходы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && (
            <div>
              <CreateDialog label="+ Расход" title="Новый расход по закупке" variant="outline">
                <PurchaseExpenseForm purchaseId={id} categories={expenseCategories} />
              </CreateDialog>
            </div>
          )}
          {purchase.expenses.length > 0 && (
            <ResponsiveRows
              table={
            <Table>
              <Thead>
                <Tr>
                  <Th>Статья</Th>
                  <Th>Описание</Th>
                  <Th>Без НДС, ₽</Th>
                  <Th>НДС</Th>
                  <Th>Сумма, ₽</Th>
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
                        <div className="flex items-center gap-1">
                          {expenseEdit(e)}
                          <form
                            action={async () => {
                              "use server";
                              await boundRemoveExpense(e.id);
                            }}
                          >
                            <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." />
                          </form>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
                {purchase.expenses.length > 1 && (
                  <Tr className="row-total">
                    <Td colSpan={2}><TotalLabel unit="₽" /></Td>
                    <Td>{formatMoney(expensesTotalExclVat.toString())}</Td>
                    <Td />
                    <Td><Money incl={expensesTotalInclVat} excl={expensesTotalExclVat} /></Td>
                    {editable && <Td />}
                  </Tr>
                )}
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
                      <div className="flex items-center gap-2">
                        {expenseEdit(e)}
                        <form
                          action={async () => {
                            "use server";
                            await boundRemoveExpense(e.id);
                          }}
                        >
                          <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." variant="outline" className="max-md:h-10" />
                        </form>
                      </div>
                    )
                  }
                />
              ))}
            </ResponsiveRows>
          )}
          <PlanExpenses items={purchase.items} />
          {purchase.expenses.length === 0 && planExpenseLines(purchase.items).lines.length === 0 && <p className="text-sm text-neutral-500">Расходов нет</p>}
          {!statusEditable && canEditRole && purchase.expenses.length > 0 && (
            <p className="text-xs text-neutral-500">
              Расходы принятой закупки уже распределены по лотам и здесь не правятся.
            </p>
          )}
        </CardContent>
      </Card>

      <details className="group rounded-lg border border-neutral-200 bg-white" open={rawStages.length > 0 && rawStages.length <= 3}>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold text-neutral-800"><span className="text-neutral-500 transition-transform group-open:rotate-90">▶</span>Этапы сырья{rawStages.length ? ` · ${rawStages.length}` : ""}</summary>
        <div className="border-t border-neutral-100 p-2"><RawStagesBlock stages={rawStages} purchaseId={purchase.id} author="Веллмех" showNow={false} title="Лента этапов" /></div>
      </details>

      <SourceDocs data={await loadPurchaseSourceDocs({ organizationId: session.user.organizationId, role: session.user.role }, id)} />

      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-neutral-800">Документы и оплата партии</summary>
        <div className="border-t border-neutral-100 p-3">
          <AuctionDocsPay
            organizationId={session.user.organizationId}
            purchaseId={id}
            paymentActions={Object.fromEntries(
              purchase.payments.map((p) => [
                p.id,
                canEditRole ? (
                  <div key={p.id} className="flex flex-wrap gap-2">
                    {payEdit(p)}
                    <PaymentDeleteButton
                      amountLabel={formatMoney(p.amount.toString())}
                      action={async () => {
                        "use server";
                        await removePurchasePayment(id, p.id);
                      }}
                    />
                  </div>
                ) : null,
              ]),
            )}
          />
        </div>
      </details>

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
    <div className={TILE_BOX}>
      <TileHead>{label}</TileHead>
      <TileValue className={"text-xl " + (warn ? "text-amber-700" : emphasis ? "text-neutral-900" : "text-neutral-700")}>{value}</TileValue>
      {note ? <TileCaption>{note}</TileCaption> : null}
    </div>
  );
}
