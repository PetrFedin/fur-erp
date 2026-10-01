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
import { auctionName, buildAuctionSummaries } from "@/lib/auction-payments";
import { computeAttention, countAttention } from "@/lib/attention";

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

  const [
    allPurchases,
    openPurchasesWithPayments,
    lowStockMaterials,
    allLots,
    materials,
    materialUsedAgg,
    clientOrders,
    clientPayments,
    unlinkedSupplierPayments,
    auctionPayments,
    attentionChecks,
  ] = await Promise.all([
    // Отменённые закупки в «Куплено сырья» не входят.
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: { items: true, expenses: true },
    }),
    // Отменённые тоже грузим: деньги, ушедшие по ним в рамках аукциона, входят в оплаченное по аукциону.
    prisma.purchase.findMany({
      where: { organizationId },
      include: { items: true, expenses: true, payments: { select: { amount: true, status: true } }, supplier: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: true },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId },
      select: { rawMaterialId: true, quantityReceived: true },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId } },
      select: {
        quantity: true,
        totalCost: true,
        commission4: true,
        lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
      },
    }),
    // ТЗ производства под заказчика (давальческая схема) — заказы без
    // clientId — это собственное производство, не подлежит взысканию.
    prisma.productionOrder.findMany({
      where: { organizationId, clientId: { not: null }, status: { not: "CANCELLED" } },
      include: { client: true },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId, clientId: { not: null } },
    }),
    // Авансы поставщику без привязки к закупке и к аукциону.
    prisma.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: null, status: "COMPLETED" },
      select: { supplierId: true, amount: true },
    }),
    // Оплаты аукционов целиком (Payment.auctionSession; purchaseId пуст).
    prisma.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: { not: null }, status: { in: ["COMPLETED", "PENDING"] } },
      select: { auctionSession: true, amount: true, status: true },
    }),
    computeAttention(prisma, organizationId),
  ]);
  const attention = countAttention(attentionChecks);

  // Raw + finished stock value
  const rawStockValue = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(l.unitCost)),
    new Decimal(0)
  );
  const rawStockValueExclVat = lowStockMaterials.reduce(
    (s, l) => s.add(l.quantityRemaining.mul(lotUnitCostExclVat(l))),
    new Decimal(0)
  );
  // Supplier balance due: per purchase (real amounts, not affected by the VAT toggle),
  // then one row per supplier (sum of debt + number of purchases with debt).
  const supplierMap = new Map<string, { supplier: string; due: Decimal; purchases: number }>();
  const hasUnlinkedAdvances = unlinkedSupplierPayments.length > 0;
  // Часть долга приходится на черновики — мех по ним ещё не принят на склад.
  let draftDebt = new Decimal(0);
  const addDebt = (supplierId: string, supplier: string, due: Decimal, purchases: number) => {
    const e = supplierMap.get(supplierId) ?? { supplier, due: new Decimal(0), purchases: 0 };
    e.due = e.due.add(due);
    e.purchases += purchases;
    supplierMap.set(supplierId, e);
  };
  // Закупки без аукциона — долг считается по каждой закупке (только оплаты со статусом «Оплачено»).
  for (const p of openPurchasesWithPayments) {
    if (p.status === "CANCELLED" || auctionName(p.auctionSession)) continue;
    const paid = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, pay) => s.add(pay.amount), new Decimal(0));
    const due = purchaseTotalInclVat(p).sub(paid);
    if (!due.greaterThan(0)) continue;
    if (p.status !== "RECEIVED") draftDebt = draftDebt.add(due);
    addDebt(p.supplierId, p.supplier.name, due, 1);
  }
  // Закупки аукциона — долг считается по аукциону целиком: итог закупок минус оплаты аукциона и его закупок
  // (так оплата аукциона не вычитается дважды и переплата одной закупки гасит другие). Разбивка по
  // закупкам/поставщикам — пропорционально их остаткам без оплат аукциона.
  const auctionSummaries = buildAuctionSummaries(openPurchasesWithPayments, auctionPayments);
  const auctionDebts = auctionSummaries
    .map((a) => ({ name: a.name, purchases: a.purchases, total: a.total, paid: a.paid, due: Decimal.max(a.remaining, new Decimal(0)) }))
    .filter((a) => a.due.greaterThan(0.005))
    .sort((a, b) => b.due.comparedTo(a.due));
  for (const a of auctionSummaries) {
    const due = Decimal.max(a.remaining, new Decimal(0));
    if (!due.greaterThan(0.005)) continue;
    const weights = a.perPurchase.map((pp) => ({ pp, w: Decimal.max(pp.total.sub(pp.paid), new Decimal(0)) }));
    const wSum = weights.reduce((s, x) => s.add(x.w), new Decimal(0));
    if (!wSum.greaterThan(0)) continue;
    const bySupplier = new Map<string, { due: Decimal; n: number }>();
    for (const { pp, w } of weights) {
      if (!w.greaterThan(0)) continue;
      const part = due.mul(w).div(wSum);
      if (pp.status !== "RECEIVED") draftDebt = draftDebt.add(part);
      const e = bySupplier.get(pp.supplierId) ?? { due: new Decimal(0), n: 0 };
      e.due = e.due.add(part);
      e.n += 1;
      bySupplier.set(pp.supplierId, e);
    }
    for (const [supplierId, e] of bySupplier) {
      const name = a.suppliers.find((x) => x.id === supplierId)?.name ?? "—";
      addDebt(supplierId, name, e.due, e.n);
    }
  }
  // Аванс без привязки к закупке гасит долг своего поставщика (не глубже нуля).
  for (const pay of unlinkedSupplierPayments) {
    const e = supplierMap.get(pay.supplierId);
    if (!e) continue;
    e.due = Decimal.max(e.due.sub(pay.amount), new Decimal(0));
  }
  const supplierBalances = Array.from(supplierMap.values()).filter((x) => x.due.greaterThan(0)).sort((a, b) => (b.due.greaterThan(a.due) ? 1 : -1));
  const supplierDebtTotal = supplierBalances.reduce((s, x) => s.add(x.due), new Decimal(0));

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
  for (const p of clientPayments) {
    if (!p.clientId) continue;
    const entry = clientDebtMap.get(p.clientId);
    if (entry) entry.paid = entry.paid.add(p.amount);
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
  // Скрываем строки, где и остаток, и его стоимость нулевые (полностью израсходованная подкладка);
  // информация не теряется: сырьё по-прежнему в разделе «Сырьё», ссылка «Подкладка →» под таблицей.
  const visibleMaterialRows = materialFlowRows.filter(
    (r) => !(r.remaining.isZero() && r.remainingValue.isZero())
  );
  const hiddenMaterialRows = materialFlowRows.length - visibleMaterialRows.length;

  const totalPurchasedValue = allPurchases.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const totalPurchasedValueExclVat = allPurchases.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));
  // «Использовано в ТЗ» в режиме «С 4%»: +4% к строкам списаний с commission4 = true.
  // Закупки, остатки сырья и долги — всегда без 4%.
  const usedSum = sumUsagesWith4(materialUsedAgg, c4Mode);
  const totalMaterialUsedValue = usedSum.incl;
  const totalMaterialUsedValueExclVat = usedSum.excl;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Сводка</h1>
        <Link href="/payments" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
          Оплаты →
        </Link>
      </div>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Куплено сырья"
          hint="Все закупки, кроме отменённых, вместе с черновиками (мех по ним ещё не принят)."
          value={<Money incl={totalPurchasedValue} excl={totalPurchasedValueExclVat} />}
        />
        <KpiCard
          label={`Списано в ТЗ${c4Suffix(c4Mode)}`}
          hint="Стоимость сырья, уже ушедшего в производство."
          value={<Money incl={totalMaterialUsedValue} excl={totalMaterialUsedValueExclVat} />}
        />
        <KpiCard
          label="Сырьё на складе"
          hint="Во сколько оценивается мех и подкладка, которые лежат на складе."
          value={<Money incl={rawStockValue} excl={rawStockValueExclVat} />}
        />
        <KpiCard
          label={<InclVatOnlyLabel base="Долг поставщикам" />}
          hint={
            draftDebt.greaterThan(0)
              ? `Сколько ещё заплатить. Из них ${formatMoney(draftDebt.toString())} — за черновики (мех не принят). Авансы без привязки уже вычтены.`
              : "Сколько ещё заплатить поставщикам. Авансы без привязки уже вычтены."
          }
          value={formatMoney(supplierDebtTotal.toString())}
          warn={supplierDebtTotal.greaterThan(0)}
        />
        <KpiCard
          label={<InclVatOnlyLabel base="Долг заказчиков" />}
          hint="Сколько заказчики ещё должны за работу по ТЗ."
          value={formatMoney(clientDebtTotal.toString())}
          warn={clientDebtTotal.greaterThan(0)}
        />
        <KpiCard
          label="Требует внимания"
          hint={
            attention.main === 0
              ? "Всё заведено."
              : `Не заведены документы, даты, оплаты. Срочных: ${attention.red}${attention.gray > 0 ? `, справочно: ${attention.gray}` : ""}.`
          }
          value={attention.main === 0 ? "Всё заведено ✓" : String(attention.main)}
          warn={attention.main > 0}
          danger={attention.red > 0}
          href="/attention"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сырьё по материалам</CardTitle>
        </CardHeader>
        <CardContent>
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
              {visibleMaterialRows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">
                    <Link href={r.unit === "M" ? "/lots?tab=lining" : "/lots"} className="hover:underline">
                      {r.name}
                    </Link>
                  </Td>
                  <Td>
                    {formatQty(r.purchased.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>
                    {formatQty(r.purchased.sub(r.remaining).toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td className={r.remaining.greaterThan(0) ? "font-medium text-amber-600" : ""}>
                    {formatQty(r.remaining.toString())} {UNIT_LABELS[r.unit]}
                  </Td>
                  <Td>
                    <Money incl={r.remainingValue} excl={r.remainingValueExclVat} />
                  </Td>
                </Tr>
              ))}
              {visibleMaterialRows.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-6 text-center text-neutral-400">
                    Сырьё ещё не закупалось
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <p className="mt-3 flex gap-4 text-sm">
            <Link href="/lots" className="text-neutral-600 hover:underline">
              Мех →
            </Link>
            <Link href="/lots?tab=lining" className="text-neutral-600 hover:underline">
              Подкладка →
            </Link>
            {hiddenMaterialRows > 0 && (
              <span className="text-neutral-400">
                Скрыто строк с нулевым остатком: {hiddenMaterialRows}
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><InclVatOnlyLabel base="Долг поставщикам" /></CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Поставщик</Th>
                  <Th>Закупок</Th>
                  <Th>Долг</Th>
                </Tr>
              </Thead>
              <Tbody>
                {supplierBalances.map((s) => (
                  <Tr key={s.supplier}>
                    <Td>{s.supplier}</Td>
                    <Td>{s.purchases}</Td>
                    <Td className="text-amber-600">{formatMoney(s.due.toString())}</Td>
                  </Tr>
                ))}
                {supplierBalances.length === 0 && (
                  <Tr>
                    <Td colSpan={3} className="py-6 text-center text-neutral-400">
                      Задолженностей нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
            {auctionDebts.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">По аукционам (топ-5 по остатку)</h3>
                <div className="flex flex-col gap-2">
                  {auctionDebts.slice(0, 5).map((a) => (
                    <Link
                      key={a.name}
                      href={`/payments?auction=${encodeURIComponent(a.name)}#auction-block`}
                      className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50"
                    >
                      <span>
                        <span className="font-medium">{a.name}</span>
                        <span className="block text-xs text-neutral-500">
                          оплачено {formatMoney(a.paid.toString())} из {formatMoney(a.total.toString())}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-semibold text-amber-600">{formatMoney(a.due.toString())}</span>
                    </Link>
                  ))}
                </div>
                {auctionDebts.length > 5 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Ещё аукционов с остатком: {auctionDebts.length - 5} — <Link href="/payments" className="underline">все в разделе «Оплаты»</Link>
                  </p>
                )}
                {hasUnlinkedAdvances && (
                  <p className="mt-1 text-xs text-neutral-400">
                    Авансы поставщикам без аукциона в разбивку не входят — они уменьшают общий долг выше.
                  </p>
                )}
              </div>
            )}
            <p className="mt-3 flex flex-wrap gap-4 text-sm">
              <Link href="/purchases" className="text-neutral-600 hover:underline">
                Все закупки →
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><InclVatOnlyLabel base="Долг заказчиков" /></CardTitle>
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
                {clientDebts.length === 0 && (
                  <Tr>
                    <Td colSpan={3} className="py-6 text-center text-neutral-400">
                      Задолженностей нет
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  warn,
  danger,
  hint,
  href,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  warn?: boolean;
  danger?: boolean;
  hint?: string;
  href?: string;
}) {
  const body = (
    <div
      title={hint}
      className={`h-full rounded-lg border bg-white p-4 ${danger ? "border-red-300" : "border-neutral-200"} ${href ? "transition-colors hover:bg-neutral-50" : ""}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 break-words text-lg font-semibold sm:text-xl ${danger ? "text-red-600" : warn ? "text-amber-600" : "text-neutral-900"}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
