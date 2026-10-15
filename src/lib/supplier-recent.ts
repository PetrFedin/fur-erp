import "server-only";
import { prisma } from "@/lib/prisma";
import { MARKS_TITLE, markConfirmed, markOf } from "@/lib/shipment-marks";

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
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Сколько решений по входящим появилось после последнего просмотра (для точки в меню). */
export async function countNewDecisions(orgId: string, supplierId: string, seenMs: number | null, now = new Date()): Promise<number> {
  const floor = now.getTime() - RECENT_DAYS * 86_400_000;
  const after = new Date(Math.max(floor, seenMs ?? 0));
  return prisma.supplierInbox.count({ where: { organizationId: orgId, supplierId, status: { in: ["ACCEPTED", "REJECTED"] }, decidedAt: { gt: after } } });
}
