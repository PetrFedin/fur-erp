import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, lotUnitCostExclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { InclVatOnlyLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { CompactMoney } from "./compact-money";
import { buildAttentionBlocks, computeAttention, countAttentionBlocks } from "@/lib/attention";
import { loadVerifyFlags } from "@/lib/verification";
import { computeDocCoverage } from "@/lib/doc-coverage";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, inYear, yearLabel, yearRange } from "@/lib/year-filter";
import { lotYear, orderYearWhere } from "@/lib/year-scope";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { FurSelectionTotal } from "@/components/fur-selection-total";
import { ProductionCostTotal } from "@/components/production-cost-total";
import reconciliationData from "@/data/reconciliation.json";

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

  const [
    allPurchases,
    supplierDebt,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    furPurchaseItems,
    productionCostOrders,
    clientOrders,
    clientPaymentsAll,
    attentionChecks,
    docCoverage,
  ] = await Promise.all([
    // Отменённые закупки в «Куплено сырья» не входят.
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, ...(range ? { orderDate: range } : {}) },
      include: { items: true, expenses: true },
    }),
    // Единый расчёт «Долга поставщику» (то же число — везде, см. src/lib/supplier-debt.ts).
    loadSupplierDebt(prisma, organizationId, year),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 }, ...lotYear(year) },
      include: { rawMaterial: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, ...lotYear(year) },
      select: { rawMaterialId: true, quantityReceived: true, quantityRemaining: true, unitCost: true, rawMaterial: { select: { name: true, unit: true } } },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId, status: { not: "CANCELLED" }, ...orderYearWhere(year) } },
      select: {
        quantity: true,
        totalCost: true,
        commission4: true,
        rawMaterial: { select: { name: true, unit: true } },
        lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
      },
    }),
    prisma.purchaseItem.findMany({
      where: {
        purchase: { organizationId, status: { not: "CANCELLED" }, currency: "USD", ...(range ? { orderDate: range } : {}) },
        rawMaterial: { unit: { not: "M" } },
      },
      select: { quantity: true, subtotal: true },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, ...orderYearWhere(year) },
      select: {
        producedQuantity: true, plannedQuantity: true, clientWorkPricePerUnit: true,
        materialUsages: { select: { quantity: true, totalCost: true, rawMaterial: { select: { name: true, unit: true } } } },
      },
    }),
    // ТЗ производства под заказчика (давальческая схема) — заказы без
    // clientId — это собственное производство, не подлежит взысканию.
    prisma.productionOrder.findMany({
      where: { organizationId, clientId: { not: null }, status: { not: "CANCELLED" }, ...orderYearWhere(year) },
      include: { client: true },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId },
      include: { orders: { select: { productionOrderId: true } } },
    }),
    computeAttention(prisma, organizationId, year),
    computeDocCoverage(prisma, organizationId),
  ]);
  const attentionBlocks = buildAttentionBlocks(attentionChecks);
  const attention = countAttentionBlocks(attentionBlocks);
  // Подтверждение строк (платежи, закупки, ТЗ, партии): отдельно от «что не заведено».
  const vf = await loadVerifyFlags(prisma, organizationId, year);
  const vTotal = Object.values(vf.counts).reduce((a, c) => ({ total: a.total + c.total, verified: a.verified + c.verified }), { total: 0, verified: 0 });
  // Оплаты заказчиков года: привязанные к ТЗ года; без ТЗ — по дате оплаты.
  const yearOrderIds = new Set(clientOrders.map((o) => o.id));
  const clientPayments = clientPaymentsAll.filter((p) =>
    year === "all" ? true : p.orders.length > 0 ? p.orders.some((l) => yearOrderIds.has(l.productionOrderId)) : inYear(p.paidAt, year),
  );

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

  // Lifetime raw material purchased/used/remaining, by material (used = purchased - remaining).
  type MaterialFlow = {
    id: string;
    name: string;
    unit: string;
    purchased: Decimal;
    remaining: Decimal;
    remainingValue: Decimal;
    remainingValueExclVat: Decimal;
  };
  const materialFlowMap = new Map<string, MaterialFlow>();
  for (const m of materials) {
    materialFlowMap.set(m.id, {
      id: m.id,
      name: m.name,
      unit: m.unit,
      purchased: new Decimal(0),
      remaining: new Decimal(0),
      remainingValue: new Decimal(0),
      remainingValueExclVat: new Decimal(0),
    });
  }
  for (const l of allLots) {
    const agg = materialFlowMap.get(l.rawMaterialId);
    if (agg) agg.purchased = agg.purchased.add(l.quantityReceived);
  }
  for (const l of lowStockMaterials) {
    const agg = materialFlowMap.get(l.rawMaterialId);
    if (agg) {
      agg.remaining = agg.remaining.add(l.quantityRemaining);
      agg.remainingValue = agg.remainingValue.add(l.quantityRemaining.mul(l.unitCost));
      agg.remainingValueExclVat = agg.remainingValueExclVat.add(l.quantityRemaining.mul(lotUnitCostExclVat(l)));
    }
  }
  const materialFlowRows = Array.from(materialFlowMap.values()).filter(
    (r) => r.purchased.greaterThan(0) || r.remaining.greaterThan(0)
  );
  // Сводка: 5 строк меха (по стоимости остатка), вся подкладка (единица «м») — одной строкой.
  // Полностью израсходованные материалы скрыты; полный список — в разделе «Сырьё».
  const liveRows = materialFlowRows.filter((r) => !(r.remaining.isZero() && r.remainingValue.isZero()));
  const allFurRows = liveRows.filter((r) => r.unit !== "M").sort((a, b) => b.remainingValue.comparedTo(a.remainingValue));
  const furRows = allFurRows.slice(0, 5);
  const moreFurRows = allFurRows.length - furRows.length;
  const liningRows = liveRows.filter((r) => r.unit === "M");
  const liningRow = liningRows.length
    ? {
        key: "lining",
        name: liningRows.length > 1 ? `Подкладка (${liningRows.length} вида)` : liningRows[0].name,
        unit: "M",
        href: "/lots?tab=lining",
        purchased: liningRows.reduce((s, r) => s.add(r.purchased), new Decimal(0)),
        remaining: liningRows.reduce((s, r) => s.add(r.remaining), new Decimal(0)),
        remainingValue: liningRows.reduce((s, r) => s.add(r.remainingValue), new Decimal(0)),
        remainingValueExclVat: liningRows.reduce((s, r) => s.add(r.remainingValueExclVat), new Decimal(0)),
      }
    : null;

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalPurchasedValueExclVat = allPurchases.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));
  // «Использовано в ТЗ» в режиме «С 4%»: +4% к строкам списаний с commission4 = true.
  // Закупки, остатки сырья и долги — всегда без 4%.
  const usedSum = sumUsagesWith4(materialUsedAgg, c4Mode);
  const totalMaterialUsedValue = usedSum.incl;
  const totalMaterialUsedValueExclVat = usedSum.excl;

  // Тотал по меховому сырью: только физически принятые лоты, подкладка отдельно.
  const furLots = allLots.filter((l) => l.rawMaterial.unit !== "M");
  const rawQtyTotal = furLots.reduce((s, l) => s.add(l.quantityReceived), new Decimal(0));
  const rawCostTotal = furLots.reduce((s, l) => s.add(l.quantityReceived.mul(l.unitCost)), new Decimal(0));
  const rawRemainingQty = furLots.reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
  const rawRemainingValue = furLots.reduce((s, l) => s.add(l.quantityRemaining.mul(l.unitCost)), new Decimal(0));
  const rawAvgFinalRub = rawQtyTotal.greaterThan(0) ? rawCostTotal.div(rawQtyTotal) : new Decimal(0);
  const usdQty = furPurchaseItems.reduce((s, i) => s.add(i.quantity), new Decimal(0));
  const usdSubtotal = furPurchaseItems.reduce((s, i) => s.add(i.subtotal), new Decimal(0));
  const rawAvgPurchaseUsd = usdQty.greaterThan(0) ? usdSubtotal.div(usdQty) : new Decimal(0);

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
  const furCostMap = new Map<string, { value: Decimal; qty: Decimal }>();
  const liningCostMap = new Map<string, { value: Decimal; qty: Decimal }>();
  for (const u of materialUsedAgg) {
    const map = u.rawMaterial.unit === "M" ? liningCostMap : furCostMap;
    const cur = map.get(u.rawMaterial.name) ?? { value: new Decimal(0), qty: new Decimal(0) };
    cur.value = cur.value.add(u.totalCost);
    cur.qty = cur.qty.add(u.quantity);
    map.set(u.rawMaterial.name, cur);
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
  const reconGroups = reconciliationData.groups.filter((g) => year === "all" || g.year === Number(year));
  const reconConflicts = reconGroups.filter((g) => g.status === "conflict").length;
  const reconReviews = reconGroups.filter((g) => g.status === "review").length;
  const reconOpen = reconConflicts + reconReviews;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Сводка{year !== "all" ? <span className="ml-2 text-sm font-normal text-neutral-500">· {yl}</span> : null}</h1>
        <Link href="/payments" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 max-md:inline-flex max-md:min-h-8 max-md:items-center">
          Оплаты →
        </Link>
      </div>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <section className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Шаг 1 · Закупки и обязательства</div>
          <h2 className="mt-1 text-base font-semibold">Сначала смотрим, сколько должны и что ещё предстоит оплатить</h2>
        </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label={<InclVatOnlyLabel base="Долг поставщику" />}
          hint={<SupplierDebtHint debt={supplierDebt} year={year} />}
          value={<CompactMoney incl={supplierDebt.debt.toString()} />}
          warn={supplierDebt.debt.greaterThan(0)}
          href="/payments"
        />
        <KpiCard
          label="К оплате по УПД и счетам"
          hint={
            <InfoHint wide label="К оплате по УПД и счетам">
              <p>Мех получен, УПД есть, а оплаты не хватает: <b>{formatMoney(supplierDebt.receivedGross.toString())}</b>. Из неё вычтены авансы без привязки <b>{formatMoney(supplierDebt.unlinkedAdvances.toString())}</b> — остаётся <b>{formatMoney(supplierDebt.receivedNet.toString())}</b>.</p>
              <p className="mt-2 text-neutral-500">Период: {yl}. Переключатель «С 4%» долг не меняет.</p>
            </InfoHint>
          }
          value={<CompactMoney incl={supplierDebt.receivedNet.toString()} />}
          warn={supplierDebt.receivedNet.greaterThan(0)}
        />
        <KpiCard
          label="Счёт выставлен, не оплачен"
          hint={
            <InfoHint wide label="Счёт выставлен, не оплачен">
              <p>Закупка ещё не получена (черновик), но Веллмех уже выставил счёт. Суммы счетов — из документов Drive.</p>
              {supplierDebt.byAuction.filter((a) => a.dueInvoiced.greaterThan(0.5)).map((a) => (
                <p key={a.name} className="mt-1">
                  <b>{a.name}</b>: {formatMoney(a.dueInvoiced.toString())}
                  {a.invoiceDocs ? <span className="text-neutral-500"> — {a.invoiceDocs}</span> : null}
                </p>
              ))}
              <p className="mt-2 text-neutral-500">Период: {yl}. После оплаты или получения меха сумма уйдёт из этой строки.</p>
            </InfoHint>
          }
          value={<CompactMoney incl={supplierDebt.invoiced.toString()} />}
        />
        <KpiCard
          label="Ожидаемые закупки"
          hint={
            <InfoHint wide label="Ожидаемые закупки">
              <p>Не получены и счёта на эту часть ещё нет — это не долг сегодня, а то, что придётся заплатить.</p>
              {supplierDebt.byAuction.filter((a) => a.dueExpected.greaterThan(0.5)).map((a) => (
                <p key={a.name} className="mt-1"><b>{a.name}</b>: {formatMoney(a.dueExpected.toString())}</p>
              ))}
              <p className="mt-2 text-neutral-500">Период: {yl}.</p>
            </InfoHint>
          }
          value={<CompactMoney incl={supplierDebt.expected.toString()} />}
        />
      </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Шаг 2 · Денежный контур</div>
          <h2 className="mt-1 text-base font-semibold">Закуплено, оплачено, остатки и контрольные сигналы</h2>
        </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Куплено сырья"
          hint={
            <InfoHint wide label="Куплено сырья">
              <p>Все закупки периода ({yl}), кроме отменённых, с НДС: мех принят <b>{formatMoney(receivedPurchasedValue.toString())}</b> + черновики (не получены) <b>{formatMoney(draftPurchasedValue.toString())}</b>.</p>
              <p className="mt-2">«Списано в ТЗ» — стоимость сырья и подкладки в ТЗ периода{c4Mode === "on" ? ", с надбавкой 4% (включён переключатель «С 4%»)" : " без 4% (надбавку покажет переключатель «С 4%»)"}.</p>
              <p className="mt-2 text-neutral-500">Покупки у поставщика всегда без 4%: она считается только в себестоимости.</p>
            </InfoHint>
          }
          value={<CompactMoney incl={totalPurchasedValue.toString()} excl={totalPurchasedValueExclVat.toString()} />}
          extra={
            <>
              списано в ТЗ{c4Suffix(c4Mode)}:{" "}
              <CompactMoney incl={totalMaterialUsedValue.toString()} excl={totalMaterialUsedValueExclVat.toString()} />
            </>
          }
        />
        <KpiCard
          label="Сырьё на складе"
          hint={
            <InfoHint wide label="Сырьё на складе">
              <p>Во сколько оценивается мех и подкладка на складе (лоты закупок периода: {yl}), по цене закупки.</p>
              <p className="mt-2">{c4Mode === "on" ? <>Включён «С 4%»: при списании в ТЗ к этой стоимости добавится 4% — <b>{formatMoney(stock4Extra.toString())}</b> (с НДС). На складе лежит по цене закупки.</> : "Переключатель «С 4%» покажет, сколько добавит 4% при списании в ТЗ."}</p>
            </InfoHint>
          }
          value={<CompactMoney incl={rawStockValue.toString()} excl={rawStockValueExclVat.toString()} />}
          extra={c4Mode === "on" ? <>со списанием в ТЗ (+4%): <CompactMoney incl={rawStockValue.add(stock4Extra).toString()} excl={rawStockValueExclVat.add(stock4ExtraExcl).toString()} /></> : undefined}
        />
        <KpiCard
          label="Оплачено поставщику"
          hint={
            <InfoHint wide label="Оплачено поставщику">
              <p>Оплаты, засчитанные в закупки периода ({yl}): <b>{formatMoney(supplierDebt.paid.toString())}</b>; авансы без привязки (<b>{formatMoney(supplierDebt.unlinkedAdvances.toString())}</b>) считаются отдельно и вычтены из долга.</p>
              <p className="mt-2 text-neutral-500">Оплаты по письму или расчёту без платёжки внесены с пометкой «не подтверждён»: их список — на странице «Что не заведено». Переключатель «С 4%» оплаты не меняет.</p>
            </InfoHint>
          }
          value={<CompactMoney incl={supplierDebt.paid.toString()} />}
          href="/payments"
        />
        <KpiCard
          label={<InclVatOnlyLabel base="Долг заказчиков" />}
          hint={
            <InfoHint wide label="Долг заказчиков">
              <p>Сколько заказчики ещё должны за работу по ТЗ периода ({yl}): работа <b>{formatMoney(clientBillableTotal.toString())}</b> − оплачено <b>{formatMoney(clientPaidTotal.toString())}</b> = <b>{formatMoney(clientDebtTotal.toString())}</b>.</p>
              <p className="mt-2">Оплаты: привязанные к ТЗ периода; без ТЗ — по дате оплаты. Авансы без ТЗ:{" "}
                {advancesDeducted.greaterThan(0) ? `${formatMoney(advancesDeducted.toString())} уже вычтены` : "нет"}
                {advancesNotCounted.greaterThan(0) ? `; ${formatMoney(advancesNotCounted.toString())} не вычтены (нет заказчика или его ТЗ)` : ""}.
              </p>
              <p className="mt-2 text-neutral-500">В оплаты партий входят шкуры подрядчика (в счетах на доплату), поэтому по отдельному году сумма может быть отрицательной — по всем годам она сходится.</p>
              <p className="mt-2 text-neutral-500">Переключатель «С 4%» долг заказчиков не меняет (4% — только на сырьё в себестоимости).</p>
            </InfoHint>
          }
          value={<CompactMoney incl={clientDebtTotal.toString()} />}
          warn={clientDebtTotal.greaterThan(0)}
        />
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Шаг 3 · Сырьё и склад</div>
            <h2 className="mt-1 text-base font-semibold">Что куплено, использовано и осталось</h2>
          </div>
          <Link href="/lots" className="text-sm text-neutral-600 hover:underline">Открыть весь склад →</Link>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Тотал сырья
              <InfoHint wide label="Как считаем тотал сырья">
                <p>Только меховое сырьё; подкладка вынесена отдельно ниже. Количество и стоимость считаются по фактически принятым лотам.</p>
                <p className="mt-1">Средняя цена закупки в долларах — средневзвешенная цена по позициям закупок, где валюта документа USD. Финальная цена в рублях — средневзвешенная landed cost лотов.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th className="min-w-36">Количество сырья ед.</Th>
                  <Th className="min-w-36">Ср цена закупки долл</Th>
                  <Th className="min-w-44">Ср цена за ед. сырья руб (финальная)</Th>
                  <Th className="min-w-48">Себестоимость общая всего сырья руб</Th>
                  <Th className="min-w-44">Остаток неиспользованного сырья ед.</Th>
                  <Th className="min-w-48">Остаток неиспользованного сырья руб</Th>
                </Tr>
              </Thead>
              <Tbody>
                <Tr>
                  <Td className="text-lg font-semibold tabular-nums">{formatQty(rawQtyTotal.toString())}</Td>
                  <Td className="text-lg font-semibold tabular-nums">${rawAvgPurchaseUsd.toNumber().toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</Td>
                  <Td className="text-lg font-semibold tabular-nums">{formatMoney(rawAvgFinalRub.toString())}</Td>
                  <Td className="text-lg font-semibold tabular-nums">{formatMoney(rawCostTotal.toString())}</Td>
                  <Td className="text-lg font-semibold tabular-nums">{formatQty(rawRemainingQty.toString())}</Td>
                  <Td className="text-lg font-semibold tabular-nums">{formatMoney(rawRemainingValue.toString())}</Td>
                </Tr>
              </Tbody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сырьё уже в изделиях</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{formatQty(rawInGoodsQty.toString())} шт.</div>
            <div className="mt-1 text-sm text-neutral-600">{formatMoney(rawInGoodsValue.toString())}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Произведено изделий</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{formatQty(producedGoodsQty.toString())} шт.</div>
            <div className="mt-1 text-sm text-neutral-500">по фактическому producedQuantity ТЗ</div>
          </Card>
          <ProductionCostTotal
            total={producedGoodsTotalCost.toNumber()}
            fur={rawInGoodsValue.toNumber()}
            lining={liningInGoodsValue.toNumber()}
            work={productionWorkValue.toNumber()}
            furDetails={furCostDetails}
            liningDetails={liningCostDetails}
            products={producedGoodsQty.toNumber()}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Мех
              <InfoHint wide label="Мех">
                <p>Все виды меха отдельно от подкладки. Галочками можно исключить любой вид и мгновенно пересчитать общий остаток и его стоимость.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FurSelectionTotal
              rows={allFurRows.map((r) => ({
                id: r.id,
                name: r.name,
                unit: r.unit,
                purchased: r.purchased.toString(),
                remaining: r.remaining.toString(),
                remainingValue: r.remainingValue.toString(),
                remainingValueExclVat: r.remainingValueExclVat.toString(),
              }))}
            />
            <Table>
              <Thead>
                <Tr>
                  <Th>Материал</Th>
                  <Th>Куплено</Th>
                  <Th>Использовано</Th>
                  <Th>Остаток</Th>
                  <Th>Стоимость остатка</Th>
                </Tr>
              </Thead>
              <Tbody>
                {allFurRows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium"><Link href="/lots" className="hover:underline">{r.name}</Link></Td>
                    <Td>{formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}</Td>
                    <Td>{formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}</Td>
                    <Td className={r.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>{formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}</Td>
                    <Td><Money incl={r.remainingValue} excl={r.remainingValueExclVat} /></Td>
                  </Tr>
                ))}
                {allFurRows.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-neutral-400">Мех ещё не закупался</Td></Tr>}
              </Tbody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Подкладка
              <InfoHint wide label="Подкладка">
                <p>Подкладочные материалы вынесены отдельно и больше не смешиваются с мехом в одной таблице.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liningRow ? (
              <Table>
                <Thead><Tr><Th>Материал</Th><Th>Куплено</Th><Th>Использовано</Th><Th>Остаток</Th><Th>Стоимость остатка</Th></Tr></Thead>
                <Tbody>
                  <Tr>
                    <Td className="font-medium"><Link href={liningRow.href} className="hover:underline">{liningRow.name}</Link></Td>
                    <Td>{formatQty(liningRow.purchased.toString())} м</Td>
                    <Td>{formatQty(liningRow.purchased.sub(liningRow.remaining).toString())} м</Td>
                    <Td className={liningRow.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>{formatQty(liningRow.remaining.toString())} м</Td>
                    <Td><Money incl={liningRow.remainingValue} excl={liningRow.remainingValueExclVat} /></Td>
                  </Tr>
                </Tbody>
              </Table>
            ) : <p className="py-6 text-center text-sm text-neutral-400">Подкладка ещё не закупалась</p>}
            <div className="mt-3 flex justify-end text-sm">
              <span className="text-neutral-500">Тотал подкладки:</span>
              <span className="ml-1 font-semibold"><Money incl={liningRow?.remainingValue ?? 0} excl={liningRow?.remainingValueExclVat ?? 0} /></span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Шаг 4 · Расчёты и производство</div>
          <h2 className="mt-1 text-base font-semibold">После склада смотрим расчёты по аукционам и заказчикам</h2>
        </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <InclVatOnlyLabel base="Долг по аукционам" />
              <InfoHint wide label="Долг по аукционам">
                <p>Топ-5 аукционов по остатку к оплате ({yl}). Нажмите на аукцион — откроются его оплаты. Остаток аукциона = стоимость − оплачено; цвет подписи показывает, получен ли мех или выставлен счёт. Сумма всех остатков минус авансы без привязки — это «Долг поставщику».</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {supplierDebt.byAuction.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400">Задолженностей нет</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {supplierDebt.byAuction.slice(0, 5).map((a) => (
                    <Link
                      key={a.name}
                      href={`/payments?auction=${encodeURIComponent(a.name)}#auction-block`}
                      className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50"
                    >
                      <span>
                        <span className="font-medium">{a.name}</span>
                        <span className="block text-xs text-neutral-500">
                          оплачено {formatMoney(a.paid.toString())} из {formatMoney(a.total.toString())}
                          {a.dueInvoiced.greaterThan(0.5) || a.dueExpected.greaterThan(0.5)
                            ? ` · ${a.dueReceived.greaterThan(0.5) ? "получен" : a.dueInvoiced.greaterThan(0.5) ? "счёт выставлен" : "ожидается"}`
                            : ""}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-semibold text-amber-600">{formatMoney(a.due.toString())}</span>
                    </Link>
                  ))}
                </div>
                {supplierDebt.byAuction.length > 5 && (
                  <p className="mt-1 text-xs text-neutral-500">Ещё аукционов с остатком: {supplierDebt.byAuction.length - 5}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {clientDebts.length > 0 && (
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
        )}
      </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Шаг 5 · Контроль и доказательства</div>
          <h2 className="mt-1 text-base font-semibold">В конце проверяем расхождения, недостающие документы и неподтверждённые строки</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Расхождения сверки"
            value={String(reconOpen)}
            extra={`${reconConflicts} конфликтов · ${reconReviews} ручных проверок`}
            warn={reconOpen > 0}
            danger={reconConflicts > 0}
            href="/reconciliation"
          />
        <KpiCard
          label="Требует внимания"
          hint={
            <InfoHint wide label="Требует внимания">
              <p>
                Записей, по которым нужно ваше решение или документ: <b>{attention.main}</b>
                {attention.red > 0 ? <>, из них срочных блоков: <b>{attention.red}</b></> : null}. Справочно (в число не входит): {attention.info}. Период: {yl}.
              </p>
              <ul className="mt-2 list-disc pl-4">
                {attentionBlocks.filter((b) => b.meta.kind !== "info").map((b) => (
                  <li key={b.id}>{b.meta.title}: {b.entities.length}{b.meta.kind === "bulk" ? " (одна запись на группу)" : ""}</li>
                ))}
              </ul>
              <p className="mt-2">
                Подтверждение строк: подтверждено <b>{vTotal.verified}</b> из {vTotal.total}, ждёт проверки <b className={vTotal.total - vTotal.verified > 0 ? "text-amber-700" : undefined}>{vTotal.total - vTotal.verified}</b> — страница{" "}
                <a href="/verify" className="text-blue-700 underline">«Ждёт проверки»</a>.
              </p>
              <p className="mt-2 text-neutral-500">Весь список, по группам и по сущностям, — на странице «Что не заведено».</p>
            </InfoHint>
          }
          value={attention.main === 0 ? "Всё заведено ✓" : String(attention.main)}
          warn={attention.main > 0}
          danger={attention.red > 0}
          href="/attention"
        />
        <KpiCard
          label="Покрытие документами"
          hint={
            <InfoHint wide align="right" label="Покрытие документами">
              <p>Сколько обязательных документов (счета, УПД, расчёты, спецификации, ТЗ-приложения, платёжки, договоры) уже приложено: {docCoverage.total.have} из {docCoverage.total.required}; записей с пробелами: {docCoverage.total.rowsWithGaps}.</p>
              <p className="mt-2 text-neutral-500">Считается по всем годам сразу.</p>
            </InfoHint>
          }
          value={docCoverage.total.percent === null ? "—" : `${docCoverage.total.percent}%`}
          warn={(docCoverage.total.percent ?? 100) < 90}
          danger={(docCoverage.total.percent ?? 100) < 60}
          href="/documents"
        />
          <KpiCard
            label="Ждёт подтверждения"
            value={String(vTotal.total - vTotal.verified)}
            extra={`подтверждено ${vTotal.verified} из ${vTotal.total}`}
            warn={vTotal.total - vTotal.verified > 0}
            href="/verify"
          />
        </div>
      </section>
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
