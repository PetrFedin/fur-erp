import "server-only";
import { prisma } from "@/lib/prisma";
import { parseYmd, ymd } from "@/lib/calendar-grid";
import type { FactItem } from "@/lib/calendar-layers";
import { AUCTION_ACTION, auctionStatus, auctionTitle, normName, toAuctionMark } from "@/lib/auction-calendar";

/**
 * Слой «Аукционы»: (1) отметки, которые внёс Веллмех (будущие и прошлые);
 * (2) прошедшие аукционы из наших закупок: дата торгов из справочника аукционов (Auction.auctionDate),
 * а если её там нет — дата этапа «Куплено на аукционе», который внёс Веллмех. Будущие даты сами не выдумываем.
 */
export async function loadAuctionFacts(orgId: string, from: string, to: string, today: string): Promise<FactItem[]> {
  const gte = parseYmd(from), lte = parseYmd(to);
  const [marks, refs, bought] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { organizationId: orgId, action: AUCTION_ACTION, date: { gte, lte } }, orderBy: { date: "asc" } }),
    prisma.auction.findMany({
      where: { organizationId: orgId, isService: false, auctionDate: { gte, lte }, purchases: { some: {} } },
      select: { id: true, name: true, house: true, auctionDate: true, purchases: { select: { id: true }, take: 1 } },
    }),
    prisma.supplierRawStage.findMany({
      where: { organizationId: orgId, stage: "AUCTION_BOUGHT", OR: [{ factStart: { gte, lte } }, { factEnd: { gte, lte } }, { plannedStart: { gte, lte } }] },
      select: { purchaseId: true, place: true, status: true, factStart: true, factEnd: true, plannedStart: true, purchase: { select: { auctionId: true, auction: { select: { name: true, house: true, auctionDate: true } } } } },
    }),
  ]);
  const items: FactItem[] = [];
  const seen = new Set<string>(); // название+дата — чтобы отметка Веллмеха и запись из закупок не дублировались
  const key = (name: string, date: string) => `${normName(name)}|${date}`;
  for (const m of marks) {
    const a = toAuctionMark(m);
    seen.add(key(a.name, a.date));
    const st = auctionStatus(a.date, today);
    items.push({ id: `au-${m.id}`, kind: "auction", date: a.date, title: auctionTitle(a), qty: null, by: "внёс Веллмех", label: `${st}${a.participate && st === "запланирован" ? " · планируем участвовать" : ""}`, href: `/calendar?day=${a.date}` });
  }
  // Место проведения — со стороны Веллмеха (этап «Куплено на аукционе»).
  const placeByAuction = new Map<string, string>();
  for (const b of bought) if (b.purchase.auctionId && b.place) placeByAuction.set(b.purchase.auctionId, b.place);
  for (const r of refs) {
    const date = ymd(r.auctionDate!);
    if (date > today || seen.has(key(r.name, date))) continue;
    seen.add(key(r.name, date));
    items.push({ id: `aur-${r.id}`, kind: "auction", date, title: auctionTitle({ name: r.name, house: r.house ?? "", place: placeByAuction.get(r.id) ?? "" }), qty: null, label: "прошёл", href: `/purchases/${r.purchases[0].id}` });
  }
  // Аукционы без даты торгов в справочнике: берём дату этапа «Куплено на аукционе» (внёс Веллмех).
  for (const b of bought) {
    const au = b.purchase.auction;
    if (!au || au.auctionDate) continue;
    const d = b.status === "DONE" ? b.factEnd ?? b.factStart : b.factStart ?? b.plannedStart;
    if (!d || d < gte || d > lte || ymd(d) > today) continue;
    const date = ymd(d);
    if (seen.has(key(au.name, date))) continue;
    seen.add(key(au.name, date));
    items.push({ id: `aub-${b.purchaseId}`, kind: "auction", date, title: auctionTitle({ name: au.name, house: au.house ?? "", place: b.place ?? "" }), qty: null, label: "прошёл", href: `/purchases/${b.purchaseId}` });
  }
  return items;
}
