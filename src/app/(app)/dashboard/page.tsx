import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, lotUnitCostExclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { InclVatOnlyLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { CompactMoney } from "./compact-money";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, inYear, yearLabel, yearRange } from "@/lib/year-filter";
import { lotYear, orderYearOf, orderYearWhere } from "@/lib/year-scope";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { loadControlCounts } from "@/lib/control-counts";
import { getFurIndex } from "@/lib/fur-ref-server";
import { canonicalFur } from "@/lib/fur-ref";
import { ProductionCostTotal } from "@/components/production-cost-total";
import type { Prisma } from "@prisma/client";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, splitNone } from "@/lib/filters";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";

const ORDER_STATUS_LABELS: Record<string, string> = { PLANNED: "Запланирован", IN_PROGRESS: "В работе", COMPLETED: "Завершён", CANCELLED: "Отменён" };

// Фильтры Сводки (год — общий, из шапки). Значения берутся тем же способом, что в «Закупках», «Сырье» и «ТЗ».
const DASH_FILTERS = defineFilters({
  ...pick(["auction", "fur", "color", "batch", "client", "status", "vat"], {
    status: { allowed: Object.keys(ORDER_STATUS_LABELS) },
    batch: { pattern: /^(\d{1,6}|none)$/ },
    vat: { allowed: ["20", "22"] },
  }),
});

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export const metadata = { title: "Сводка" };


