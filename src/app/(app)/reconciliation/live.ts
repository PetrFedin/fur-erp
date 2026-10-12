import { tzCountText } from "@/lib/tz-key";
import { auctionKey } from "@/lib/auction-key";
import "server-only";
import { prisma } from "@/lib/prisma";
import { auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { batchTotals, loadBatchesWithOrders } from "@/lib/batch-stats";
import { ALL_GROUPS, ALL_INVOICES, docRefNo, type Group, type Invoice } from "./model";

// ЖИВОЙ расчёт «в базе»: при каждом заходе читаем Payment / ProductionPayment / закупки / партии из БД.
// Строки документов (счета, платежи по документам) берутся из JSON; цифры базы — только отсюда. Запись в БД не выполняется.

export type DbPay = { amount: number; paidAt: string; docRef: string | null; confirmed: boolean; label: string };
export type InvDb = { paid: number; pays: DbPay[] };
export type GroupDb = { cost: number | null; paid: number; pays: number; note: string | null; /** Короткие имена аукционов из справочника у закупок группы. */ auctions?: string[]; /** Название группы с коротким именем аукциона из справочника вместо прежнего написания в начале. */ title?: string };
export type Live = {
  inv: Map<string, InvDb>;
  group: Map<string, GroupDb>;
  /** Платежи БД со ссылкой на счёт Веллмех, которого нет в реестре. */
  orphans: DbPay[];
  loadedAt: string;
};

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function pickInvoice(cands: Invoice[], ref: { no: string; date: string | null }, paidAt: string): Invoice | null {
  const same = cands.filter((i) => i.no === ref.no);
  if (!same.length) return null;
  if (ref.date) {
    const exact = same.find((i) => i.date === ref.date);
    if (exact) return exact;
  }
  // без даты в docRef — ближайший счёт этого номера, выставленный не позже оплаты
  const before = same.filter((i) => (i.date ?? `${i.year}-12-31`) <= paidAt).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return before[0] ?? same[0];
}

export async function loadLive(orgId: string): Promise<Live> {
  const [payments, prodPayments, purchases, batches, refAuctions] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, docRef: true, confirmed: true, auctionSession: true, purchase: { select: { number: true } } },
    }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, status: "COMPLETED" },
      select: { id: true, amount: true, paidAt: true, docRef: true, confirmed: true, notes: true },
    }),
    prisma.purchase.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, number: true, status: true, auctionSession: true, auctionId: true, exchangeRate: true, orderDate: true,
        items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } },
        expenses: { select: { amount: true, vatRate: true } },
      },
    }),
    loadBatchesWithOrders(orgId),
    prisma.auction.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, isService: true } }),
  ]);

  const inv = new Map<string, InvDb>();
  const orphans: DbPay[] = [];
  const purchaseInv = ALL_INVOICES.filter((i) => i.section === "purchase");
  const prodInv = ALL_INVOICES.filter((i) => i.section === "production");
  const put = (i: Invoice, p: DbPay) => {
    const cur = inv.get(i.id) ?? { paid: 0, pays: [] };
    cur.paid += p.amount;
    cur.pays.push(p);
    inv.set(i.id, cur);
  };
  for (const p of payments) {
    const dp: DbPay = { amount: n(p.amount), paidAt: ymd(p.paidAt), docRef: p.docRef, confirmed: p.confirmed, label: p.purchase?.number ?? p.auctionSession ?? "без привязки" };
    const ref = docRefNo(p.docRef);
    const hit = ref ? pickInvoice(purchaseInv, ref, dp.paidAt) : null;
    if (hit) put(hit, dp);
    else if (ref) orphans.push(dp);
  }
  for (const p of prodPayments) {
    const dp: DbPay = { amount: n(p.amount), paidAt: ymd(p.paidAt), docRef: p.docRef, confirmed: p.confirmed, label: "оплата производства" };
    const ref = docRefNo(p.docRef);
    const hit = ref ? pickInvoice(prodInv, ref, dp.paidAt) : null;
    if (hit) put(hit, dp);
    else if (ref) orphans.push(dp);
  }

  // ---------- группы
  const group = new Map<string, GroupDb>();
  const pByNo = new Map(purchases.map((p) => [p.number, p]));
  for (const g of ALL_GROUPS as Group[]) {
    if (g.section === "purchase") {
      const nos = g.dbLink.purchases ?? [];
      const ps = nos.map((x) => pByNo.get(x)).filter((x): x is NonNullable<typeof x> => !!x);
      if (!ps.length) {
        group.set(g.id, { cost: null, paid: 0, pays: 0, note: "в базе нет закупок по этой группе" });
        continue;
      }
      const names = new Set(ps.map((p) => auctionName(p.auctionSession)).filter((x): x is string => !!x && !/^нет информации$/i.test(x)));
      // Справочник аукционов: после переименования оплаты аукциона находятся и по прежним написаниям (алиасам).
      const refKeys = new Set<string>();
      for (const p of ps) {
        const a = p.auctionId ? refAuctions.find((x) => x.id === p.auctionId) : undefined;
        if (a && !a.name.match(/^без аукциона$/i)) for (const v of [a.name, ...a.aliases]) refKeys.add(auctionKey(v));
      }
      const cost = ps.filter((p) => p.status !== "CANCELLED").reduce((a, p) => a + n(purchaseTotalInclVat(p)), 0);
      const mine = payments.filter((p) => (p.purchase && ps.some((q) => q.number === p.purchase?.number)) || (p.auctionSession && (names.has(auctionName(p.auctionSession) ?? "") || refKeys.has(auctionKey(p.auctionSession)))));
      const linked = [...new Map(ps.map((p) => (p.auctionId ? refAuctions.find((x) => x.id === p.auctionId) : undefined)).filter((a): a is NonNullable<typeof a> => !!a && !a.isService).map((a) => [a.id, a])).values()];
      const auctions = linked.map((a) => a.name);
      let title: string | undefined;
      for (const a of linked) {
        if (auctionKey(g.title) === auctionKey(a.name) && g.title !== a.name) { title = a.name; break; }
        // Название группы пришло из документов Drive и начинается с прежнего написания («SAGA 03-25», «КФХ Дуденко Л. Н. (…)») — показываем короткое имя.
        const old = [a.name, ...a.aliases].find((v) => g.title.toLowerCase().startsWith(v.toLowerCase()));
        if (old && old !== a.name) { title = a.name + g.title.slice(old.length); break; }
      }
      group.set(g.id, { cost: Math.round(cost * 100) / 100, paid: Math.round(mine.reduce((a, p) => a + n(p.amount), 0) * 100) / 100, pays: mine.length, note: null, auctions, title });
    } else if (g.dbLink.batch != null) {
      const b = batches.find((x) => x.number === g.dbLink.batch);
      if (!b || !b.orders.length) {
        group.set(g.id, { cost: null, paid: 0, pays: 0, note: "в базе нет ТЗ этой партии" });
        continue;
      }
      const t = batchTotals(b.orders);
      group.set(g.id, { cost: n(t.work), paid: n(t.paidGross), pays: b.orders.reduce((a, o) => a + o.paymentAllocations.length, 0), note: tzCountText(t.orders, t.items) });
    } else {
      // авансы, аксессуары, индивидуальные: по платежам, привязанным к счетам группы
      const invs = ALL_INVOICES.filter((i) => i.groupIds.includes(g.id));
      const paid = invs.reduce((a, i) => a + (inv.get(i.id)?.paid ?? 0), 0);
      group.set(g.id, { cost: null, paid, pays: invs.reduce((a, i) => a + (inv.get(i.id)?.pays.length ?? 0), 0), note: invs.length ? "платежи по счетам группы" : "в базе нет данных" });
    }
  }
  return { inv, group, orphans, loadedAt: new Date().toISOString() };
}
