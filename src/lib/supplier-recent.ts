import "server-only";
import { prisma } from "@/lib/prisma";
import { MARKS_TITLE, markConfirmed, markOf } from "@/lib/shipment-marks";
import { CONFIRMED_WHERE, PAY_KIND_LABEL } from "@/lib/supplier-pay-core";
import { formatMoney } from "@/lib/utils";

/** Куки «просмотрено до»: метка времени (мс), когда Веллмех последний раз открывал «Контроль». */
import { RECENT_COOKIE } from "@/lib/supplier-recent-const";
export { RECENT_COOKIE };
export const RECENT_DAYS = 14;

export type RecentItem = { key: string; at: Date; text: string; href: string; tone: "ok" | "back" };

const KIND_WORD: Record<string, string> = { AUCTION_CALC: "расчёт", TZ: "ТЗ", DOCUMENT: "документ" };
const hrefOf = (kind: string, id: string) => (kind === "TZ" ? `/supplier/tz/${id}` : kind === "AUCTION_CALC" ? `/supplier/auction-calcs/${id}` : "/supplier/raw");
const ru = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

/**
 * «Недавнее» для Веллмеха: решения по его входящим (принято / возвращено) за 14 дней и отметки примерки, которые мы учли.
 * Без миграции: статусы и decidedAt у SupplierInbox, отметки — этап «Отметки Веллмеха по примерке», учёт — стадия строки.
 */
export async function loadRecent(orgId: string, supplierId: string, now = new Date()): Promise<RecentItem[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const [inbox, shipments] = await Promise.all([
    prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, status: { in: ["ACCEPTED", "REJECTED"] }, decidedAt: { gte: since } }, orderBy: { decidedAt: "desc" }, take: 30, select: { id: true, kind: true, status: true, title: true, reviewNote: true, decidedAt: true } }),
    prisma.shipment.findMany({
      where: { organizationId: orgId, supplierId, events: { some: { title: MARKS_TITLE } } },
      select: { id: true, name: true, plannedDate: true, lines: { select: { id: true, stage: true, stageChangedAt: true } }, events: { where: { title: MARKS_TITLE }, select: { lines: { select: { shipmentLineId: true, accepted: true, rejected: true, comment: true } } } } },
    }),
  ]);
  const out: RecentItem[] = inbox.map((r) => ({
    key: `i-${r.id}`, at: r.decidedAt!, tone: r.status === "ACCEPTED" ? "ok" : "back", href: hrefOf(r.kind, r.id),
    text: r.status === "ACCEPTED" ? `Принято нами: ${KIND_WORD[r.kind] ?? "документ"} «${r.title}» (${ru(r.decidedAt!)})` : `Возвращено: ${KIND_WORD[r.kind] ?? "документ"} «${r.title}»${r.reviewNote ? ` — ${r.reviewNote}` : ""} (${ru(r.decidedAt!)})`,
  }));
  for (const sh of shipments) {
    const marks = new Map(sh.events.flatMap((e) => e.lines).map((l) => { const m = markOf(l); return [l.shipmentLineId, m] as const; }));
    const done = sh.lines.filter((l) => { const m = marks.get(l.id); return m && markConfirmed(m.kind, l.stage) && l.stageChangedAt && l.stageChangedAt >= since; });
    if (done.length === 0) continue;
    const at = done.reduce((a, l) => (l.stageChangedAt! > a ? l.stageChangedAt! : a), done[0].stageChangedAt!);
    out.push({ key: `m-${sh.id}`, at, tone: "ok", href: `/shipments/${sh.id}`, text: `Мы подтвердили ваши отметки примерки: ${sh.name ?? "Отгрузка"}, строк: ${done.length} (${ru(at)})` });
  }
  out.push(...(await loadRecentPayments(orgId, supplierId, since)));
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Оплаты, проведённые за 14 дней (видны сразу, как оплатили): «Оплата проведена (аванс): ... — сумма (дата)». Только оплаты этого подрядчика —
 * сырьё (Payment) и работа (оплата, разнесённая на его ТЗ). Плановые и отменённые сюда не попадают;
 * неразнесённые авансы и остатки заказчика — тем более.
 */