export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  // requireRole() redirects here with ?error=forbidden when a role may not do an action.
  const sp = await searchParams;
  const forbidden = sp.error === "forbidden";
  const organizationId = session.user.organizationId;
  // Общий год: закупка — по дате заказа, оплата — по дате оплаты, ТЗ — по дате ТЗ (или года партии), лот — по закупке.
  const year = await getYearFilter();
  const range = yearRange(year);
  const furIdx = await getFurIndex(organizationId);

  // ── Фильтры панели ──
  const f = parseFilters(DASH_FILTERS, sp);
  const clientSel = splitNone(f.client);
  const batchSel = splitNone(f.batch);
  const colorSel = splitNone(f.color);
  const lotFiltersOn = Boolean(f.auction.length || f.fur.length || f.color.length || f.vat.length);
  const orderFiltersOn = lotFiltersOn || Boolean(f.client.length || f.status.length || f.batch.length);
  const filtersOn = orderFiltersOn;
  const [auctionPurchaseIds, furMaterialIds, opts] = await Promise.all([
    f.auction.length ? purchaseIdsByAuction(organizationId, f.auction) : Promise.resolve(null),
    f.fur.length ? furMaterialIdsByKind(organizationId, f.fur) : Promise.resolve(null),
    getFilterOptions(organizationId, year, ["auction", "fur", "color", "batch", "client"]),
  ]);
  const NONE_ID = ["__none"];
  // Лот подходит: партия закупки, вид меха, цвет лота, ставка НДС лота.
  const lotWhere: Prisma.RawMaterialLotWhereInput = {
    ...(auctionPurchaseIds ? { purchaseId: { in: auctionPurchaseIds.length ? auctionPurchaseIds : NONE_ID } } : {}),
    ...(furMaterialIds ? { rawMaterialId: { in: furMaterialIds.length ? furMaterialIds : NONE_ID } } : {}),
    ...(f.color.length ? { OR: [...(colorSel.rest.length ? [{ colorRef: { name: { in: colorSel.rest } } }, { colorRefId: null, color: { in: colorSel.rest } }] : []), ...(colorSel.none ? [{ colorRefId: null, color: null }] : [])] } : {}),
    ...(f.vat.length ? { vatRate: { in: f.vat.map(Number) } } : {}),
  };
  // ТЗ подходит: заказчик, статус, партия производства; а при фильтрах по сырью — списан хотя бы один подходящий лот.
  const batchNums = batchSel.rest.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const orderExtra: Prisma.ProductionOrderWhereInput = {
    ...(f.client.length ? { OR: [...(clientSel.rest.length ? [{ clientId: { in: clientSel.rest } }] : []), ...(clientSel.none ? [{ clientId: null }] : [])] } : {}),
    ...(f.status.length ? { status: { in: f.status as Array<"PLANNED"> } } : {}),
    ...(f.batch.length ? { AND: [{ OR: [...(batchNums.length ? [{ batch: { number: { in: batchNums } } }] : []), ...(batchSel.none ? [{ batchId: null }] : [])] }] } : {}),
    ...(lotFiltersOn ? { materialUsages: { some: { lot: lotWhere } } } : {}),
  };
  // Закупки: партия закупки — по названию; вид меха, цвет и ставка — закупки, в которых есть такая позиция.
  const purchaseExtra: Prisma.PurchaseWhereInput = {
    ...(auctionPurchaseIds ? { id: { in: auctionPurchaseIds.length ? auctionPurchaseIds : NONE_ID } } : {}),
    ...(f.fur.length || f.color.length || f.vat.length
      ? {
          items: {
            some: {
              ...(furMaterialIds ? { rawMaterialId: { in: furMaterialIds.length ? furMaterialIds : NONE_ID } } : {}),
              ...(f.vat.length ? { vatRate: { in: f.vat.map(Number) } } : {}),
              ...(f.color.length ? { OR: [...(colorSel.rest.length ? [{ colorRef: { name: { in: colorSel.rest } } }, { colorRefId: null, color: { in: colorSel.rest } }] : []), ...(colorSel.none ? [{ colorRefId: null, color: null }] : [])] } : {}),
            },
          },
        }
      : {}),
  };

  const [
    allPurchases,
    supplierDebt,
    lowStockMaterials,
    allLots,
    materialUsedAgg,
    productionCostOrders,
    annualPurchases,
    annualSupplierPayments,
    annualProductionOrders,
    clientOrders,
    clientPaymentsAll,
    controlCounts,
  ] = await Promise.all([
    // Отменённые закупки в «Куплено сырья» не входят.
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, ...(range ? { orderDate: range } : {}), ...purchaseExtra },
      include: { items: true, expenses: true },
    }),
    // Единый расчёт «Долга поставщику» (то же число — везде, см. src/lib/supplier-debt.ts).
    loadSupplierDebt(prisma, organizationId, year),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 }, ...lotYear(year), ...lotWhere },
      include: { rawMaterial: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, ...lotYear(year), ...lotWhere },
      select: { id: true, rawMaterialId: true, quantityReceived: true, quantityRemaining: true, unitCost: true, rawMaterial: { select: { unit: true } } },
    }),
    prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId, ...(f.status.length ? {} : { status: { not: "CANCELLED" as const } }), AND: [orderYearWhere(year), orderExtra] }, ...(lotFiltersOn ? { lot: lotWhere } : {}) },
      select: {
        quantity: true,
        totalCost: true,
        commission4: true,
        rawMaterial: { select: { name: true, unit: true } },
        lot: { select: { id: true, materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
      },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId, ...(f.status.length ? {} : { status: { not: "CANCELLED" as const } }), AND: [orderYearWhere(year), orderExtra] },
      select: {
        id: true, number: true, status: true, producedQuantity: true, plannedQuantity: true, clientWorkPricePerUnit: true,
        materialCost: true, expenseCost: true, totalCost: true,
        materialUsages: { select: { quantity: true, totalCost: true, rawMaterial: { select: { name: true, unit: true } } } },
        expenses: { select: { amount: true } },
      },
    }),
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: { items: true, expenses: true },
      orderBy: { orderDate: "asc" },
    }),
    prisma.payment.findMany({
      where: { organizationId, status: "COMPLETED" },
      select: { amount: true, paidAt: true },
      orderBy: { paidAt: "asc" },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        producedQuantity: true, workOrderDate: true, endDate: true, startDate: true, createdAt: true,
        batch: { select: { year: true } },
        materialUsages: { select: { totalCost: true } },
      },
    }),
    // ТЗ производства под заказчика (давальческая схема) — заказы без
    // clientId — это собственное производство, не подлежит взысканию.
    prisma.productionOrder.findMany({
      where: { organizationId, AND: [{ clientId: { not: null } }, orderExtra, orderYearWhere(year)], ...(f.status.length ? {} : { status: { not: "CANCELLED" as const } }) },
      include: { client: true },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId },
      include: { orders: { select: { productionOrderId: true } } },
    }),
    // «Задачи N»: то же число, что в «Контроле» (одна функция на все страницы).
    loadControlCounts(organizationId, year).catch(() => null),
  ]);
  // Оплаты заказчиков года: привязанные к ТЗ года; без ТЗ — по дате оплаты.
  const yearOrderIds = new Set(clientOrders.map((o) => o.id));
  const clientPayments = clientPaymentsAll.filter((p) => {
    if (f.client.length && !(p.clientId && clientSel.rest.includes(p.clientId))) return false;
    if (p.orders.length > 0) return year === "all" && !orderFiltersOn ? true : p.orders.some((l) => yearOrderIds.has(l.productionOrderId));
    return year === "all" ? true : inYear(p.paidAt, year);
  });


  // Raw + finished stock value
  const rawStockValue = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(l.unitCost)),
    new Decimal(0)
  );
  const rawStockValueExclVat = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(lotUnitCostExclVat(l))),
    new Decimal(0)
  );
  // Client production debt (задолженность заказчиков): what clients owe us
  // for давальческая (ТЗ) production work. Billable amount uses
  // clientWorkPricePerUnit — the price charged to the client for the work
  // itself — the same field and "produced or, until then, planned" quantity
  // rule already used on the order detail page's own "Остаток к оплате"
  // figure (see production/[id]/page.tsx), for consistency. retailPrice is
  // a different, unrelated field (own retail channel markup, not давалец
  // billing) and is intentionally not used here. Orders without
  // clientWorkPricePerUnit set are not billable (can't invent a price) and
  // are counted separately as a caveat rather than treated as zero.
  type ClientDebt = {
    clientId: string;
    clientName: string;
    billable: Decimal;
    paid: Decimal;
    unpricedOrders: number;
    orders: number;
  };
  const clientDebtMap = new Map<string, ClientDebt>();
  for (const o of clientOrders) {
    if (!o.clientId || !o.client) continue;
    const entry = clientDebtMap.get(o.clientId) ?? {
      clientId: o.clientId,
      clientName: o.client.name,
      billable: new Decimal(0),
      paid: new Decimal(0),
      unpricedOrders: 0,
      orders: 0,
    };
    entry.orders += 1;
    if (o.clientWorkPricePerUnit) {
      const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
      entry.billable = entry.billable.add(o.clientWorkPricePerUnit.mul(qty));
    } else {
      entry.unpricedOrders += 1;
    }
    clientDebtMap.set(o.clientId, entry);
  }
  // Авансы заказчика без ТЗ (clientId есть, ни к одному ТЗ не привязаны) вычитаются из долга этого заказчика
  // наравне с остальными оплатами; оплаты без заказчика в долг не входят.
  let advancesDeducted = new Decimal(0); // авансы без ТЗ, вычтенные из долга
  let advancesNotCounted = new Decimal(0); // авансы без ТЗ, которые в долг не вошли (нет заказчика или у него нет ТЗ)
  for (const p of clientPayments) {
    const entry = p.clientId ? clientDebtMap.get(p.clientId) : undefined;
    if (entry) entry.paid = entry.paid.add(p.amount);
    if (p.orders.length === 0) {
      if (entry) advancesDeducted = advancesDeducted.add(p.amount);
      else advancesNotCounted = advancesNotCounted.add(p.amount);
    }
  }
  const clientDebts = Array.from(clientDebtMap.values())
    .map((c) => ({ ...c, balance: c.billable.sub(c.paid) }))
    .sort((a, b) => (b.balance.greaterThan(a.balance) ? 1 : -1));
  const clientDebtTotal = clientDebts.reduce((s, c) => s.add(c.balance), new Decimal(0));

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalPurchasedValueExclVat = allPurchases.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));
  // «Использовано в ТЗ» в режиме «С 4%»: +4% к строкам списаний с commission4 = true.
  // Закупки, остатки сырья и долги — всегда без 4%.
  const usedSum = sumUsagesWith4(materialUsedAgg, c4Mode);
  const totalMaterialUsedValue = usedSum.incl;
  const totalMaterialUsedValueExclVat = usedSum.excl;

  // Тотал по меховому сырью: только физически принятые лоты, подкладка отдельно.
  const rawRemainingQty = allLots.filter((l) => l.rawMaterial.unit !== "M").reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
  const liningRemainingQty = allLots.filter((l) => l.rawMaterial.unit === "M").reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));

  const furUsed = materialUsedAgg.filter((u) => u.rawMaterial.unit !== "M");
  const liningUsed = materialUsedAgg.filter((u) => u.rawMaterial.unit === "M");
  const rawInGoodsQty = furUsed.reduce((s, u) => s.add(u.quantity), new Decimal(0));
  const rawInGoodsValue = furUsed.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const liningInGoodsValue = liningUsed.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const producedGoodsQty = productionCostOrders.reduce((s, o) => s.add(o.producedQuantity), new Decimal(0));
  const productionWorkValue = productionCostOrders.reduce((s, o) => {
    if (!o.clientWorkPricePerUnit) return s;
    const q = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
    return s.add(o.clientWorkPricePerUnit.mul(q));
  }, new Decimal(0));
  const producedGoodsTotalCost = rawInGoodsValue.add(liningInGoodsValue).add(productionWorkValue);
  const producedGoodsAverageCost = producedGoodsQty.greaterThan(0) ? producedGoodsTotalCost.div(producedGoodsQty) : new Decimal(0);
  const supplierCashPaid = supplierDebt.paid.add(supplierDebt.unlinkedAdvances);

  type AnnualRow = { year: number; purchased: Decimal; supplierPaid: Decimal; produced: Decimal; materialInProduction: Decimal; clientPaid: Decimal };
  const annualMap = new Map<number, AnnualRow>();
  const annual = (y: number) => {
    const cur = annualMap.get(y) ?? { year: y, purchased: new Decimal(0), supplierPaid: new Decimal(0), produced: new Decimal(0), materialInProduction: new Decimal(0), clientPaid: new Decimal(0) };
    annualMap.set(y, cur);
    return cur;
  };
  for (const p of annualPurchases) annual(p.orderDate.getUTCFullYear()).purchased = annual(p.orderDate.getUTCFullYear()).purchased.add(purchaseTotalInclVat(p));
  for (const p of annualSupplierPayments) annual(p.paidAt.getUTCFullYear()).supplierPaid = annual(p.paidAt.getUTCFullYear()).supplierPaid.add(p.amount);
  for (const o of annualProductionOrders) {
    // Год ТЗ — по тому же правилу, что общий фильтр года: workOrderDate → endDate → startDate → год партии (src/lib/year-scope.ts).
    const row = annual(orderYearOf(o) ?? o.createdAt.getUTCFullYear());
    row.produced = row.produced.add(o.producedQuantity);
    row.materialInProduction = row.materialInProduction.add(o.materialUsages.reduce((a, u) => a.add(u.totalCost), new Decimal(0)));
  }
  for (const p of clientPaymentsAll) if (p.status === "COMPLETED") annual(p.paidAt.getUTCFullYear()).clientPaid = annual(p.paidAt.getUTCFullYear()).clientPaid.add(p.amount);
  const annualRows = Array.from(annualMap.values()).sort((a, b) => b.year - a.year);
  const furCostMap = new Map<string, { value: Decimal; qty: Decimal }>();
  const liningCostMap = new Map<string, { value: Decimal; qty: Decimal }>();
  for (const u of materialUsedAgg) {
    const map = u.rawMaterial.unit === "M" ? liningCostMap : furCostMap;
    // «Лиса красная» — вид «Лиса» (красная — цвет): в разбивке стоимости это одна строка.
    const label = u.rawMaterial.unit === "M" ? u.rawMaterial.name : canonicalFur(u.rawMaterial.name, furIdx)?.name ?? u.rawMaterial.name;
    const cur = map.get(label) ?? { value: new Decimal(0), qty: new Decimal(0) };
    cur.value = cur.value.add(u.totalCost);
    cur.qty = cur.qty.add(u.quantity);
    map.set(label, cur);
  }
  const furCostDetails = Array.from(furCostMap, ([label, v]) => ({ label, value: v.value.toNumber(), qty: v.qty.toNumber() })).sort((a,b) => b.value-a.value);
  const liningCostDetails = Array.from(liningCostMap, ([label, v]) => ({ label, value: v.value.toNumber(), qty: v.qty.toNumber() })).sort((a,b) => b.value-a.value);

  const draftPurchasedValue = allPurchases.filter((p) => p.status !== "RECEIVED").reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const receivedPurchasedValue = totalPurchasedValue.sub(draftPurchasedValue);
  // «С 4%» к остатку на складе: надбавка начисляется при списании в ТЗ (по умолчанию на сырьё и подкладку).
  const stock4Extra = c4Mode === "on" ? rawStockValue.mul(COMMISSION_RATE) : new Decimal(0);
  const stock4ExtraExcl = c4Mode === "on" ? rawStockValueExclVat.mul(COMMISSION_RATE) : new Decimal(0);
  const clientPaidTotal = clientDebts.reduce((s, c) => s.add(c.paid), new Decimal(0));
  const clientBillableTotal = clientDebts.reduce((s, c) => s.add(c.billable), new Decimal(0));
  const yl = yearLabel(year);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Сводка{year !== "all" ? <span className="ml-2 text-sm font-normal text-neutral-500">· {yl}</span> : null}</h1>
      </div>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <FilterBar
        title="Фильтры сводки"
        controls={[
          { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: opts.auction, allLabel: "Все партии" },
          { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur },
          { type: "multi", name: "color", label: "Цвет", options: opts.color, allLabel: "Все цвета", noneLabel: "Без цвета" },
          { type: "multi", name: "batch", label: "Партия производства", options: opts.batch, noneLabel: "Без партии", allLabel: "Все партии" },
          { type: "multi", name: "client", label: "Заказчик", options: opts.client, noneLabel: "Без заказчика", allLabel: "Все заказчики" },
          { type: "multi", name: "status", label: "Статус ТЗ", options: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })), allLabel: "Все статусы" },
          { type: "multi", name: "vat", label: "Ставка НДС", aliases: ["nds"], options: [{ value: "20", label: "20%" }, { value: "22", label: "22%" }], allLabel: "Любая", hint: "Ставка НДС лота" },
        ]}
        footer={
          <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] leading-4 text-neutral-500">
            Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}).
            {filtersOn
              ? " Фильтры сужают: «Закуплено», «Склад», «Выпущено», стоимость выпуска и «Долг заказчиков»; не зависят от них: «Долг поставщику», «Задачи» и «Динамика по годам»."
              : " Фильтры сужают плитки «Закуплено», «Склад», «Выпущено», стоимость выпуска и «Долг заказчиков»."}
            <InfoHint label="Что фильтруется на Сводке" wide>
              <p>Партия закупки, вид меха, цвет и ставка НДС отбирают лоты (склад, списания) и закупки, в которых есть такая позиция. Заказчик, статус и партия производства отбирают ТЗ. Ставка НДС — ставка лота.</p>
              <p className="mt-1">«Долг поставщику» (считается по закупкам и оплатам года), «Задачи» (как в «Контроле») и «Динамика по годам» от фильтров не зависят.</p>
            </InfoHint>
          </p>
        }
      />

      <section className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Ключевые показатели</div>
          <h2 className="mt-1 text-base font-semibold">Закуплено, долги, склад, выпуск и задачи</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard
            label="Закуплено"
            value={<CompactMoney incl={totalPurchasedValue.toString()} excl={totalPurchasedValueExclVat.toString()} />}
            extra={`${allPurchases.length} закупок · ${yl}`}
            href="/purchases"
          />
          <KpiCard
            label={<InclVatOnlyLabel base="Долг поставщику" />}
            hint={<SupplierDebtHint debt={supplierDebt} year={year} />}
            value={<CompactMoney incl={supplierDebt.debt.toString()} />}
            extra={`выплачено ${formatMoney(supplierCashPaid.toString())} · к оплате по УПД ${formatMoney(supplierDebt.receivedNet.toString())} · не зависит от фильтров`}
            warn={supplierDebt.debt.greaterThan(0)}
            href="/payments"
          />
          <KpiCard
            label="Склад"
            value={<CompactMoney incl={rawStockValue.toString()} excl={rawStockValueExclVat.toString()} />}
            extra={`мех ${formatQty(rawRemainingQty.toString())} шт. · подкладка ${formatQty(liningRemainingQty.toString())} м`}
            href="/lots"
          />
          <KpiCard
            label="Выпущено"
            value={`${formatQty(producedGoodsQty.toString())} шт.`}
            extra={`средняя стоимость ${formatMoney(producedGoodsAverageCost.toString())} · сырьё + работа по ТЗ`}
            href="/production"
          />
          <KpiCard
            label={<InclVatOnlyLabel base="Долг заказчиков" />}
            value={<CompactMoney incl={clientDebtTotal.toString()} />}
            extra={`работы ${formatMoney(clientBillableTotal.toString())} · оплачено ${formatMoney(clientPaidTotal.toString())}`}
            warn={clientDebtTotal.greaterThan(0)}
            href="#client-debt"
          />
          <KpiCard
            label={
              <>
                Задачи
                <InfoHint label="Задачи и фильтры">Число задач — как в «Контроле»; от фильтров Сводки не зависит.</InfoHint>
              </>
            }
            value={controlCounts ? String(controlCounts.tasks) : "—"}
            extra={controlCounts ? `ждёт проверки ${controlCounts.waiting} · не хватает документов ${controlCounts.docGaps}` : undefined}
            warn={!!controlCounts && controlCounts.tasks > 0}
            danger={!!controlCounts && controlCounts.urgent > 0}
            href="/attention"
          />
        </div>

        <ProductionCostTotal
          total={producedGoodsTotalCost.toNumber()}
          fur={rawInGoodsValue.toNumber()}
          lining={liningInGoodsValue.toNumber()}
          work={productionWorkValue.toNumber()}
          furDetails={furCostDetails}
          liningDetails={liningCostDetails}
          products={producedGoodsQty.toNumber()}
        />

        <details className="rounded-xl border border-neutral-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-neutral-50">
            <span>Динамика по годам</span>
            <span className="text-xs font-normal text-neutral-500">по умолчанию свернуто · {annualRows.length} года · не зависит от фильтров</span>
          </summary>
          <div className="overflow-x-auto border-t border-neutral-100">
            <Table>
              <Thead><Tr><Th>Год</Th><Th>Закуплено сырья</Th><Th>Выплачено поставщику</Th><Th>Произведено изделий</Th><Th>Сырьё в производстве</Th><Th>Получено от заказчиков</Th></Tr></Thead>
              <Tbody>
                {annualRows.map((r) => (
                  <Tr key={r.year}>
                    <Td className="font-semibold">{r.year}</Td>
                    <Td>{formatMoney(r.purchased.toString())}</Td>
                    <Td>{formatMoney(r.supplierPaid.toString())}</Td>
                    <Td>{formatQty(r.produced.toString())} шт.</Td>
                    <Td>{formatMoney(r.materialInProduction.toString())}</Td>
                    <Td>{formatMoney(r.clientPaid.toString())}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </details>
      </section>

      <section aria-label="Подробнее в разделах" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href="/payments" className="rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50">
          <div className="text-xs text-neutral-500">Долг и оплаты</div>
          <div className="mt-1 text-sm text-neutral-800">
            К оплате по УПД и счетам <b>{formatMoney(supplierDebt.receivedNet.toString())}</b> · счёт выставлен, не оплачен <b>{formatMoney(supplierDebt.invoiced.toString())}</b> · ожидаемые закупки <b>{formatMoney(supplierDebt.expected.toString())}</b>
          </div>
          <div className="mt-2 text-xs text-neutral-500">Остаток по аукционам, оплаты и авансы → Оплаты</div>
        </Link>
        <Link href="/lots" className="rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50">
          <div className="text-xs text-neutral-500">Мех и подкладка</div>
          <div className="mt-1 text-sm text-neutral-800">
            Мех на складе <b>{formatQty(rawRemainingQty.toString())} шт.</b> · подкладка <b>{formatQty(liningRemainingQty.toString())} м</b> · в производстве {formatQty(rawInGoodsQty.toString())} шт. меха
          </div>
          <div className="mt-2 text-xs text-neutral-500">Куплено → использовано → остаток по видам и партиям → Сырьё</div>
        </Link>
      </section>

      {clientDebts.length > 0 && (
      <section id="client-debt" className="scroll-mt-4 space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <InclVatOnlyLabel base="Остаток к оплате по заказчикам" />
              <InfoHint wide label="Остаток к оплате по заказчикам">
                <p>Разбивка плитки «Долг заказчиков» по заказчикам ({yl}).</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Заказчик</Th>
                  <Th>ТЗ</Th>
                  <Th>Остаток к оплате</Th>
                </Tr>
              </Thead>
              <Tbody>
                {clientDebts.map((c) => (
                  <Tr key={c.clientId}>
                    <Td>
                      <Link href={`/production?q=${encodeURIComponent(c.clientName)}`} className="hover:underline">
                        {c.clientName}
                      </Link>
                      {c.unpricedOrders > 0 && (
                        <span className="ml-1 text-xs text-neutral-400">
                          ({c.unpricedOrders} ТЗ без цены работ — не учтены)
                        </span>
                      )}
                    </Td>
                    <Td>{c.orders}</Td>
                    <Td className={c.balance.greaterThan(0) ? "text-amber-600" : ""}>
                      {formatMoney(c.balance.toString())}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      </section>
      )}

    </div>
  );
}

function KpiCard({
  label,
  value,
  warn,
  danger,
  hint,
  extra,
  href,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  warn?: boolean;
  danger?: boolean;
  /** Значок «i» с пояснением, цифрами и расчётом. */
  hint?: React.ReactNode;
  /** Вторая строка под числом (например, связанный показатель). */
  extra?: React.ReactNode;
  href?: string;
}) {
  // Значок «i» — вне ссылки: клик по нему не должен уводить со страницы.
  const body = (
    <div className={`h-full rounded-lg border bg-white p-4 ${danger ? "border-red-300" : "border-neutral-200"} ${href ? "transition-colors hover:bg-neutral-50" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 break-words text-lg font-semibold sm:text-xl ${danger ? "text-red-600" : warn ? "text-amber-600" : "text-neutral-900"}`}>{value}</div>
      {extra && <div className="mt-1 text-xs text-neutral-500">{extra}</div>}
    </div>
  );
  return (
    <div className="relative">
      {href ? <Link href={href}>{body}</Link> : body}
      {hint && (
        // Подсказка открывается по центру экрана: плитки стоят в ряд, а описание широкое.
        <div className="absolute right-3 top-3 [&_[role=tooltip]]:fixed [&_[role=tooltip]]:left-1/2 [&_[role=tooltip]]:right-auto [&_[role=tooltip]]:top-28 [&_[role=tooltip]]:-translate-x-1/2">
          {hint}
        </div>
      )}
    </div>
  );
}
