import { OrderDocsPay } from "../docs-pay";
import { VerifyBlock } from "../../verify/verify-block";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { canEditProduction } from "@/lib/production-access";
import { RemovePaymentButton } from "./remove-payment-button";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, lineWith4, sumUsagesWith4, usageInput, base4AndExtra } from "@/lib/commission4";
import { InfoHint } from "@/components/info-hint";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { UsageForm, type LotOption } from "./usage-form";
import { BulkUsageForm } from "./bulk-usage-form";
import { defaultCommission4 } from "@/lib/commission4-const";
import { ProductionExpenseForm } from "./expense-form";
import { ApplyBomButton, CompleteOrderForm, CancelOrderButton } from "./order-actions";
import { RetailPriceForm } from "./retail-price-form";
import { ProductionPaymentForm } from "./payment-form";
import { OpenDetailsLink } from "./open-details-link";
import { ProducedQuantityForm } from "./produced-quantity-form";
import { UsageRow, type EditableLotOption } from "./usage-row";
import { ExpenseRow } from "./expense-row";
import { OrderEditForm } from "./order-edit-form";
import { ShipmentsBlock } from "./shipments-block";
import { FittingsBlock } from "./fittings-block";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Section, SectionNav } from "./section";
import { compareModelNames } from "@/lib/model-code";
import { batchOrderInclude, batchTotals } from "@/lib/batch-stats";
import Link from "next/link";
import { DriveDocuments } from "@/components/drive-documents";
import { toDriveView } from "@/lib/drive-docs-server";
import { ACCESS, hasRole } from "@/lib/access";
import { getColorOptions } from "@/lib/colors";
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

const MARGIN_HINT =
  "Оплата за работу заказчику минус себестоимость меха, подкладки и расходов. Это не прибыль: если сырьё заказчик оплачивает отдельно (давальческое), вычитать его из оплаты за пошив нельзя. Следует переключателю С НДС / Без НДС.";
const MARKUP_HINT =
  "Наценка = розничная цена / себестоимость единицы. Не путать со строкой «Работа минус себестоимость» в расчёте.";

