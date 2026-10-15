import "server-only";
import { prisma } from "@/lib/prisma";
import { parseYmd, ymd } from "@/lib/calendar-grid";
import type { FactItem } from "@/lib/calendar-layers";
import { AUCTION_ACTION, auctionStatus, auctionTitle, toAuctionMark } from "@/lib/auction-calendar";
import { loadRawFacts } from "@/lib/raw-calendar";

/** Слои календаря в кабинете Веллмеха. Только его собственные данные: без клиентов, цен и наших внутренних номеров. */
export const SUP_LAYERS = [
  { key: "auction", label: "Аукционы" },
  { key: "shipment", label: "Отгрузки" },
  { key: "raw", label: "Этапы сырья" },
  { key: "tz", label: "ТЗ" },
] as const;
export type SupLayerKey = (typeof SUP_LAYERS)[number]["key"];
export const SUP_LAYER_DEFAULT: SupLayerKey[] = ["auction", "raw"];

const SHIP_LABEL: Record<string, string> = { PLANNED: "запланирована", SHIPPED: "отгружена", ACCEPTED: "принята", CANCELLED: "отменена" };
const TZ_LABEL: Record<string, string> = { SENT: "отправлено нам", ACCEPTED: "принято нами", REJECTED: "возвращено на доработку" };

export async function loadSupplierLayers(orgId: string, supplierId: string, layers: Set<string>, from: string, to: string, today: string): Promise<FactItem[]> {
  const gte = parseYmd(from), lte = parseYmd(to);
  const lteEnd = new Date(lte.getTime() + 86_400_000 - 1);
  const [auctions, shipments, raw, tz] = await Promise.all([
    layers.has("auction") ? prisma.calendarEvent.findMany({ where: { organizationId: orgId, supplierId, action: AUCTION_ACTION, date: { gte, lte } } }) : [],
    layers.has("shipment") ? prisma.shipment.findMany({ where: { organizationId: orgId, supplierId, status: { not: "CANCELLED" }, plannedDate: { gte, lte } }, select: { id: true, name: true, plannedDate: true, status: true, lines: { select: { quantity: true } } } }) : [],
    layers.has("raw") ? loadRawFacts(orgId, from, to, supplierId) : [],
    layers.has("tz") ? prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, kind: "TZ", status: { in: ["SENT", "ACCEPTED", "REJECTED"] }, OR: [{ sentAt: { gte, lte: lteEnd } }, { decidedAt: { gte, lte: lteEnd } }] }, select: { id: true, title: true, status: true, sentAt: true, decidedAt: true } }) : [],
  ]);
  const items: FactItem[] = [];
  for (const m of auctions) {
    const a = toAuctionMark(m);
    items.push({ id: `au-${m.id}`, kind: "auction", date: a.date, title: auctionTitle(a), qty: null, label: auctionStatus(a.date, today), href: `/supplier/calendar?g=${a.date.slice(0, 7)}` });
  }
  for (const s of shipments) {
    items.push({ id: `sh-${s.id}`, kind: "shipment", date: ymd(s.plannedDate), title: s.name ?? "Отгрузка", qty: s.lines.reduce((a, l) => a + l.quantity, 0) || null, label: `Отгрузка: ${SHIP_LABEL[s.status] ?? s.status}`, href: `/shipments/${s.id}` });
  }
  for (const r of raw) items.push({ ...r, href: r.href.replace("/purchases/", "/supplier/raw/") });
  for (const t of tz) {
    // Отметка на день, когда ТЗ ушло к нам, и (если решение принято) на день решения.
    const sent = t.sentAt ? ymd(t.sentAt) : null;
    const dec = t.decidedAt ? ymd(t.decidedAt) : null;
    if (sent && sent >= from && sent <= to) items.push({ id: `tz-s-${t.id}`, kind: "order", date: sent, title: t.title, qty: null, label: "ТЗ отправлено нам", href: `/supplier/tz/${t.id}` });
    if (dec && dec >= from && dec <= to && t.status !== "SENT") items.push({ id: `tz-d-${t.id}`, kind: "order", date: dec, title: t.title, qty: null, label: `ТЗ ${TZ_LABEL[t.status]}`, href: `/supplier/tz/${t.id}` });
  }
  return items;
}
