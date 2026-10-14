import { orderLabel } from "@/lib/order-label";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { SourceDocs } from "@/components/source-docs";
import { loadOrderSourceDocs } from "@/lib/source-docs-server";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { canEditProduction } from "@/lib/production-access";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, effectiveUsageVat, lineWith4, sumUsagesWith4, usageInput } from "@/lib/commission4";
import { InfoHint } from "@/components/info-hint";
import { vatBreakdown } from "@/lib/tz-vat";
import { UsageForm, type MaterialOption } from "./usage-form";
import { BulkUsageForm } from "./bulk-usage-form";
import { defaultCommission4 } from "@/lib/commission4-const";
import { ProductionExpenseForm } from "./expense-form";
import { ORDER_COLORS_INCLUDE, formatOrderColors, orderColors } from "@/lib/order-colors";
import { batchLabel } from "@/lib/batch-label";
import { ApplyBomButton, CompleteOrderForm, CancelOrderButton } from "./order-actions";
import { UsageRow } from "./usage-row";
import { lotOptionLabel } from "./lot-label";
import { CollapsibleRows } from "./collapsible-rows";
import { ExpenseRow } from "./expense-row";
import { WorkRow } from "./work-row";
import { OrderNav } from "./order-nav";
import { uniqueOrderCount } from "@/lib/tz-key";
import { ParamsTable, type ParamsData, type ParamsOptions } from "./params-table";
import { OrderTiles } from "./order-tiles";
import { OrderColorsEditButton } from "./edit-buttons";
import { AddMenu } from "./add-menu";
import { ACCESS, hasRole } from "@/lib/access";
import { compareModelNames } from "@/lib/model-code";
import { orderUnitsDec } from "@/lib/batch-stats";
import { getColorOptions } from "@/lib/colors";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { articleLabel } from "@/lib/article-label";
import { EditGuard } from "./edit-guard";
import { removeMaterialUsage, removeProductionExpense, updateMaterialUsage, updateProductionExpense, updateUsageVat } from "../actions";
import { TotalLabel } from "@/components/total-label";
import { allocatedCentsByOrder } from "@/lib/payment-alloc";
import { canonicalFur } from "@/lib/fur-ref";

const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const o = await prisma.productionOrder.findFirst({ where: { id, organizationId: session.user.organizationId }, select: { number: true, workOrderNumber: true } });
  return { title: o ? orderLabel(o) : "ТЗ" };
}