async function loadRecentPayments(orgId: string, supplierId: string, since: Date): Promise<RecentItem[]> {
  const [raw, work, tzRows] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: orgId, supplierId, ...CONFIRMED_WHERE, paidAt: { gte: since } },
      select: { id: true, amount: true, kind: true, paidAt: true, createdAt: true, invoiceNo: true, auctionSession: true, purchaseId: true, purchase: { select: { id: true, number: true, invoiceNumber: true, auction: { select: { name: true } } } } },
      orderBy: { paidAt: "desc" }, take: 30,
    }),
    prisma.paymentAllocation.findMany({
      where: { organizationId: orgId, productionOrder: { contractorId: supplierId }, productionPayment: { ...CONFIRMED_WHERE, paidAt: { gte: since } } },
      select: { amount: true, productionOrderId: true, productionOrder: { select: { workOrderNumber: true, number: true } }, productionPayment: { select: { id: true, paymentType: true, paidAt: true, createdAt: true } } },
      take: 200,
    }),
    prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, kind: "TZ", status: "ACCEPTED", createdEntityType: "ProductionOrder" }, select: { id: true, createdEntityId: true } }),
  ]);
  const out: RecentItem[] = raw.map((p) => {
    const what = p.purchase ? (p.purchase.auction?.name ?? p.auctionSession?.split(/\r?\n/)[0] ?? p.purchase.number) + (p.purchase.invoiceNumber ? `, счёт ${p.purchase.invoiceNumber}` : "") : (p.auctionSession?.split(/\r?\n/)[0] || (p.invoiceNo ? `счёт ${p.invoiceNo}` : "оплата"));
    return { key: `p-${p.id}`, at: p.createdAt, tone: "ok" as const, href: p.purchase ? `/supplier/raw/${p.purchase.id}` : "/supplier/raw", text: `Оплата проведена (${(PAY_KIND_LABEL[p.kind] ?? "оплата").toLowerCase()}): ${what} — ${formatMoney(Number(p.amount))} (${ru(p.paidAt)})` };
  });
  const byPay = new Map<string, { at: Date; paidAt: Date; kind: string; sum: number; nums: string[]; order: string }>();
  for (const a of work) {
    const cur = byPay.get(a.productionPayment.id) ?? { at: a.productionPayment.createdAt, paidAt: a.productionPayment.paidAt, kind: a.productionPayment.paymentType, sum: 0, nums: [], order: a.productionOrderId };
    cur.sum += Number(a.amount);
    cur.nums.push(a.productionOrder.workOrderNumber?.trim() || a.productionOrder.number);
    byPay.set(a.productionPayment.id, cur);
  }
  for (const [id, v] of byPay) {
    const inbox = tzRows.find((r) => (r.createdEntityId ?? "").split(",").includes(v.order));
    out.push({ key: `w-${id}`, at: v.at, tone: "ok", href: inbox ? `/supplier/tz/${inbox.id}` : "/supplier/tz", text: `Оплата за работу проведена (${(PAY_KIND_LABEL[v.kind] ?? "оплата").toLowerCase()}): ТЗ ${[...new Set(v.nums)].slice(0, 3).join(", ")} — ${formatMoney(v.sum)} (${ru(v.paidAt)})` });
  }
  return out;
}

/** Сколько решений по входящим появилось после последнего просмотра (для точки в меню). */
export async function countNewDecisions(orgId: string, supplierId: string, seenMs: number | null, now = new Date()): Promise<number> {
  const floor = now.getTime() - RECENT_DAYS * 86_400_000;
  const after = new Date(Math.max(floor, seenMs ?? 0));
  const [decisions, pays, workPays] = await Promise.all([
    prisma.supplierInbox.count({ where: { organizationId: orgId, supplierId, status: { in: ["ACCEPTED", "REJECTED"] }, decidedAt: { gt: after } } }),
    prisma.payment.count({ where: { organizationId: orgId, supplierId, ...CONFIRMED_WHERE, paidAt: { gte: new Date(floor) }, createdAt: { gt: after } } }),
    prisma.productionPayment.count({ where: { organizationId: orgId, ...CONFIRMED_WHERE, paidAt: { gte: new Date(floor) }, createdAt: { gt: after }, allocations: { some: { productionOrder: { contractorId: supplierId } } } } }),
  ]);
  return decisions + pays + workPays;
}
