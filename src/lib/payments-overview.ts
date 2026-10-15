import { formatPercent } from "@/lib/utils";
import "server-only";
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import { getFurIndex } from "@/lib/fur-ref-server";
import { auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { cleanNote } from "@/lib/note-tags";
import { PAYER_NAME, contractorOfOrders, docNo } from "@/lib/payment-parties";

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
  /** Тип платежа как в базе (Payment.kind / ProductionPayment.paymentType): аванс, доплата, окончательный расчёт, прочее. */
  type: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER";
  /** Распределение оплаты: по закупкам (сырьё) или по ТЗ (производство). */
  parts: OverviewPart[];
  /** Полное описание платежа: все поля текстом (подпись → значение), пустые пропущены. */
  fields: [string, string][];
  /** Остаток платежа, не отнесённый ни к закупке, ни к ТЗ (аванс без привязки); 0 — разнесён целиком. */
  unallocated: number;
  /** Куда перейти править платёж и откуда он пришёл: закупка / ТЗ / партия закупки. */
  links: { label: string; href: string }[];
  /** Вид строки для встроенных кнопок правки: авансовый платёж без привязки, оплата партии, оплата закупки, оплата производства. */
  edit: "advance" | "auction" | "purchase" | "prod";
};

const ruDate = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const METHOD_RU: Record<string, string> = { BANK_TRANSFER: "банковский перевод", CASH: "наличные", CARD: "карта", OTHER: "другое" };
const money = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const ppOf = (docRef: string | null) => /п\/п\s*№?\s*(\d+)/i.exec(docRef ?? "")?.[1] ?? null;
const invoiceOf = (docRef: string | null) => /сч[её]т[^№;·]*№\s*([^\s;·,()]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i.exec(docRef ?? "");

/** Все проведённые оплаты (поставщику за сырьё и по производству) с разбивкой по статьям. */
export async function loadPaymentsOverview(orgId: string): Promise<OverviewRow[]> {
  const furIdx = await getFurIndex(orgId);
  const [lotsFur, lotsLining, pays, prod, auctionPurchases] = await Promise.all([
    loadFurLots(prisma, orgId, { kind: "fur", year: "all", furIdx }),
    loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx }),
    prisma.payment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, createdAt: true, purchaseId: true, auctionSession: true, confirmedAt: true, kind: true, docRef: true, notes: true, method: true, percent: true, documentId: true, supplier: { select: { name: true } }, _count: { select: { driveDocuments: true } }, purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true, invoiceNumber: true } } },
      orderBy: { paidAt: "desc" },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, createdAt: true, paymentType: true, method: true, docRef: true, notes: true, confirmedAt: true, client: { select: { name: true } }, _count: { select: { driveDocuments: true } }, allocations: { select: { amount: true, productionOrder: { select: { id: true, number: true, workOrderNumber: true, contractNumber: true } } } }, orders: { select: { productionOrderId: true, productionOrder: { select: { id: true, number: true, workOrderNumber: true, contractNumber: true } } } } },
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
    const whatRaw = p.kind === "ADVANCE" ? "Аванс" : p.kind === "PARTIAL" ? "Доплата" : p.kind === "FINAL" ? "Окончательный расчёт" : "Оплата";
    const unlinked = !p.purchaseId && !au;
    const inv = invoiceOf(p.docRef);
    const rawFields: [string, string][] = [
      ["Дата оплаты", ruDate(p.paidAt)],
      ["Сумма", money(amount)],
      ["Вид оплаты", "За сырьё"],
      ["Тип", whatRaw + (p.percent ? ` · ${formatPercent(Number(p.percent.toString()))} от суммы партии` : "")],
      ["Статья", `мех ${money(amount - lining)}` + (lining > 0.005 ? ` · подкладка ${money(lining)}` : "")],
      ["Плательщик", PAYER_NAME],
      ["Получатель", p.supplier.name],
      ["За что", au ? `Партия «${au}»${p.purchase ? ` · закупка ${p.purchase.number}` : ""}` : p.purchase ? `Закупка ${p.purchase.number}` : "Без привязки к закупке (аванс)"],
      ["Способ", METHOD_RU[p.method] ?? p.method],
      ["П/п", ppOf(p.docRef) ?? ""],
      ["Счёт", inv ? docNo(inv[1], inv[2]) : p.purchase?.invoiceNumber ? docNo(p.purchase.invoiceNumber.replace(/^сч[её]т\s*/i, "")) : ""],
      ["Основание", p.docRef?.trim() ?? ""],
      ["Заметка", cleanNote(p.notes) ?? ""],
      ["Подтверждение", p.confirmedAt ? `подтверждена ${ruDate(p.confirmedAt)}` : "ждёт платёжку / проверки"],
      ["Документы", String((p.documentId ? 1 : 0) + p._count.driveDocuments)],
      ["Распределено", unlinked ? "не распределён: 0,00 ₽ из " + money(amount) : `${money(amount)} из ${money(amount)}`],
      ["Остаток по платежу", unlinked ? money(amount) : "—"],
      ["Внесена", ruDate(p.createdAt)],
    ];
    const rawLinks: { label: string; href: string }[] = [
      ...(p.purchase ? [{ label: `Закупка ${p.purchase.number}`, href: `/purchases/${p.purchase.id}` }] : []),
      ...(au ? [{ label: `Партия «${au}»`, href: `/payments?tab=suppliers&auction=${encodeURIComponent(au)}#auction-block` }] : []),
    ];
    out.push({
      fields: rawFields.filter(([, v]) => v !== ""),
      unallocated: unlinked ? amount : 0,
      links: rawLinks,
      edit: unlinked ? "advance" : p.purchaseId ? "purchase" : "auction",
      // Год сырьевой оплаты — год закупки (без аукциона: год заказа закупки): тогда по году «куплено − оплачено = долг» и все разделы сходятся.
      id: p.id, kind: "raw", iso: p.paidAt.toISOString().slice(0, 10), year: (!au && p.purchase?.orderDate ? p.purchase.orderDate.getUTCFullYear() : p.paidAt.getUTCFullYear()), amount,
      fur: amount - lining, lining, work: 0, hides: 0,
      label: au ?? p.purchase?.number ?? "Аванс без привязки",
      confirmed: p.confirmedAt != null,
      doc: p.docRef?.trim() || null,
      what: p.kind === "ADVANCE" ? "Аванс" : p.kind === "PARTIAL" ? "Доплата" : "Оплата",
      type: p.kind,
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
    // Несколько позиций одного ТЗ (одинаковый номер ТЗ) — одной строкой «ТЗ 118 (4 позиции)», суммы складываются.
    const byTz = new Map<string, { href: string; amount: number; n: number }>();
    for (const x of p.allocations) {
      if (x.amount.toNumber() === 0) continue;
      const key = x.productionOrder.workOrderNumber?.trim() || x.productionOrder.number;
      const cur = byTz.get(key);
      if (cur) { cur.amount += x.amount.toNumber(); cur.n += 1; } else byTz.set(key, { href: `/production/${x.productionOrder.id}`, amount: x.amount.toNumber(), n: 1 });
    }
    const posWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "позиция" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "позиции" : "позиций");
    const parts: OverviewPart[] = Array.from(byTz, ([key, v]) => ({ label: v.n > 1 ? `ТЗ ${key} (${v.n} ${posWord(v.n)})` : `ТЗ ${key}`, href: v.href, amount: Math.round(v.amount * 100) / 100 }));
    if (Math.abs(rest) > 0.5) parts.push({ label: hides > 0 ? "Шкуры подрядчика в составе счёта за пошив" : "Аванс без привязки к ТЗ", amount: rest });
    const orderIds = new Map<string, string>();
    for (const x of p.allocations) orderIds.set(x.productionOrder.id, x.productionOrder.workOrderNumber?.trim() || x.productionOrder.number);
    for (const x of p.orders) if (!orderIds.has(x.productionOrder.id)) orderIds.set(x.productionOrder.id, x.productionOrder.workOrderNumber?.trim() || x.productionOrder.number);
    const whatProd = p.paymentType === "ADVANCE" ? "Аванс" : p.paymentType === "PARTIAL" ? "Доплата" : "Оплата";
    const invP = invoiceOf(p.docRef);
    // Получатель — подрядчик по договору связанных ТЗ (client в ТЗ — это мы, заказчик по договору подряда).
    const contractor = contractorOfOrders([...p.allocations.map((x) => x.productionOrder.contractNumber), ...p.orders.map((x) => x.productionOrder.contractNumber)]);
    const prodFields: [string, string][] = [
      ["Дата оплаты", ruDate(p.paidAt)],
      ["Сумма", money(amount)],
      ["Вид оплаты", "За работу"],
      ["Тип", whatProd],
      ["Статья", hides > 0 ? `работа ${money(amount - hides)} · шкуры подрядчика ${money(hides)}` : `работа ${money(amount)}`],
      ["Плательщик", PAYER_NAME],
      ["Получатель", contractor.name],
      ["За что", orderIds.size > 0 ? parts.filter((x) => x.label.startsWith("ТЗ ")).map((x) => x.label).join(", ") || Array.from(new Set(orderIds.values())).map((n) => `ТЗ ${n}`).join(", ") : "Без привязки к ТЗ (аванс)"],
      ["Способ", METHOD_RU[p.method] ?? p.method],
      ["П/п", ppOf(p.docRef) ?? ""],
      ["Счёт", invP ? docNo(invP[1], invP[2]) : ""],
      ["Основание", p.docRef?.trim() ?? ""],
      ["Заметка", cleanNote(p.notes) ?? ""],
      ["Подтверждение", p.confirmedAt ? `подтверждена ${ruDate(p.confirmedAt)}` : "ждёт платёжку / проверки"],
      ["Документы", String(p._count.driveDocuments)],
      ["Распределено", `${money(alloc)} из ${money(amount)}`],
      ["Остаток по платежу", Math.abs(rest) > 0.5 ? money(rest) : "—"],
      ["Внесена", ruDate(p.createdAt)],
    ];
    out.push({
      fields: prodFields.filter(([, v]) => v !== ""),
      unallocated: Math.abs(rest) > 0.5 ? rest : 0,
      links: (() => {
        const seen = new Set<string>();
        const ls: { label: string; href: string }[] = [];
        const cnt = new Map<string, number>();
        for (const n of orderIds.values()) cnt.set(n, (cnt.get(n) ?? 0) + 1);
        for (const [id, n] of orderIds) {
          if (seen.has(n)) continue;
          seen.add(n);
          const c = cnt.get(n) ?? 1;
          ls.push({ label: c > 1 ? `ТЗ ${n} (${c} ${posWord(c)})` : `ТЗ ${n}`, href: `/production/${id}` });
        }
        return ls;
      })(),
      edit: "prod",
      id: p.id, kind: "prod", iso, year: p.paidAt.getUTCFullYear(), amount,
      fur: hides, lining: 0, work: amount - hides, hides,
      label: p.paymentType === "ADVANCE" ? "Аванс за пошив" : p.paymentType === "PARTIAL" ? "Доплата за пошив" : "Оплата за пошив",
      confirmed: p.confirmedAt != null,
      doc: p.docRef?.trim() || null,
      what: p.paymentType === "ADVANCE" ? "Аванс" : p.paymentType === "PARTIAL" ? "Доплата" : "Оплата",
      type: p.paymentType,
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