export default async function ProductionOrderPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const c4Mode = await getCommission4Mode();
  let c4 = c4Suffix(c4Mode);

  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId: orgId },
    include: {
      productModel: { include: { materials: { include: { rawMaterial: true } }, categoryRef: true } },
      rawWarehouse: true,
      // finishedWarehouse не показываем: склад один, его выбор из интерфейса убран (колонка в БД остаётся).
      client: true,
      batch: { select: { id: true, number: true } },
      season: { select: { id: true, code: true } },
      ...ORDER_COLORS_INCLUDE,
      attrs: { select: { attr: { select: { name: true } } } },
      materialUsages: {
        include: { rawMaterial: true, lot: { include: { attrs: { select: { attr: { select: { name: true } } } }, purchase: { select: { id: true, number: true } } } } },
        orderBy: { date: "asc" },
      },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
    },
  });
  if (!order) notFound();
  // Нет списаний с 4% (напр. ТЗ из партии 6) — подпись «(с 4%)» не ставим.
  if (!order.materialUsages.some((u) => u.commission4)) c4 = "";

  // У нескольких заказов бывает один номер ТЗ (напр. ТЗ №88 — 4 строки): в заголовке добавляем модель, чтобы карточки не были «близнецами».
  // Позиции одного ТЗ из документа (артикулы с общим номером ТЗ): «позиция 2 из 3» и ссылки на соседние.
  const siblings = order.workOrderNumber
    ? await prisma.productionOrder.findMany({
        where: { organizationId: orgId, workOrderNumber: order.workOrderNumber },
        orderBy: { number: "asc" },
        select: { id: true, number: true, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } },
      })
    : [];
  const sameTzCount = siblings.length;
  const posIndex = siblings.findIndex((x) => x.id === order.id);
  const tzBase = orderLabel({ workOrderNumber: order.workOrderNumber, number: order.number, posIndex: posIndex + 1, posCount: sameTzCount });
  const tzTitle = order.workOrderNumber && sameTzCount > 1 ? `${tzBase} · ${articleLabel(order.productModel)}` : tzBase;
  const tzPositions = sameTzCount > 1 && posIndex >= 0
    ? {
        index: posIndex + 1,
        total: sameTzCount,
        prev: posIndex > 0 ? { id: siblings[posIndex - 1].id, label: `поз. ${posIndex}/${sameTzCount} · ${articleLabel(siblings[posIndex - 1].productModel)}` } : null,
        next: posIndex < sameTzCount - 1 ? { id: siblings[posIndex + 1].id, label: `поз. ${posIndex + 2}/${sameTzCount} · ${articleLabel(siblings[posIndex + 1].productModel)}` } : null,
        all: siblings.map((x, i) => ({ id: x.id, label: `поз. ${i + 1}/${sameTzCount} · ${articleLabel(x.productModel)}`, current: x.id === order.id })),
      }
    : null;
  const tzSearch = encodeURIComponent(order.workOrderNumber ?? order.number);

  // Счётчики для ряда разделов ТЗ: записи именно по этому ТЗ (артикулу).
  const [shipmentLines, fittingCount, planCount, supplyCount, batchOrdersCount] = await Promise.all([
    prisma.shipmentLine.findMany({ where: { productionOrderId: order.id }, select: { shipmentId: true }, distinct: ["shipmentId"] }),
    prisma.fitting.count({ where: { productionOrderId: order.id } }),
    prisma.productionPlan.count({ where: { organizationId: orgId, OR: [{ modelId: order.productModelId }, { articleCode: { equals: order.productModel.name, mode: "insensitive" } }] } }),
    prisma.supplyPlanEntry.count({ where: { organizationId: orgId, productModelId: order.productModelId } }),
    order.batchId ? prisma.productionOrder.findMany({ where: { organizationId: orgId, batchId: order.batchId }, select: { number: true, workOrderNumber: true } }).then(uniqueOrderCount) : Promise.resolve(null),
  ]);
  const shipmentCount = shipmentLines.length;
  // Отгрузки, куда включена позиция: в отгрузке шт. и принято шт. (по всем этапам приёмки; ожидаемые этапы не в счёте).
  const shipInclude = await prisma.shipmentLine.findMany({
    where: { productionOrderId: order.id, shipment: { organizationId: orgId } },
    select: {
      quantity: true,
      shipment: { select: { id: true, name: true, plannedDate: true } },
      eventLines: { select: { accepted: true, event: { select: { expected: true } } } },
    },
  });
  const shipBy = new Map<string, { id: string; title: string; qty: number; accepted: number }>();
  for (const l of shipInclude) {
    const e = shipBy.get(l.shipment.id) ?? { id: l.shipment.id, title: l.shipment.name ?? `Отгрузка на ${formatDate(l.shipment.plannedDate)}`, qty: 0, accepted: 0 };
    e.qty += l.quantity;
    e.accepted += l.eventLines.reduce((a, x) => a + (x.event.expected ? 0 : (x.accepted ?? 0)), 0);
    shipBy.set(l.shipment.id, e);
  }
  const shipList = [...shipBy.values()];

  const batchOptions = (
    await prisma.productionBatch.findMany({
      where: { organizationId: orgId },
      orderBy: { number: "asc" },
      select: { id: true, number: true, year: true, orders: { select: { workOrderDate: true, endDate: true, startDate: true } } },
    })
  )
    // Пустые партии без ТЗ («Партия 15 · пусто») в выборе не показываем — кроме текущей партии этого ТЗ.
    .filter((b) => b.orders.length > 0 || b.id === order.batchId)
    .map((b) => ({ id: b.id, number: b.number, label: batchLabel(b.number, b.year, b.orders) }));

  const open = order.status === "PLANNED" || order.status === "IN_PROGRESS";
  // canEdit: the role may change ТЗ at all (OWNER/ADMIN/TECHNOLOGIST).
  // canWrite: то же право; статус ТЗ больше не ограничивает правку.
  const canEdit = canEditProduction(session.user.role);
  const colorOptions = canEdit ? await getColorOptions(orgId) : [];
  const cancelled = order.status === "CANCELLED";
  // Любое ТЗ правится в любом статусе (у отменённого и завершённого — тот же набор действий; завершённое спрашивает подтверждение).
  const canWrite = canEdit;

  // Списания и расходы правятся при любом статусе (исправление ошибки в завершённом ТЗ — норма, см. syncCompletedOrderCost).
  // allLots (без фильтра по остатку) нужен только выпадающему списку правки: свой лот списания часто выбран целиком.
  const [availableLots, expenseCategories, models, warehouses, clients, categoryRefs, furRefs, articleTzCount] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId: orgId, warehouseId: order.rawWarehouseId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true },
      orderBy: { receivedDate: "asc" },
    }),
    prisma.expenseCategory.findMany({ where: { organizationId: orgId, kind: "PRODUCTION", isActive: true }, orderBy: { name: "asc" } }),
    prisma.productModel.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, category: true, salesCode: true, salesName: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    canEdit ? prisma.categoryRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, group: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    canEdit ? prisma.furRef.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.productionOrder.count({ where: { organizationId: orgId, productModelId: order.productModelId } }),
  ]);

  // Текущие модель/клиент могли быть деактивированы — добавляем их в списки, иначе выбор молча подменится при сохранении.
  const modelOptions = (models.some((m) => m.id === order.productModelId)
    ? models
    : [{ id: order.productModelId, name: order.productModel.name, category: order.productModel.category, salesCode: order.productModel.salesCode, salesName: order.productModel.salesName }, ...models]
  ).sort((a, b) => compareModelNames(a.name, b.name));
  const clientOptions = order.clientId && !clients.some((c) => c.id === order.clientId) ? [{ id: order.client!.id, name: order.client!.name }, ...clients] : clients;

  // Сами лоты в разметку не кладём: выпадающие списки подгружают их, когда их открывают (lot-catalog-action.ts).
  // Для форм «Списать» нужны только материалы, у которых есть доступные лоты.
  const materialsOf = (isLining: boolean): MaterialOption[] => {
    const seen = new Map<string, MaterialOption>();
    for (const l of availableLots) {
      if ((l.rawMaterial.unit === "M") !== isLining || seen.has(l.rawMaterialId)) continue;
      seen.set(l.rawMaterialId, { id: l.rawMaterialId, name: l.rawMaterial.name, unit: l.rawMaterial.unit });
    }
    return Array.from(seen.values());
  };
  const furMaterials = materialsOf(false);
  const liningMaterials = materialsOf(true);
  const furUsages = order.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
  const liningUsages = order.materialUsages.filter((u) => u.rawMaterial.unit === "M");
  // Строки подкладки в расчёте показываем, только если она есть в списаниях, указана в ТЗ или входит в состав модели.
  const showLining = liningUsages.length > 0 || (order.lining ?? "").trim() !== "" || order.productModel.materials.some((m) => m.rawMaterial.unit === "M");

  // Режим «С 4%»: надбавка считается при показе (БД хранит «без 4%»); только сырьё и подкладка со списаний с commission4 = true, работа и расходы не облагаются.
  const furSum = sumUsagesWith4(furUsages, c4Mode);
  const liningSum = sumUsagesWith4(liningUsages, c4Mode);
  const materialCost = furSum.incl.add(liningSum.incl);
  const materialCostExcl = furSum.excl.add(liningSum.excl);
  // У расходов нет НДС (в схеме не ведётся) — в обоих режимах одна сумма.
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const projectedTotal = materialCost.add(expenseCost);
  const projectedTotalExclVat = materialCostExcl.add(expenseCost);
  // Ставки НДС лотов в списаниях (20% / 22% / смешанные): суммы построчно, по ставке каждого лота.
  const vatB = vatBreakdown(order.materialUsages, c4Mode);

  const producedOrPlanned = orderUnitsDec(order);
  const clientRevenue = order.clientWorkPricePerUnit ? order.clientWorkPricePerUnit.mul(producedOrPlanned) : null;

  // Оплата работы: разнесено на этот ТЗ (PaymentAllocation, без отменённых платежей) против работы ТЗ.
  const paidCents = (await allocatedCentsByOrder(prisma, orgId, [order.id])).get(order.id) ?? 0;
  const workCents = clientRevenue ? Math.round(clientRevenue.toNumber() * 100) : 0;
  const payRemainCents = workCents - paidCents;
  const payLink = `/payments?tab=clients${order.batch ? `&batch=${order.batch.number}` : ""}`;

  // Виды меха ТЗ для проверки лота при списании: ручной вид, материал и артикул ТЗ (по частям «соболь; норка»).
  const expectedFur = Array.from(
    new Set(
      [order.furTypeOverride, order.materialDescription, order.productModel.name]
        .flatMap((t) => (t ?? "").split(/[;,+/]| и /))
        .map((t) => canonicalFur(t)?.name)
        .filter((x): x is string => !!x),
    ),
  );

  // Состав себестоимости этого ТЗ — те же строки и суммы, что в окне «Стоимость производства» на Главной (отменённое ТЗ в Главную не входит).
  const compositionOrders = cancelled ? [] : await loadOrdersDrill(orgId, "all", c4Mode, { ids: new Set([order.id]) });
  const drill = compositionOrders[0] ?? null;
  // Шкуры подрядчика не списаны в ТЗ, но входят в себестоимость Главной — показываем отдельной строкой расчёта.
  const hidesIncl = drill?.hI ?? 0;
  const hidesExcl = drill?.hE ?? 0;

  const boundRemoveUsage = removeMaterialUsage.bind(null, id);
  const boundRemoveExpense = removeProductionExpense.bind(null, id);
  const boundUpdateUsage = updateMaterialUsage.bind(null, id);
  const boundUpdateUsageVat = updateUsageVat.bind(null, id);
  const boundUpdateExpense = updateProductionExpense.bind(null, id);
  const modelLocked = order.materialUsages.length > 0 || order.producedQuantity.greaterThan(0);

  const usageRows = (list: typeof order.materialUsages, isLining: boolean) =>
    list.map((u) => {
      const line = lineWith4(usageInput(u), c4Mode);
      const qty = u.quantity;
      return (
        <UsageRow
          key={u.id}
          usage={{
            id: u.id,
            lotLabel: lotOptionLabel({ lotNumber: u.lot.lotNumber, grade: u.lot.grade, color: u.lot.color, rawMaterialName: u.rawMaterial.name, quantityRemaining: u.lot.quantityRemaining.toString(), unitCost: u.lot.unitCost.toString(), vatRate: u.lot.vatRate.toString() }),
            rawMaterialName: u.rawMaterial.name,
            lotId: u.lotId,
            lotNumber: u.lot.lotNumber,
            purchaseId: u.lot.purchase?.id ?? null,
            purchaseNumber: u.lot.purchase?.number ?? null,
            quantity: qty.toString(),
            unit: u.rawMaterial.unit,
            unitIncl: qty.isZero() ? "0" : line.incl.div(qty).toString(),
            unitExcl: qty.isZero() ? "0" : line.excl.div(qty).toString(),
            lotCostExclVat: lineWith4({ incl: u.lot.materialCostExclVat, excl: u.lot.materialCostExclVat, commission4: u.commission4 }, c4Mode).excl.toString(),
            c4Mode,
            commission4: u.commission4,
            lotVatRate: u.lot.vatRate.toString(),
            vatRate: String(effectiveUsageVat(u)),
            vatOwn: u.vatRate != null,
            totalCost: line.incl.toString(),
            totalCostExclVat: line.excl.toString(),
            costBreakdown: u.lot.costBreakdown,
            lotUnitCostExcl: lotUnitCostExclVat(u.lot).toString(),
            lotUnitCostIncl: u.lot.unitCost.toString(),
          }}
          orderId={id}
          lining={isLining}
          readOnly={!canEdit}
          updateAction={boundUpdateUsage.bind(null, u.id)}
          vatAction={boundUpdateUsageVat.bind(null, u.id)}
          removeAction={async () => {
            "use server";
            await boundRemoveUsage(u.id);
          }}
        />
      );
    });

  const expenseRows = order.expenses.map((e) => (
    <ExpenseRow
      key={e.id}
      orderId={id}
      expense={{ id: e.id, categoryId: e.categoryId, categoryName: e.category.name, amount: e.amount.toString(), description: e.description }}
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
  const sumQty = (us: typeof furUsages) => us.reduce((a, u) => a.add(u.quantity), new Decimal(0));
  const furQty = sumQty(furUsages);
  const liningQty = sumQty(liningUsages);
  const furCostExcl = furSum.excl;
  const liningCost = liningSum.incl;
  const liningCostExcl = liningSum.excl;
  const workAmount = clientRevenue ?? new Decimal(0);
  const hidesI = new Decimal(hidesIncl.toFixed(2));
  const hidesE = new Decimal(hidesExcl.toFixed(2));
  const grandIncl = projectedTotal.add(workAmount).add(hidesI);
  const grandExcl = projectedTotalExclVat.add(workAmount).add(hidesE);
  const unitDiv = producedOrPlanned.isZero() ? null : producedOrPlanned;

  // Две цифры для средневзвешенных: «с 4%» и «без 4%» (не зависят от переключателя): те же функции, что у Главной.
  const furOn = sumUsagesWith4(furUsages, "on");
  const liningOn = sumUsagesWith4(liningUsages, "on");

  const cancelBlockedReason = order.materialUsages.length > 0 ? "Нельзя отменить ТЗ со списаниями — сначала удалите списания" : undefined;
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const colorList = orderColors(order);
  const paramsData: ParamsData = {
    orderId: id,
    canEdit,
    status: order.status,
    modelLocked,
    number: order.number,
    workOrderNumber: order.workOrderNumber ?? "",
    workOrderDate: iso(order.workOrderDate),
    contractNumber: order.contractNumber ?? "",
    startDate: iso(order.startDate),
    endDate: order.endDate ? formatDate(order.endDate) : "",
    endDateIso: iso(order.endDate),
    seasonCode: order.season?.code ?? null,
    batchId: order.batchId ?? "",
    batchNumber: order.batch?.number ?? null,
    articleName: order.productModel.name,
    clientId: order.clientId ?? "",
    productModelId: order.productModelId,
    category: drill?.cat ?? order.productModel.category ?? "",
    categoryRefId: order.productModel.categoryRefId ?? "",
    group: drill?.grp ?? order.productModel.categoryRef?.group ?? "",
    articleTzCount,
    furType: drill?.fur ?? order.furTypeOverride ?? "",
    furTypeOverride: order.furTypeOverride ?? "",
    materialDescription: order.materialDescription ?? "",
    lining: order.lining ?? "",
    colorRefId: order.colorRefId ?? "",
    colorText: colorList.length > 0 ? formatOrderColors(colorList) : "",
    size: order.size ?? "",
    plannedQuantity: order.plannedQuantity.toString(),
    producedQuantity: order.producedQuantity.toString(),
    clientWorkPricePerUnit: order.clientWorkPricePerUnit?.toString() ?? "",
    workSum: clientRevenue ? clientRevenue.toFixed(2) : null,
    rawWarehouseId: order.rawWarehouseId,
    notes: order.notes ?? "",
    vat: vatB.rows.map((r) => ({ rate: r.rate, lines: r.lines, incl: r.incl.toFixed(2), excl: r.excl.toFixed(2) })),
    colorRows: order.colors.length > 0 ? order.colors.map((c) => ({ name: c.colorRef.name, quantity: c.quantity != null ? String(c.quantity) : "", sizes: c.sizes ?? "" })) : [],
  };
  const paramsOptions: ParamsOptions = {
    models: modelOptions.map((m) => ({ value: m.id, label: articleLabel(m) })),
    clients: clientOptions.map((c) => ({ value: c.id, label: c.name })),
    batches: batchOptions.map((b) => ({ value: b.id, label: b.label })),
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    colors: colorOptions,
    canAddColor: hasRole(session.user.role, ACCESS.colors),
    categories: categoryRefs,
    furs: furRefs.map((f) => f.name),
    canAddCategory: hasRole(session.user.role, ACCESS.categories),
    canAddFur: hasRole(session.user.role, ACCESS.furRefs),
  };

  return (
    <EditGuard completed={order.status === "COMPLETED"}>
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "ТЗ", href: "/production" },
          ...(order.batch ? [{ label: "Партии пошива", href: "/production/batches" }, { label: `Партия ${order.batch.number}`, href: `/production/batches/${order.batch.number}` }] : []),
          { label: tzBase },
        ]}
      />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/production" className="rounded px-1.5 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" title="К списку ТЗ" aria-label="Назад к списку ТЗ">
            ←
          </Link>
          <h1 className="text-xl font-semibold" title={`Внутренний номер заказа ${order.number}`}>{tzTitle}</h1>
          <div className="ml-auto" />
          <ChatLink type="ProductionOrder" id={order.id} role={session.user.role} label="Написать Веллмеху" />
          <Link href={`/production/${id}/print`} className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Печатная форма ТЗ (приложение к договору) — A4, печать или PDF">
            Печать / PDF
          </Link>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Ещё: документы, оплаты, история, Word, цвета, отмена ТЗ" aria-label="Ещё: документы, оплаты, история, Word, цвета, отмена ТЗ">⋯</summary>
            <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded-md border border-neutral-200 bg-white p-2 shadow">
              <a href="#drive" className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Перейти к блоку «Документы-основания» внизу этой страницы">Документы-основания ↓</a>
              <Link href={`/documents?q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Документы ТЗ: приложение, акты, счета — в разделе «Документы»">Документы</Link>
              {order.client && <Link href={payLink} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title={order.batch ? `Оплаты от заказчика по партии ${order.batch.number} (фильтра по одному ТЗ в оплатах нет); оплачено именно на это ТЗ — в строке «Оплата работы» ниже` : "Оплаты от заказчика, разнесение по ТЗ"}>Оплаты заказчика</Link>}
              <Link href={`/verify?tab=orders&q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Подтверждение ТЗ в разделе «Контроль → Подтвердить»">Подтверждение</Link>
              <Link href={`/history?model=ProductionOrder&q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="История изменений и комментарии — в разделе «Контроль»">История</Link>
              <a href={`/api/production/${id}/docx`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Скачать печатную форму ТЗ в формате Word">
                Скачать .docx
              </a>
              {open && canEdit && (
                <div className="border-t border-neutral-100 pt-2">
                  <CancelOrderButton orderId={id} blockedReason={cancelBlockedReason} />
                </div>
              )}
              {canEdit && (
                <OrderColorsEditButton
                  key={order.colors.map((c) => `${c.colorRefId}:${c.quantity ?? ""}:${c.sizes ?? ""}`).join("|")}
                  orderId={id}
                  colors={colorOptions.map((c) => ({ id: c.id, name: c.name }))}
                  rows={order.colors.map((c) => ({ colorRefId: c.colorRefId, quantity: c.quantity != null ? String(c.quantity) : "", sizes: c.sizes ?? "" }))}
                />
              )}
            </div>
          </details>
          {open && canEdit && (
            <CompleteOrderForm
              orderId={id}
              tzLabel={orderLabel({ workOrderNumber: order.workOrderNumber, number: order.number })}
              hasUsages={order.materialUsages.length > 0}
              plannedQuantity={order.plannedQuantity.toString()}
              costs={{ material: furOn.incl.add(liningOn.incl).sub(furOn.extraIncl).sub(liningOn.extraIncl).toFixed(2), extra4: furOn.extraIncl.add(liningOn.extraIncl).toFixed(2), expenses: expenseCost.toFixed(2), workPerUnit: order.clientWorkPricePerUnit?.toString() ?? "" }}
            />
          )}
        </div>
        <div className="mt-2">
          <OrderNav
            tzLabel={tzTitle}
            positions={tzPositions}
            batchNumber={order.batch?.number ?? null}
            batchCount={batchOrdersCount}
            shipments={shipmentCount}
            fittings={fittingCount}
            planCount={planCount}
            supplyCount={supplyCount}
            search={order.workOrderNumber ?? order.number}
            article={order.productModel.name}
          />
        </div>
      </div>

      {drill ? (
        <OrderTiles
          order={drill}
          c4={c4Mode}
          completed={order.status === "COMPLETED"}
          noUsages={order.materialUsages.length === 0}
        />
      ) : cancelled ? (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-600">ТЗ отменено — в Главную, «Изделия» и сводки не входит; списания, расходы и параметры по-прежнему можно править.</p>
      ) : null}

      {workCents > 0 || paidCents > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm" id="work-pay">
          <h2 className="block-title">Оплата работы</h2>
          <span>работа <b className="font-medium tabular-nums">{formatMoney((workCents / 100).toFixed(2))}</b></span>
          <span>оплачено <b className="font-medium tabular-nums">{formatMoney((paidCents / 100).toFixed(2))}</b></span>
          <span>{payRemainCents < -1 ? "оплачено сверх работы" : "остаток"} <b className={"font-medium tabular-nums " + (payRemainCents > 1 ? "text-amber-700" : "")}>{formatMoney((Math.abs(payRemainCents) / 100).toFixed(2))}</b></span>
          {order.client ? <Link href={payLink} className="ml-auto text-xs text-blue-700 hover:underline" title="Оплаты заказчика: в оплатах нет фильтра по одному ТЗ, открывается список по партии этого ТЗ">{order.batch ? `оплаты партии ${order.batch.number} →` : "оплаты заказчиков →"}</Link> : null}
        </div>
      ) : null}

      <ParamsTable d={paramsData} o={paramsOptions} />

      <section aria-label="Расчёт" id="calc" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="block-title">Расчёт</h2>
          <InfoHint label="Как читать: Расчёт" wide>
            <p><b>Откуда и куда:</b> лот → цена и ставка НДС из закупки (ссылки «лот» и «закупка» в строке), списание уменьшает остаток лота и растёт в «Сырьё»; статья расхода — из справочника «Статьи расходов»; итог идёт на Главную, в «Изделия» и в «Партии». </p><p className="mt-1">Что списано в ТЗ и как из этого складывается себестоимость. Лот, количество и «4%» в строке, статья, описание и сумма расхода, цена работы правятся по месту (Enter или уход курсора сохраняет); итоги пересчитываются.</p>
            <p className="mt-1">Цена за единицу — свойство лота из закупки (менять в закупке). Ставка НДС по умолчанию берётся из лота (22%, у закупок 2025 г. — 20%); в этом ТЗ её можно исправить по месту (поле «НДС, %»; пусто или как в лоте — без изменения): сумма с НДС остаётся, пересчитывается разбивка «без НДС / НДС». {c4Mode === "on" ? "Режим «С 4%»: к меху и подкладке добавлено 4% (цена × 1,04); работа и расходы не облагаются." : "Режим «Без 4%»: цена лота как в закупке."}</p>
            <p className="mt-1">Режим «С НДС / Без НДС» — общий переключатель шапки.</p>
          </InfoHint>
        </div>

        {canWrite && (
          <AddMenu
            fur={<UsageForm orderId={id} materials={furMaterials} defaultCommission4={defaultCommission4(order.batch?.number)} expectedFur={expectedFur} />}
            lining={<UsageForm orderId={id} materials={liningMaterials} defaultCommission4={defaultCommission4(order.batch?.number)} />}
            expense={<ProductionExpenseForm orderId={id} categories={expenseCategories} />}
            bulk={<BulkUsageForm orderId={id} defaultCommission4={defaultCommission4(order.batch?.number)} />}
            bom={
              order.productModel.materials.length > 0 ? (
                <div className="flex flex-col gap-3">
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
                          <Td>{formatQty(line.quantityPerUnit.toString())} {UNIT_LABELS[line.rawMaterial.unit]}</Td>
                          <Td>{formatQty(line.quantityPerUnit.mul(order.plannedQuantity).toString())} {UNIT_LABELS[line.rawMaterial.unit]}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                  <div>
                    <ApplyBomButton orderId={id} />
                  </div>
                </div>
              ) : undefined
            }
          />
        )}
        <Table className="min-w-[860px]">
          <Thead>
            <Tr>
              <Th>Лот / статья</Th>
              <Th>Материал / описание</Th>
              <Th className="text-right">Кол-во</Th>
              <Th className="text-right" unit="₽">Цена за ед. без НДС{c4}</Th>
              <Th className="text-right" unit="%">НДС</Th>
              <Th className="text-center" unit="₽">4%</Th>
              <Th className="text-right" unit="₽">Сумма с НДС{c4}</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            <SectionRow>Мех</SectionRow>
            <CollapsibleRows rows={usageRows(furUsages, false)} colSpan={8} what="списания меха" />
            {furUsages.length === 0 && <EmptyRow>Мех ещё не списан</EmptyRow>}
            <TotalRow label={<TotalLabel note={`мех${c4} · ${formatQty(furQty.toString())} шт.`} />} value={<Money incl={furCost} excl={furCostExcl} />} />

            {showLining && (
              <>
                <SectionRow>Подкладка</SectionRow>
                <CollapsibleRows rows={usageRows(liningUsages, true)} colSpan={8} what="списания подкладки" />
                {liningUsages.length === 0 && <EmptyRow>Подкладка не списана</EmptyRow>}
                <TotalRow label={<TotalLabel note={`подкладка${c4} · ${formatQty(liningQty.toString())} м`} />} value={<Money incl={liningCost} excl={liningCostExcl} />} />
              </>
            )}

            <SectionRow>Доп. расходы</SectionRow>
            <CollapsibleRows rows={expenseRows} colSpan={8} what="расходы" />
            {order.expenses.length === 0 && <EmptyRow>Доп. расходов нет</EmptyRow>}
            <TotalRow label={<TotalLabel note="доп. расходы" />} value={expenseCost.isZero() ? "—" : formatMoney(expenseCost.toString())} />

            {!hidesI.isZero() && (
              <>
                <SectionRow>Шкуры подрядчика</SectionRow>
                <Tr>
                  <Td colSpan={6} className="text-xs text-neutral-500">Оплачены в составе счетов за пошив, в ТЗ не списаны — входят в себестоимость, как на Главной</Td>
                  <Td className="whitespace-nowrap text-right font-medium tabular-nums"><Money incl={hidesI} excl={hidesE} /></Td>
                  <Td />
                </Tr>
              </>
            )}

            <SectionRow>Работа</SectionRow>
            <WorkRow
              orderId={id}
              price={order.clientWorkPricePerUnit?.toString() ?? ""}
              qty={producedOrPlanned.toString()}
              qtyLabel={order.status === "COMPLETED" ? "факт" : "план"}
              sum={clientRevenue ? clientRevenue.toFixed(2) : null}
              readOnly={!canEdit}
            />

            <TotalRow strong label={<TotalLabel note={`себестоимость ТЗ${c4}${unitDiv ? ` · на 1 изд. ` : ""}`} />} extra={unitDiv ? <Money incl={grandIncl.div(unitDiv)} excl={grandExcl.div(unitDiv)} /> : null} value={<Money incl={grandIncl} excl={grandExcl} />} />
          </Tbody>
        </Table>


        {cancelled && <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-600">ТЗ отменено — в Главную и сводки не входит; правки сохраняются, но на итоги не влияют.</p>}
      </section>

      {shipList.length > 0 && (
        <CollapsibleBlock title="Отгрузки" summary={`${shipList.length} · в отгрузках ${formatQty(shipList.reduce((a, x) => a + x.qty, 0))} шт.`} autoOpen={false} id="shipments">
          <ul className="flex flex-col divide-y divide-neutral-100 text-sm">
            {shipList.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
                <Link href={`/shipments/${x.id}`} className="font-medium hover:underline">{x.title}</Link>
                <span className="tabular-nums text-neutral-600">в отгрузке {formatQty(x.qty)} шт. · принято {formatQty(x.accepted)} шт.</span>
              </li>
            ))}
          </ul>
        </CollapsibleBlock>
      )}

      <div id="drive" className="scroll-mt-4">
        <SourceDocs data={await loadOrderSourceDocs({ organizationId: orgId, role: session.user.role }, order.id)} />
      </div>
    </div>
    </EditGuard>
  );
}

function SectionRow({ children }: { children: React.ReactNode }) {
  return (
    <Tr className="bg-neutral-50/80">
      <Td colSpan={8} className="py-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {children}
      </Td>
    </Tr>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <Tr>
      <Td colSpan={8} className="py-2 text-center text-neutral-500">
        {children}
      </Td>
    </Tr>
  );
}

function TotalRow({ label, value, extra, strong }: { label: React.ReactNode; value: React.ReactNode; extra?: React.ReactNode; strong?: boolean }) {
  return (
    <Tr className="row-total" data-strong={strong ? "1" : undefined}>
      <Td colSpan={6} className="text-right">
        {label}
        {extra ? <span className="ml-1 tabular-nums">{extra}</span> : null}
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">{value}</Td>
      <Td />
    </Tr>
  );
}
