import "server-only";
import { prisma } from "@/lib/prisma";
import { auctionName } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { isServicePurchase } from "@/lib/service-purchase";
import type { Live } from "@/app/(app)/reconciliation/live";
import type { Group, Invoice, Registry } from "@/app/(app)/reconciliation/model";

/** Закупки базы, которых нет ни в одной группе реестра: их надо внести в сверку («автоподхват»). Только чтение. */
export type OutsideBucket = {
  /** Ключ строки: название аукциона либо номер закупки без аукциона. */
  key: string;
  title: string;
  numbers: string[];
  counterparty: string;
  total: number;
  orderYear: number;
  /** Подсказка для формы: номер/дата/сумма УПД и счёта из закупок. */
  invoiceNo: string;
  invoiceDate: string;
  updNo: string;
  /** Группы раздела «закупки», в которые можно добавить закупки (по совпадению названия аукциона — первой). */
  suggestGroupId: string | null;
};

export async function loadOutsidePurchases(orgId: string, reg: Registry): Promise<OutsideBucket[]> {
  const inGroup = new Set<string>();
  for (const g of reg.groups) for (const n of g.dbLink.purchases ?? []) inGroup.add(n);
  const ps = await prisma.purchase.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" } },
    select: {
      number: true, status: true, orderDate: true, auctionSession: true, exchangeRate: true, invoiceNumber: true, invoiceDate: true, transferDocument: true,
      supplier: { select: { name: true } },
      items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } },
      expenses: { select: { amount: true, vatRate: true } },
    },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
  });
  const out = new Map<string, OutsideBucket>();
  for (const p of ps) {
    if (inGroup.has(p.number) || isServicePurchase(p)) continue;
    const name = auctionName(p.auctionSession);
    const key = name && !/^нет информации$/i.test(name) ? name : p.number;
    const b = out.get(key) ?? { key, title: key, numbers: [], counterparty: p.supplier.name, total: 0, orderYear: p.orderDate.getUTCFullYear(), invoiceNo: "", invoiceDate: "", updNo: "", suggestGroupId: null };
    b.numbers.push(p.number);
    b.total += Number(purchaseTotalInclVat(p).toString());
    b.orderYear = Math.min(b.orderYear, p.orderDate.getUTCFullYear());
    if (!b.invoiceNo && p.invoiceNumber) {
      b.invoiceNo = p.invoiceNumber;
      b.invoiceDate = p.invoiceDate ? p.invoiceDate.toISOString().slice(0, 10) : "";
    }
    if (!b.updNo && p.transferDocument) b.updNo = p.transferDocument;
    out.set(key, b);
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/g, "");
  const purchaseGroups = reg.groups.filter((g) => g.section === "purchase");
  return [...out.values()].map((b) => {
    b.total = Math.round(b.total * 100) / 100;
    const hit = purchaseGroups.find((g) => norm(g.title) === norm(b.title) || norm(g.title).startsWith(norm(b.title)));
    b.suggestGroupId = hit?.dbId ?? null;
    return b;
  });
}

// ---------------------------------------------------------------------------------------------------- кандидаты для привязки платежа

export type PayCandidate = { value: string; label: string; amount: number; date: string };

/** Платежи базы, ещё не привязанные ни к одному счёту реестра, ближайшие к остатку счёта по сумме и дате. */
export async function loadPayCandidates(orgId: string, live: Live, invoices: Invoice[], group: Group): Promise<Map<string, PayCandidate[]>> {
  const [pays, prods] = await Promise.all([
    prisma.payment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, amount: true, paidAt: true, docRef: true, purchase: { select: { number: true } }, auctionSession: true }, orderBy: { paidAt: "desc" }, take: 600 }),
    prisma.productionPayment.findMany({ where: { organizationId: orgId, status: "COMPLETED" }, select: { id: true, amount: true, paidAt: true, docRef: true }, orderBy: { paidAt: "desc" }, take: 600 }),
  ]);
  const all: PayCandidate[] = [];
  const fmt = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
  const rub = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const p of pays) {
    if (live.matchedPay.has(`p:${p.id}`)) continue;
    all.push({ value: `p:${p.id}`, amount: Number(p.amount.toString()), date: p.paidAt.toISOString().slice(0, 10), label: `${fmt(p.paidAt)} · ${rub(Number(p.amount.toString()))} ₽ · ${p.purchase?.number ?? p.auctionSession ?? "без привязки"}${p.docRef ? " · " + p.docRef.slice(0, 40) : ""}` });
  }
  for (const p of prods) {
    if (live.matchedPay.has(`q:${p.id}`)) continue;
    all.push({ value: `q:${p.id}`, amount: Number(p.amount.toString()), date: p.paidAt.toISOString().slice(0, 10), label: `${fmt(p.paidAt)} · ${rub(Number(p.amount.toString()))} ₽ · оплата производства${p.docRef ? " · " + p.docRef.slice(0, 40) : ""}` });
  }
  const out = new Map<string, PayCandidate[]>();
  void group;
  for (const inv of invoices) {
    const docs = inv.paid.filter((x) => x.evidence === "fact").reduce((a, x) => a + x.amountRub, 0);
    const want = Math.max(0, inv.amountRub - (live.inv.get(inv.id)?.paid ?? 0));
    const target = want > 0 ? want : docs || inv.amountRub;
    const t = inv.date ? Date.parse(inv.date) : null;
    const score = (c: PayCandidate) => Math.abs(c.amount - target) / Math.max(1, target) + (t ? Math.min(1, Math.abs(Date.parse(c.date) - t) / (365 * 86_400_000)) * 0.2 : 0);
    out.set(inv.id, [...all].sort((a, b) => score(a) - score(b)).slice(0, 25));
  }
  return out;
}

/** Документы Drive, в названии которых встречается номер счёта (для «Привязать документ»). */
export async function loadDocCandidates(orgId: string, invoices: Invoice[]): Promise<Map<string, { id: string; title: string }[]>> {
  const nos = [...new Set(invoices.map((i) => i.no).filter((x): x is string => !!x && /\d/.test(x)))];
  const out = new Map<string, { id: string; title: string }[]>();
  if (!nos.length) return out;
  const docs = await prisma.driveDocument.findMany({
    where: { organizationId: orgId, OR: nos.map((n) => ({ title: { contains: n } })) },
    select: { id: true, title: true },
    take: 300,
  });
  for (const inv of invoices) {
    if (!inv.no) continue;
    const re = new RegExp(`(^|[^0-9])${inv.no.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`);
    out.set(inv.id, docs.filter((d) => re.test(d.title)).slice(0, 20));
  }
  return out;
}
