import "server-only";
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import { getFurIndex } from "@/lib/fur-ref-server";
import { auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";

/** Куда разнесена оплата: закупка, ТЗ или «без привязки». Σ частей = сумма оплаты. */
export type OverviewPart = { label: string; href?: string; amount: number; note?: string };

/** Одна оплата в общем списке «Все»: куда ушла (сырьё / производство), по каким статьям и куда вести по клику. */
export type OverviewRow = {
  id: string;
  kind: "raw" | "prod";
  iso: string;
  year: number;
  amount: number;
  /** Статьи: мех и подкладка — для сырья; работа и шкуры подрядчика — для производства. Σ = amount. */
  fur: number;
  lining: number;
  work: number;
  hides: number;
  /** Что оплачено: аукцион/закупка или «Аванс · ТЗ …». */
  label: string;
  confirmed: boolean;
  href: string;
  /** Основание платежа как записано в документе (п/п, счёт) либо null. */
  doc: string | null;
  /** Вид платежа: «Аванс», «Доплата», «Оплата». */
  what: string;
  /** Распределение оплаты: по закупкам (сырьё) или по ТЗ (производство). */
  parts: OverviewPart[];
};

/** Все проведённые оплаты (поставщику за сырьё и по производству) с разбивкой по статьям. */
export async function loadPaymentsOverview(orgId: string): Promise<OverviewRow[]> {
  const furIdx = await getFurIndex(orgId);
  const [lotsFur, lotsLining, pays, prod, auctionPurchases] = await Promise.all([
    loadFurLots(prisma, orgId, { kind: "fur", year: "all", furIdx }),
    loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx }),
    prisma.payment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, purchaseId: true, auctionSession: true, confirmedAt: true, kind: true, docRef: true, purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true } } },
      orderBy: { paidAt: "desc" },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, paymentType: true, docRef: true, notes: true, confirmedAt: true, allocations: { select: { amount: true, productionOrder: { select: { id: true, number: true } } } }, orders: { select: { productionOrderId: true } } },
      orderBy: { paidAt: "desc" },
    }),
    // Закупки партий: оплата партии делится между ними пропорционально сумме (так же, как «Оплачено» в списке закупок).
    prisma.purchase.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, auctionSession: { not: null } },
      select: { id: true, number: true, auctionSession: true, exchangeRate: true, items: true, expenses: true },
    }),
  ]);
  const purchasesOfAuction = new Map<string, { id: string; number: string; total: number }[]>();
  for (const pu of auctionPurchases) {
    const name = auctionName(pu.auctionSession);
    if (!name) continue;
    const total = purchaseTotalInclVat(pu).toNumber();
    purchasesOfAuction.set(name, [...(purchasesOfAuction.get(name) ?? []), { id: pu.id, number: pu.number, total }]);
  }
  const all = [...lotsFur, ...lotsLining];
  const share = (lots: typeof all) => {
    const tot = lots.reduce((a, l) => a + l.recvIncl, 0);
    return tot > 0 ? lots.filter((l) => l.kind === "lining").reduce((a, l) => a + l.recvIncl, 0) / tot : 0;
  };
  const byPurchase = new Map<string, typeof all>();
  const byAuction = new Map<string, typeof all>();
  for (const l of all) {
    if (l.purchaseId) byPurchase.set(l.purchaseId, [...(byPurchase.get(l.purchaseId) ?? []), l]);
    byAuction.set(l.auction, [...(byAuction.get(l.auction) ?? []), l]);
  }
  const out: OverviewRow[] = [];
  for (const p of pays) {
    const amount = p.amount.toNumber();
    const lots = p.purchaseId ? byPurchase.get(p.purchaseId) : p.auctionSession ? byAuction.get(p.auctionSession) : undefined;
    const lining = lots ? amount * share(lots) : 0;
    const au = auctionName(p.auctionSession ?? p.purchase?.auctionSession ?? null);
    const group = au ? purchasesOfAuction.get(au) ?? [] : [];
    const groupTotal = group.reduce((a, x) => a + x.total, 0);
    const parts: OverviewPart[] = p.purchase && p.purchaseId
      ? [{ label: `Закупка ${p.purchase.number}`, href: `/purchases/${p.purchase.id}`, amount }]
      : groupTotal > 0
        ? group.map((x) => ({ label: `Закупка ${x.number}`, href: `/purchases/${x.id}`, amount: (amount * x.total) / groupTotal, note: "доля в сумме партии" }))
        : [{ label: au ?? "Аванс без привязки к закупке", amount }];
    out.push({
      // Год сырьевой оплаты — год закупки (без аукциона: год заказа закупки): тогда по году «куплено − оплачено = долг» и все разделы сходятся.
      id: p.id, kind: "raw", iso: p.paidAt.toISOString().slice(0, 10), year: (!au && p.purchase?.orderDate ? p.purchase.orderDate.getUTCFullYear() : p.paidAt.getUTCFullYear()), amount,
      fur: amount - lining, lining, work: 0, hides: 0,
      label: au ?? p.purchase?.number ?? "Аванс без привязки",
      confirmed: p.confirmedAt != null,
      doc: p.docRef?.trim() || null,
      what: p.kind === "ADVANCE" ? "Аванс" : p.kind === "PARTIAL" ? "Доплата" : "Оплата",
      parts,
      href: au ? `/payments?tab=suppliers&auction=${encodeURIComponent(au)}#auction-block` : "/payments?tab=suppliers&noauction=1#noauction-block",
    });
  }
  // Переплата по подкладке зачтена в счёте AME (мех): та часть оплаты — не подкладка, а мех.
  {
    const { loadSupplierDebt } = await import("@/lib/supplier-debt");
    const debt = await loadSupplierDebt(prisma, orgId, "all");
    for (const o of debt.overpaid) {
      const rows = out.filter((r) => r.kind === "raw" && r.label === o.name && r.lining > 0);
      const tot = rows.reduce((a, r) => a + r.lining, 0);
      if (tot <= 0) continue;
      const shift = Math.min(o.amount.toNumber(), tot);
      for (const r of rows) { const s = shift * (r.lining / tot); r.lining -= s; r.fur += s; }
    }
  }
  for (const p of prod) {
    const amount = p.amount.toNumber();
    if (amount === 0) continue;
    const alloc = p.allocations.reduce((a, x) => a + x.amount.toNumber(), 0);
    const rest = amount - alloc;
    const hides = rest > 1 && /шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`) ? rest : 0;
    const iso = p.paidAt.toISOString().slice(0, 10);
    const parts: OverviewPart[] = p.allocations
      .filter((x) => x.amount.toNumber() !== 0)
      .map((x) => ({ label: `ТЗ ${x.productionOrder.number}`, href: `/production/${x.productionOrder.id}`, amount: x.amount.toNumber() }));
    if (Math.abs(rest) > 0.5) parts.push({ label: hides > 0 ? "Шкуры подрядчика в составе счёта за пошив" : "Аванс без привязки к ТЗ", amount: rest });
    out.push({
      id: p.id, kind: "prod", iso, year: p.paidAt.getUTCFullYear(), amount,
      fur: hides, lining: 0, work: amount - hides, hides,
      label: p.paymentType === "ADVANCE" ? "Аванс за пошив" : p.paymentType === "PARTIAL" ? "Доплата за пошив" : "Оплата за пошив",
      confirmed: p.confirmedAt != null,
      doc: p.docRef?.trim() || null,
      what: p.paymentType === "ADVANCE" ? "Аванс" : p.paymentType === "PARTIAL" ? "Доплата" : "Оплата",
      parts,
      href: `/payments?tab=clients&pdate=${iso}`,
    });
  }
  return out.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
}

/** Сколько ещё предстоит оплатить по годам: сырьё — остаток долга поставщику по аукционам (год из названия), производство — работа ТЗ минус оплаты и авансы. Те же числа, что на Главной. */
export async function loadPaymentsLeft(orgId: string): Promise<{ byYear: Map<number, { raw: number; prod: number }>; raw: number; prod: number; overpaid: { name: string; amount: number }[] }> {
  const { loadSupplierDebt } = await import("@/lib/supplier-debt");
  const { loadClientDebt } = await import("@/lib/payment-alloc");
  const { loadOrderRows } = await import("@/lib/analytics-orders");
  const [debt, cd, orders, alloc] = await Promise.all([
    loadSupplierDebt(prisma, orgId, "all"),
    loadClientDebt(prisma, orgId, { year: "all" }),
    loadOrderRows(orgId, "all", "on"),
    prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId, productionPayment: { status: "COMPLETED" } }, _sum: { amount: true } }),
  ]);
  const byYear = new Map<number, { raw: number; prod: number }>();
  const add = (y: number, k: "raw" | "prod", v: number) => {
    const cur = byYear.get(y) ?? { raw: 0, prod: 0 };
    cur[k] += v;
    byYear.set(y, cur);
  };
  const yearOf = (name: string) => {
    const m = /(\d{2})[-.](\d{2})\s*$/.exec(name.trim());
    return m ? 2000 + Number(m[2]) : 2026;
  };
  for (const a of debt.byAuction) if (a.due.toNumber() > 0.005) add(yearOf(a.name), "raw", a.due.toNumber());
  for (const o of debt.overpaid) add(yearOf(o.name), "raw", -o.amount.toNumber());
  if (debt.nonAuctionDebt.toNumber() > 0.005) add(2026, "raw", debt.nonAuctionDebt.toNumber());
  if (debt.unlinkedAdvances.toNumber() > 0.005) add(2026, "raw", -debt.unlinkedAdvances.toNumber());
  const al = new Map(alloc.map((x) => [x.productionOrderId, x._sum.amount?.toNumber() ?? 0]));
  for (const o of orders) {
    if (!o.clientName) continue;
    const left = o.work - (al.get(o.id) ?? 0);
    if (left > 0.5) add(o.year ?? 2026, "prod", left);
  }
  for (const p of cd.payments) {
    if (/шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`) && p.rest.toNumber() > 1) continue;
    add(p.paidAt.getUTCFullYear(), "prod", -p.rest.toNumber());
  }
  return { byYear, raw: debt.debt.toNumber(), prod: cd.balance, overpaid: debt.overpaid.map((o) => ({ name: o.name, amount: o.amount.toNumber() })) };
}
