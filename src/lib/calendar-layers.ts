import "server-only";
import { prisma } from "@/lib/prisma";
import { ymd, parseYmd } from "@/lib/calendar-grid";
import { escapeLike } from "@/lib/input";
import { modelCodeVariants } from "@/lib/model-code";
import { STATUS_LABELS, type SupplyPlanStatusValue } from "@/app/(app)/supply-plan/status";
import type { LayerKind } from "@/lib/calendar-actions";
import { articleLabel } from "@/lib/article-label";

// Слой «факты» производственного календаря: только чтение, ничего не копируется в CalendarEvent.
// Источники: SupplyPlanEntry (дата этапа), Shipment.plannedDate, Fitting.fittingDate, ProductionOrder.endDate.

export type FactItem = { id: string; kind: LayerKind; date: string; title: string; qty: number | null; label: string; href: string; /** ТЗ, к которому относится факт (карточка в календаре). */ orderId?: string };
export type MonthLevelItem = { id: string; title: string; qty: number; label: string };

export async function loadFactLayer(organizationId: string, from: string, to: string, opts: { article?: string; month: string }) {
  const gte = parseYmd(from);
  const lte = parseYmd(to);
  const art = opts.article?.trim();
  const nameFilter = art ? { OR: modelCodeVariants(art).map((v) => ({ name: { contains: escapeLike(v), mode: "insensitive" as const } })) } : undefined;

  const monthStart = parseYmd(`${opts.month}-01`);
  const [supply, shipments, fittings, orders] = await Promise.all([
    prisma.supplyPlanEntry.findMany({
      where: {
        organizationId,
        status: { not: "CANCELLED" },
        OR: [{ eventDate: { gte, lte } }, { eventDate: null, month: monthStart }],
        ...(nameFilter ? { productModel: nameFilter } : {}),
      },
      select: { id: true, status: true, quantity: true, eventDate: true, notes: true, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } },
    }),
    prisma.shipment.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, plannedDate: { gte, lte }, ...(nameFilter ? { lines: { some: { productionOrder: { productModel: nameFilter } } } } : {}) },
      select: { id: true, plannedDate: true, status: true, client: { select: { name: true } }, lines: { select: { quantity: true, productionOrder: { select: { productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } } } } } },
    }),
    prisma.fitting.findMany({
      where: { organizationId, fittingDate: { gte, lte }, ...(nameFilter ? { productionOrder: { productModel: nameFilter } } : {}) },
      select: { id: true, fittingDate: true, status: true, size: true, productionOrder: { select: { id: true, workOrderNumber: true, number: true, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } } } },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, endDate: { gte, lte }, ...(nameFilter ? { productModel: nameFilter } : {}) },
      select: { id: true, workOrderNumber: true, number: true, endDate: true, plannedQuantity: true, producedQuantity: true, status: true, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } },
    }),
  ]);

  const items: FactItem[] = [];
  const monthLevel: MonthLevelItem[] = [];
  for (const s of supply) {
    const label = STATUS_LABELS[s.status as SupplyPlanStatusValue] ?? s.status;
    if (s.eventDate) {
      items.push({ id: `sp-${s.id}`, kind: "supply", date: ymd(s.eventDate), title: articleLabel(s.productModel), qty: Number(s.quantity), label, href: "/supply-plan" });
    } else {
      monthLevel.push({ id: s.id, title: articleLabel(s.productModel), qty: Number(s.quantity), label });
    }
  }
  for (const sh of shipments) {
    const qty = sh.lines.reduce((a, l) => a + l.quantity, 0);
    const names = [...new Set(sh.lines.map((l) => articleLabel(l.productionOrder.productModel)))];
    items.push({ id: `sh-${sh.id}`, kind: "shipment", date: ymd(sh.plannedDate), title: names.slice(0, 2).join(", ") + (names.length > 2 ? "…" : "") || "Отгрузка", qty, label: sh.client?.name ? `Отгрузка: ${sh.client.name}` : "Отгрузка", href: `/shipments/${sh.id}` });
  }
  for (const f of fittings) {
    const o = f.productionOrder;
    items.push({ id: `ft-${f.id}`, kind: "fitting", date: ymd(f.fittingDate), title: articleLabel(o.productModel), qty: null, label: `Примерка${f.size ? ` (${f.size})` : ""} · ${o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : o.number}`, href: `/fittings/${f.id}`, orderId: o.id });
  }
  for (const o of orders) {
    items.push({ id: `or-${o.id}`, kind: "order", date: ymd(o.endDate!), title: articleLabel(o.productModel), qty: Number(o.plannedQuantity), label: `Окончание ${o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : o.number}`, href: `/production/${o.id}`, orderId: o.id });
  }
  return { items, monthLevel };
}