/** «6 6 6 7 7 7 8 8» и «46, 46, 50» -> «6×3, 7×3, 8×2» и «46×2, 50». Нестандартную запись не трогаем. */
function collapseSizes(raw: string): string {
  const tokens = raw.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.every((t) => /^[\dA-Za-zА-Яа-я.\-/]{1,8}$/.test(t))) return raw;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === tokens.length) return raw;
  return Array.from(counts, ([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(", ");
}

/** «№ 1605 от 16.05.2025», «Договор подряда № 1605 от 16.05.2025 г.» -> «Договор подряда № 1605 от 16.05.2025». */
function contractLabel(raw: string): string {
  let c = raw.replace(/^\s*договор(\s+подряда)?\s*/i, "").replace(/\s*г\.?\s*$/i, "").trim();
  if (!c) return raw;
  if (!/^№/.test(c)) c = `№ ${c}`;
  return `Договор подряда ${c}`;
}

export default async function ProductionOrderPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  let c4 = c4Suffix(c4Mode);

  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      productModel: { include: { materials: { include: { rawMaterial: true } } } },
      rawWarehouse: true,
      finishedWarehouse: true,
      client: true,
      batch: { select: { id: true, number: true } },
      materialUsages: { include: { rawMaterial: true, lot: true }, orderBy: { date: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
      paymentAllocations: {
        include: { productionPayment: { include: { orders: { include: { productionOrder: true } } } } },
        orderBy: { productionPayment: { paidAt: "asc" } },
      },
    },
  });
  if (!order) notFound();
  // Нет списаний с 4% (напр. ТЗ из партии 6) — подпись «(с 4%)» не ставим.
  if (!order.materialUsages.some((u) => u.commission4)) c4 = "";

  const payments = order.paymentAllocations.map((a) => a.productionPayment);
  // У нескольких заказов бывает один номер ТЗ (напр. ТЗ №88 — 4 строки): в заголовке добавляем модель, чтобы карточки не были «близнецами».
  const sameTzCount = order.workOrderNumber
    ? await prisma.productionOrder.count({ where: { organizationId: session.user.organizationId, workOrderNumber: order.workOrderNumber } })
    : 0;
  const tzTitle = order.workOrderNumber
    ? `ТЗ №${order.workOrderNumber}${sameTzCount > 1 ? ` · ${order.productModel.name}` : ""}`
    : `Заказ ${order.number}`;

  // Документы Google Drive: самого ТЗ и его оплат.
  const driveRows = await prisma.driveDocument.findMany({
    where: {
      organizationId: session.user.organizationId,
      OR: [
        { productionOrderId: order.id },
        ...(payments.length ? [{ productionPaymentId: { in: payments.map((p) => p.id) } }] : []),
      ],
    },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  const driveDocs = driveRows.map((d) => toDriveView(d, d.productionPaymentId ? "оплата" : null, session.user.role));

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

  // Оплата одна на несколько ТЗ — остаток по одному ТЗ не считаем (в БД нет суммы по ТЗ), показываем оплату по партии.
  const batchStat = order.batch
    ? batchTotals(
        await prisma.productionOrder.findMany({
          where: { batchId: order.batch.id, organizationId: session.user.organizationId },
          include: batchOrderInclude,
        }),
        c4Mode,
      )
    : null;
  const [shipmentCount, fittingCount] = await Promise.all([
    prisma.shipment.count({ where: { organizationId: session.user.organizationId, lines: { some: { productionOrderId: order.id } } } }),
    prisma.fitting.count({ where: { organizationId: session.user.organizationId, productionOrderId: order.id } }),
  ]);

  const open = order.status === "PLANNED" || order.status === "IN_PROGRESS";
  // canEdit: the role may change ТЗ at all (OWNER/ADMIN/TECHNOLOGIST).
  // canWrite: ...and the ТЗ is not cancelled (no write-offs/expenses/payments).
  const canEdit = canEditProduction(session.user.role);
  const colorOptions = canEdit ? await getColorOptions(session.user.organizationId) : [];
  const cancelled = order.status === "CANCELLED";
  const canWrite = canEdit && !cancelled;

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
  const modelOptions = (models.some((m) => m.id === order.productModelId)
    ? models
    : [{ id: order.productModelId, name: order.productModel.name }, ...models]
  ).sort((a, b) => compareModelNames(a.name, b.name));
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
  // Строки подкладки в расчёте показываем, только если она есть в списаниях, указана в ТЗ или входит в состав модели.
  const showLining =
    liningUsages.length > 0 ||
    (order.lining ?? "").trim() !== "" ||
    order.productModel.materials.some((m) => m.rawMaterial.unit === "M");

  // Режим «С 4%»: надбавка считается здесь при показе (БД хранит «без 4%»);
  // только сырьё и подкладка со списаний с commission4 = true, работа и
  // расходы не облагаются.
  const furSum = sumUsagesWith4(furUsages, c4Mode);
  const liningSum = sumUsagesWith4(liningUsages, c4Mode);
  const materialCost = furSum.incl.add(liningSum.incl);
  const extra4Incl = furSum.extraIncl.add(liningSum.extraIncl);
  // materialUsages.totalCost = quantity * lot.unitCost, and lot.unitCost is
  // VAT-inclusive by definition (see schema) — so materialCost above is
  // incl-VAT. Its excl-VAT counterpart uses the same lines' own excl-VAT lot
  // cost (materialCostExclVat + expenseCostExclVat, exact per the schema
  // comment on the latter). expenseCost has no excl-VAT counterpart:
  // ProductionExpense has no vatRate field at all (no VAT tracked for
  // production expenses in this schema) — shown the same in both modes.
  const materialCostExcl = furSum.excl.add(liningSum.excl);
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const projectedTotal = materialCost.add(expenseCost);
  const projectedTotalExclVat = materialCostExcl.add(expenseCost);
  const status = STATUS_LABELS[order.status];
  // Расшифровка 4% по этому ТЗ: сырьё и подкладка × 4% (не зависит от переключателя).
  const c4Calc = base4AndExtra(order.materialUsages);
  const c4HasData = order.materialUsages.length > 0;
  // Ставки НДС лотов в списаниях (20% / 22% / смешанные): суммы построчно, по ставке каждого лота.
  const vatB = vatBreakdown(order.materialUsages, c4Mode);

  const producedOrPlanned = order.producedQuantity.greaterThan(0) ? order.producedQuantity : order.plannedQuantity;
  const clientRevenue = order.clientWorkPricePerUnit
    ? order.clientWorkPricePerUnit.mul(producedOrPlanned)
    : null;

  // unitCost is fixed once the order completes; while in progress, estimate
  // from costs booked so far so retail pricing can be planned ahead of time.
  // Снимок unitCost хранится «без 4%» — в режиме «С 4%» добавляем надбавку на единицу.
  const estimatedUnitCost = order.unitCost
    ? producedOrPlanned.isZero()
      ? order.unitCost
      : order.unitCost.add(extra4Incl.div(producedOrPlanned))
    : producedOrPlanned.isZero()
      ? new Decimal(0)
      : projectedTotal.div(producedOrPlanned);
  // No excl-VAT snapshot column exists for unitCost, so this is always
  // computed live from the same lines behind estimatedUnitCost above —
  // exact even once the order is COMPLETED, since materialUsages/expenses
  // are themselves fixed historical records by then.
  const estimatedUnitCostExclVat = producedOrPlanned.isZero() ? new Decimal(0) : projectedTotalExclVat.div(producedOrPlanned);
  const markup =
    order.retailPrice && estimatedUnitCost.greaterThan(0) ? order.retailPrice.div(estimatedUnitCost) : null;

  const marginHint = <InfoHint label="Что такое «Работа минус себестоимость»" wide>{MARGIN_HINT}</InfoHint>;
  const c4Info = (
    <>
      <Mode4Badge mode={c4Mode} />
      <C4Hint
        mode={c4Mode}
        base={c4HasData ? c4Calc.base.toFixed(2) : null}
        extra={c4HasData ? c4Calc.extra.toFixed(2) : null}
        excluded={c4Calc.excluded.toFixed(2)}
        total={projectedTotal.toFixed(2)}
        title="Себестоимость и 4%"
      >
        {c4HasData && (
          <>
            <p className="mt-1">
              Мех {formatMoney(furUsages.reduce((a, u) => a.add(u.totalCost), new Decimal(0)).toFixed(2))}, подкладка{" "}
              {formatMoney(liningUsages.reduce((a, u) => a.add(u.totalCost), new Decimal(0)).toFixed(2))}, расходы {formatMoney(expenseCost.toFixed(2))} (без 4%).
            </p>
            {c4Calc.extra.isZero() && <p className="mt-1">В списаниях этого ТЗ 4% не применяется (например, партия 6, лоскут), поэтому цифры в обоих режимах равны.</p>}
          </>
        )}
      </C4Hint>
    </>
  );
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

  const usageRows = (list: typeof order.materialUsages, lots: EditableLotOption[], variant: "row" | "card" = "row") =>
    list.map((u) => (
      <UsageRow
        key={u.id}
        variant={variant}
        usage={{
          id: u.id,
          date: u.date,
          rawMaterialName: u.rawMaterial.name,
          lotId: u.lotId,
          lotNumber: u.lot.lotNumber,
          quantity: u.quantity.toString(),
          unit: u.rawMaterial.unit,
          lotCostExclVat: lineWith4(
            { incl: u.lot.materialCostExclVat, excl: u.lot.materialCostExclVat, commission4: u.commission4 },
            c4Mode,
          ).excl.toString(),
          c4Mode,
          commission4: u.commission4,
          lotVatRate: u.lot.vatRate.toString(),
          totalCost: lineWith4(usageInput(u), c4Mode).incl.toString(),
          totalCostExclVat: lineWith4(usageInput(u), c4Mode).excl.toString(),
          costBreakdown: u.lot.costBreakdown,
          lotUnitCostExcl: lotUnitCostExclVat(u.lot).toString(),
          lotUnitCostIncl: u.lot.unitCost.toString(),
        }}
        lots={lots}
        readOnly={!canEdit}
        updateAction={boundUpdateUsage.bind(null, u.id)}
        removeAction={async () => {
          "use server";
          await boundRemoveUsage(u.id);
        }}
      />
    ));

  const expenseRows = (variant: "row" | "card") =>
    order.expenses.map((e) => (
      <ExpenseRow
        key={e.id}
        variant={variant}
        expense={{
          id: e.id,
          categoryId: e.categoryId,
          categoryName: e.category.name,
          amount: e.amount.toString(),
          description: e.description,
        }}
        categories={expenseCategories}
        readOnly={!canEdit}
        updateAction={boundUpdateExpense.bind(null, e.id)}
        removeAction={async () => {
          "use server";
          await boundRemoveExpense(e.id);
        }}
      />
    ));

  const furCost = furSum.incl;
  const furCostExcl = furSum.excl;
  const liningCost = liningSum.incl;
  const liningCostExcl = liningSum.excl;
  const margin = clientRevenue ? clientRevenue.sub(projectedTotal) : null;
  // Excl-VAT margin: same work revenue minus the excl-VAT cost, matching the toggle.
  const marginExcl = clientRevenue ? clientRevenue.sub(projectedTotalExclVat) : null;
  const cancelBlockedReason =
    order.materialUsages.length > 0 ? "Нельзя отменить ТЗ со списаниями — сначала удалите списания" : undefined;
  const qtyLabel =
    order.status === "COMPLETED" || order.producedQuantity.greaterThan(0)
      ? `план ${formatQty(order.plannedQuantity.toString())} / факт ${formatQty(order.producedQuantity.toString())} шт.`
      : `план ${formatQty(order.plannedQuantity.toString())} шт.`;

  const clean = (v: string | null | undefined) => (v ?? "").trim();
  const headerParts = [
    order.productModel.name,
    clean(order.color) && clean(order.color),
    clean(order.size) && `разм. ${collapseSizes(clean(order.size))}`,
    qtyLabel,
    order.startDate && `с ${formatDate(order.startDate)}`,
    order.client && <span key="client" className="font-medium text-neutral-700">{order.client.name}</span>,
    order.client && clean(order.contractNumber) && contractLabel(clean(order.contractNumber)),
    order.client && order.workOrderDate && `ТЗ от ${formatDate(order.workOrderDate)}`,
    clean(order.materialDescription) && `Материал: ${clean(order.materialDescription)}`,
    clean(order.lining) && `Подкладка: ${clean(order.lining)}`,
  ].filter((x) => Boolean(x)) as React.ReactNode[];
  const navItems = [
    { id: "calc", label: "К расчёту" },
    ...(order.client ? [{ id: "pay", label: "К оплатам" }] : []),
    { id: "ship", label: "К отгрузкам" },
    { id: "drive", label: "К документам" },
    { id: "finish", label: "К цене и завершению" },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            {tzTitle}
          </h1>
          {order.workOrderNumber && (
            <span className="text-sm text-neutral-500">заказ {order.number}</span>
          )}
          <Badge variant={status.variant}>{status.label}</Badge>
          <TzVatBadge b={vatB} />
          {order.batch && (
            <Link href={`/production/batches/${order.batch.number}`} className="inline-block text-sm text-blue-600 hover:underline max-md:py-2">
              Партия {order.batch.number}
            </Link>
          )}
          <div className="ml-auto" />
          <Link href={`/production/${id}/print`} className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Печатная форма ТЗ (приложение к договору) — A4, печать или PDF">
            Печать / PDF
          </Link>
          <a href={`/api/production/${id}/docx`} className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Скачать печатную форму ТЗ в формате Word">
            Скачать .docx
          </a>
          {canEdit && <OrderEditForm
            action={boundUpdateOrder}
            models={modelOptions}
            warehouses={warehouses}
            clients={clientOptions}
            modelLocked={modelLocked}
            colorOptions={colorOptions}
            canAddColor={hasRole(session.user.role, ACCESS.colors)}
            defaults={{
              productModelId: order.productModelId,
              productModelName: order.productModel.name,
              rawWarehouseId: order.rawWarehouseId,
              finishedWarehouseId: order.finishedWarehouseId,
              plannedQuantity: order.plannedQuantity.toString(),
              color: order.color ?? "",
              colorRefId: order.colorRefId ?? "",
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
          />}
          {open && canEdit && (
            <CompleteOrderForm
              orderId={id}
              hasUsages={order.materialUsages.length > 0}
              plannedQuantity={order.plannedQuantity.toString()}
              warehouseName={order.finishedWarehouse.name}
            />
          )}
          {open && canEdit && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100" title="Ещё">
                ⋯
              </summary>
              <div className="absolute right-0 z-10 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow">
                <CancelOrderButton orderId={id} blockedReason={cancelBlockedReason} />
              </div>
            </details>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {headerParts.map((part, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {part}
            </span>
          ))}
        </p>
      </div>

      <SectionNav items={navItems} />

      <Section id="calc" title="Расчёт и списание" defaultOpenMobile>
      <Card>
        <CardHeader className="hidden sm:flex">
          <CardTitle>Расчёт и списание</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-sm lg:hidden">
            <SummaryLine label={`Итого мех${c4}`} value={<Money incl={furCost} excl={furCostExcl} />} />
            {showLining && <SummaryLine label={`Итого подкладка${c4}`} value={<Money incl={liningCost} excl={liningCostExcl} />} />}
            <SummaryLine label="Итого расходы" value={formatMoney(expenseCost.toString())} />
            <SummaryLine
              label={<>{`Итого себестоимость${c4}`}{c4Info}</>}
              value={<Money incl={projectedTotal} excl={projectedTotalExclVat} />}
              strong
            />
            <SummaryLine
              label={(order.unitCost ? "Себестоимость за единицу" : "Себестоимость за единицу (оценка)") + c4}
              value={<Money incl={estimatedUnitCost} excl={estimatedUnitCostExclVat} />}
              strong
            />
            {clientRevenue && margin && (
              <>
                <SummaryLine label="Работа для заказчика" value={formatMoney(clientRevenue.toString())} />
                <SummaryLine
                  label={<><VatLabel base={`Работа минус себестоимость${c4}`} />{marginHint}</>}
                  value={<Money incl={margin} excl={marginExcl} />}
                  className={margin.lessThan(0) ? "text-amber-600" : undefined}
                />
              </>
            )}
          </dl>
          <ResponsiveRows
            table={
          <Table>
            <Thead>
              <Tr>
                <Th>Лот</Th>
                <Th>Материал</Th>
                <Th>Кол-во</Th>
                <Th>Цена за ед. без НДС{c4}</Th>
                <Th>НДС</Th>
                <Th className="text-right">
                  Сумма с НДС{c4}
                  <InfoHint label="Как считается сумма по лоту" align="right">
                    <p>Сумма по лоту = количество × цена лота (с НДС); переключатель НДС меняет отображение.</p>
                    <p className="mt-1">
                      {c4Mode === "on"
                        ? "Режим «С 4%»: к сырью и подкладке добавлено 4% (цена × 1,04) — цена за единицу и сумма уже с 4%. Работа и расходы не облагаются."
                        : "Режим «Без 4%»: цена лота как в закупке. Переключатель «С 4%» добавит 4% к сырью и подкладке."}
                    </p>
                  </InfoHint>
                </Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              <SectionRow>Мех</SectionRow>
              {usageRows(furUsages, allFurLots)}
              {furUsages.length === 0 && <EmptyRow>Мех ещё не списан</EmptyRow>}
              <TotalRow label={`Итого мех${c4}`} value={<Money incl={furCost} excl={furCostExcl} />} />

              {showLining && (
                <>
                  <SectionRow>Подкладка</SectionRow>
                  {usageRows(liningUsages, allLiningLots)}
                  {liningUsages.length === 0 && (
                    <EmptyRow>
                      Подкладка не указана
                      {canWrite && (
                        <>
                          {" — "}
                          <OpenDetailsLink targetId="add-lining">добавить</OpenDetailsLink>
                        </>
                      )}
                    </EmptyRow>
                  )}
                  <TotalRow label={`Итого подкладка${c4}`} value={<Money incl={liningCost} excl={liningCostExcl} />} />
                </>
              )}

              <SectionRow>Расходы</SectionRow>
              {expenseRows("row")}
              <TotalRow label="Итого расходы" value={formatMoney(expenseCost.toString())} />

              <TotalRow
                label={<>{`Итого себестоимость${c4}`}{c4Info}</>}
                value={<Money incl={projectedTotal} excl={projectedTotalExclVat} />}
                strong
              />
              <TotalRow
                label={(order.unitCost ? "Себестоимость за единицу" : "Себестоимость за единицу (оценка)") + c4}
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
                    label={<><VatLabel base={`Работа минус себестоимость${c4}`} />{marginHint}</>}
                    value={<Money incl={margin} excl={marginExcl} />}
                    className={margin.lessThan(0) ? "text-amber-600" : undefined}
                  />
                </>
              ) : (
                <EmptyRow>Цена работы для заказчика не указана</EmptyRow>
              )}
            </Tbody>
          </Table>
            }
          >
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Мех</div>
            {usageRows(furUsages, allFurLots, "card")}
            {furUsages.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Мех ещё не списан</p>}
            {showLining && (
              <>
                <div className="mt-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Подкладка</div>
                {usageRows(liningUsages, allLiningLots, "card")}
                {liningUsages.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Подкладка не указана</p>}
              </>
            )}
            <div className="mt-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Расходы</div>
            {expenseRows("card")}
            {order.expenses.length === 0 && <p className="py-2 text-center text-sm text-neutral-400">Расходов нет</p>}
          </ResponsiveRows>

          <div className="flex flex-col gap-2 text-sm">
            {cancelled && (
              <p className="rounded-md bg-neutral-100 px-3 py-2 text-neutral-600">
                ТЗ отменено — списывать сырьё, добавлять расходы и оплаты нельзя.
              </p>
            )}
            {canWrite && (
              <>
            <details>
              <summary className="cursor-pointer text-neutral-600 max-md:py-2">+ лот</summary>
              <div className="mt-2">
                <UsageForm orderId={id} lots={furLots} defaultCommission4={defaultCommission4(order.batch?.number)} />
              </div>
            </details>
            <BulkUsageForm orderId={id} defaultCommission4={defaultCommission4(order.batch?.number)} />
            <details id="add-lining">
              <summary className="cursor-pointer text-neutral-600 max-md:py-2">+ подкладка</summary>
              <div className="mt-2">
                <UsageForm orderId={id} lots={liningLots} defaultCommission4={defaultCommission4(order.batch?.number)} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-neutral-600 max-md:py-2">+ расход</summary>
              <div className="mt-2">
                <ProductionExpenseForm orderId={id} categories={expenseCategories} />
              </div>
            </details>
              </>
            )}
            {canWrite && order.productModel.materials.length > 0 && (
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
        </CardContent>
      </Card>
      </Section>

      <Section id="verify" title="Подтверждение ТЗ" defaultOpenMobile>
        <VerifyBlock kind="order" id={id} title="Подтверждение ТЗ" />
      </Section>

      <Section id="docpay" title="Документы и оплата" defaultOpenMobile>
        <OrderDocsPay orderId={id} />
      </Section>

      {order.client && (
        <Section id="pay" title="Оплаты от заказчика">
        <Card>
          <CardHeader className="hidden sm:flex">
            <CardTitle>Оплаты от заказчика</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {clientRevenue && (
              <p className="text-sm text-neutral-600">
                К оплате <span className="font-medium text-neutral-900">{formatMoney(clientRevenue.toString())}</span>
                {hasSharedPayments ? (
                  batchStat && order.batch ? (
                    <>
                      {" · "}
                      <Link href={`/production/batches/${order.batch.number}`} className="text-blue-600 hover:underline">
                        оплачено по партии {order.batch.number}:{" "}
                        <span className="font-medium">{formatMoney(batchStat.paid.toString())}</span> из{" "}
                        <span className="font-medium">{formatMoney(batchStat.work.toString())}</span>
                      </Link>
                    </>
                  ) : (
                    <>
                      {" · "}оплачено общими платежами: <span className="font-medium text-neutral-900">{formatMoney(paidTotal.toString())}</span>
                    </>
                  )
                ) : (
                  <>
                    {" · оплачено "}
                    <span className="font-medium text-neutral-900">{formatMoney(paidTotal.toString())}</span>
                    {" · "}
                    {balanceDue!.lessThan(-0.005) ? "переплата " : "остаток к оплате "}
                    <span className={`font-semibold ${balanceDue!.greaterThan(0) ? "text-amber-600" : "text-neutral-900"}`}>
                      {formatMoney(balanceDue!.abs().toString())}
                    </span>
                  </>
                )}
                {hasSharedPayments && (
                  <span className="block text-xs text-neutral-500">
                    Платежей на несколько ТЗ: {sharedPayments.length} — сумма по ТЗ не разбивается, остаток по одному ТЗ не считается.
                  </span>
                )}
              </p>
            )}
            {canWrite && <ProductionPaymentForm orderId={id} orders={paymentOrders} />}
            <ResponsiveRows
              table={
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
                        {canEdit && (
                          <RemovePaymentButton
                            summary={`${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)}`}
                            action={async () => {
                              "use server";
                              await boundRemovePayment(p.id);
                            }}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
                {payments.length === 0 && <EmptyRow cols={7}>Оплат пока нет</EmptyRow>}
              </Tbody>
            </Table>
              }
            >
              {payments.map((p) => {
                const otherOrders = p.orders.map((a) => a.productionOrder).filter((o) => o.id !== id);
                return (
                  <RowCard
                    key={p.id}
                    title={formatMoney(p.amount.toString())}
                    subtitle={`${formatDate(p.paidAt)} · ${PAYMENT_TYPE_LABELS[p.paymentType] ?? p.paymentType}`}
                    fields={[
                      { label: "Способ", value: PAYMENT_METHOD_LABELS[p.method] ?? p.method },
                      { label: "Также покрывает", value: otherOrders.length > 0 ? otherOrders.map((o) => o.number).join(", ") : "—" },
                      ...(p.notes ? [{ label: "Заметка", value: p.notes }] : []),
                    ]}
                    extra={
                      canEdit && (
                        <RemovePaymentButton
                          summary={`${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)}`}
                          action={async () => {
                            "use server";
                            await boundRemovePayment(p.id);
                          }}
                        />
                      )
                    }
                  />
                );
              })}
              {payments.length === 0 && <p className="py-3 text-center text-sm text-neutral-400">Оплат пока нет</p>}
            </ResponsiveRows>
          </CardContent>
        </Card>
        </Section>
      )}

      <Section id="ship" title="Отгрузки и примерки">
        {shipmentCount === 0 && fittingCount === 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
            <span>Отгрузки (0) · Примерки (0)</span>
            {canWrite && (
              <>
                <span>·</span>
                <Link href={`/shipments/new?order=${id}`} className="inline-block text-neutral-700 underline underline-offset-2 hover:text-neutral-900 max-md:py-2">
                  + Отгрузка
                </Link>
                <Link href={`/fittings/new?order=${id}`} className="inline-block text-neutral-700 underline underline-offset-2 hover:text-neutral-900 max-md:py-2">
                  + Примерка
                </Link>
              </>
            )}
          </p>
        ) : (
          <>
            <ShipmentsBlock orderId={id} organizationId={session.user.organizationId} plannedQuantity={order.plannedQuantity.toString()} />
            <FittingsBlock orderId={id} organizationId={session.user.organizationId} search={order.workOrderNumber ?? order.number} />
          </>
        )}
      </Section>

      <Section id="drive" title="Документы">
        <Card>
          <CardContent className="pt-4">
            <DriveDocuments
              docs={driveDocs}
              title="Google Drive"
              entity="order"
              entityId={id}
              canEdit={canEdit}
              extraTargets={
                hasRole(session.user.role, ["OWNER", "ADMIN"])
                  ? payments.map((p) => ({
                      entity: "productionPayment" as const,
                      id: p.id,
                      label: `Оплата ${p.paidAt.toLocaleDateString("ru-RU", { timeZone: "UTC" })} · ${p.amount.toString()}`,
                    }))
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </Section>

      <Section id="finish" title="Завершение и цена" defaultOpenMobile>
      {canEdit && order.status === "COMPLETED" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <ProducedQuantityForm orderId={id} producedQuantity={order.producedQuantity.toString()} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-white p-3">
        {canEdit ? (
          <RetailPriceForm orderId={id} retailPrice={order.retailPrice?.toString() ?? ""} />
        ) : (
          <div className="text-sm text-neutral-600">
            Розничная цена за ед.{" "}
            <span className="font-semibold text-neutral-900">
              {order.retailPrice ? formatMoney(order.retailPrice.toString()) : "—"}
            </span>
          </div>
        )}
        <div className="text-sm text-neutral-600">
          Наценка{" "}
          <span className="font-semibold text-neutral-900">{markup ? `×${markup.toFixed(2)}` : "—"}</span>
          <InfoHint label="Как считается наценка">
            {MARKUP_HINT}
            {markup && order.retailPrice && (
              <p className="mt-1">
                Здесь: {formatMoney(order.retailPrice.toString())} ÷ {formatMoney(estimatedUnitCost.toFixed(2))} = ×{markup.toFixed(2)} ({c4Mode === "on" ? "с 4%" : "без 4%"}).
              </p>
            )}
          </InfoHint>
        </div>
      </div>
      </Section>

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

function SummaryLine({
  label,
  value,
  strong,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 px-3 py-2 ${strong ? "bg-neutral-100 font-semibold" : "font-medium"} ${className ?? ""}`}
    >
      <dt className="text-neutral-600">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  className,
  title,
}: {
  label: React.ReactNode;
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
