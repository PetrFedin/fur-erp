import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { orderLabel } from "@/lib/order-label";
import { relabelOrders as relabel } from "@/lib/order-label-db";
import { requireSession } from "@/lib/session";
import { usageExclVat } from "@/lib/commission4";
import { zero, usageRowPick, type RawLot, LOT_INCLUDE, K4, producedDec, ORDER_BRIEF, orderDateOf, categoryOfOrder, usageRowOf, USAGE_SELECT } from "./shared";
import { buildLot, lotIssues, isDormant, isOverused, daysSince, usageByLot } from "./is-usage-by";

// ───────────── «лот → изделия» и «изделие → лоты» ─────────────

export type LotOrderRow = {
  orderId: string;
  number: string;
  wo: string | null;
  /** Единая подпись ТЗ («ТЗ 182 · поз. 1/3»). */
  label: string;
  orderDate: Date | null;
  modelId: string;
  modelName: string;
  sku: string | null;
  category: string;
  batchId: string | null;
  batchNumber: number | null;
  /** Произведено в ТЗ (всего, из всех лотов). */
  produced: Decimal;
  /** План ТЗ (показывается, пока ничего не произведено). */
  planned: Decimal;
  /** Списано из этого лота. */
  qty: Decimal;
  /** Списано в ТЗ из всех лотов того же материала (для доли лота). */
  orderQty: Decimal;
  orderLots: number;
  /** ≈ изделий из лота = произведено × доля лота в материале ТЗ. */
  unitsFromLot: Decimal | null;
  incl: Decimal;
  excl: Decimal;
  extraIncl: Decimal;
  extraExcl: Decimal;
};

export type HammerLine = { label: string; value: number };

export type LotPassport = {
  materialName: string;
  unit: string;
  grade: string | null;
  color: string | null;
  colorRef: string | null;
  warehouse: string;
  supplier: string | null;
  invoiceNumber: string | null;
  currency: string | null;
  exchangeRate: Decimal | null;
  purchaseDate: Date | null;
  receivedDate: Date;
  vatRate: Decimal;
  /** Цена позиции закупки за единицу в валюте закупки (без НДС), если позиция одна. */
  itemPrice: Decimal | null;
  hammer: HammerLine[];
  notes: string | null;
};

export type LotCard = { lot: RawLot; passport: LotPassport; orders: LotOrderRow[] };

/** Строки «молоток» из расчёта лота или позиции закупки (costPlan / costBreakdown). */
function hammerLines(sources: unknown[]): HammerLine[] {
  const out: HammerLine[] = [];
  for (const src of sources) {
    const root = src as { items?: unknown; costBreakdown?: { items?: unknown } } | null;
    const items = (Array.isArray(root?.items) ? root?.items : Array.isArray(root?.costBreakdown?.items) ? root?.costBreakdown?.items : []) as { label?: unknown; value?: unknown }[];
    for (const it of items) {
      if (typeof it?.label === "string" && /молоток/i.test(it.label) && typeof it.value === "number") out.push({ label: it.label, value: it.value });
    }
    if (out.length) break;
  }
  return out;
}

async function orgIdOf(organizationId?: string): Promise<string> {
  if (organizationId) return organizationId;
  const session = await requireSession();
  return session.user.organizationId;
}

/**
 * Карточка лота: паспорт, движение (журнал/лот/ТЗ) и ТЗ, в которых лот использован. null — лота нет в организации.
 * Без года: карточка показывает лот целиком. organizationId не обязателен — тогда берётся из сессии.
 */
export async function loadLotUsage(lotId: string, organizationId?: string): Promise<LotCard | null> {
  const orgId = await orgIdOf(organizationId);
  const row = await prisma.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: orgId },
    include: {
      ...LOT_INCLUDE,
      colorRef: { select: { name: true } },
      warehouse: { select: { name: true } },
      purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true, currency: true, exchangeRate: true, invoiceNumber: true, supplier: { select: { name: true } } } },
      purchaseItems: { select: { quantity: true, unitPrice: true, costPlan: true } },
    },
  });
  if (!row) return null;
  const lot = buildLot(row);

  const lines = await prisma.productionMaterialUsage.findMany({
    where: { lotId, productionOrder: { organizationId: orgId } },
    select: { id: true, quantity: true, totalCost: true, commission4: true, vatRate: true, date: true, productionOrder: { select: ORDER_BRIEF } },
    orderBy: { date: "asc" },
  });
  const orderIds = Array.from(new Set(lines.map((u) => u.productionOrder.id)));
  const siblings = orderIds.length
    ? await prisma.productionMaterialUsage.groupBy({
        by: ["productionOrderId", "lotId"],
        where: { productionOrderId: { in: orderIds }, lot: { rawMaterialId: row.rawMaterialId } },
        _sum: { quantity: true },
      })
    : [];

  const byOrder = new Map<string, LotOrderRow>();
  for (const u of lines) {
    const o = u.productionOrder;
    let r = byOrder.get(o.id);
    if (!r) {
      const sib = siblings.filter((s) => s.productionOrderId === o.id);
      r = {
        orderId: o.id, number: o.number, wo: o.workOrderNumber, label: orderLabel(o), orderDate: orderDateOf(o), modelId: o.productModel.id, modelName: o.productModel.name, sku: o.productModel.sku,
        category: categoryOfOrder(o), batchId: o.batch?.id ?? null, batchNumber: o.batch?.number ?? null, produced: producedDec(o), planned: o.plannedQuantity,
        qty: zero(), orderQty: sib.reduce((s, x) => s.add(x._sum.quantity ?? zero()), zero()), orderLots: sib.length, unitsFromLot: null,
        incl: zero(), excl: zero(), extraIncl: zero(), extraExcl: zero(),
      };
      byOrder.set(o.id, r);
    }
    const ex = usageExclVat(u, lot.unitExcl);
    r.qty = r.qty.add(u.quantity);
    r.incl = r.incl.add(u.totalCost);
    r.excl = r.excl.add(ex);
    if (u.commission4) {
      r.extraIncl = r.extraIncl.add(u.totalCost.mul(K4));
      r.extraExcl = r.extraExcl.add(ex.mul(K4));
    }
  }
  const orders = Array.from(byOrder.values());
  await relabel(orgId, orders, (r) => ({ orderId: r.orderId, number: r.number, wo: r.wo }));
  for (const r of orders) r.unitsFromLot = r.orderQty.greaterThan(0) ? r.produced.mul(r.qty).div(r.orderQty) : null;
  orders.sort((a, b) => (a.orderDate?.getTime() ?? 0) - (b.orderDate?.getTime() ?? 0) || a.number.localeCompare(b.number, "ru", { numeric: true }));

  const one = row.purchaseItems.length === 1 ? row.purchaseItems[0] : null;
  const passport: LotPassport = {
    materialName: row.rawMaterial.name,
    unit: row.rawMaterial.unit,
    grade: row.grade,
    color: row.color,
    colorRef: row.colorRef?.name ?? null,
    warehouse: row.warehouse.name,
    supplier: row.purchase?.supplier.name ?? null,
    invoiceNumber: row.purchase?.invoiceNumber ?? null,
    currency: row.purchase?.currency ?? null,
    exchangeRate: row.purchase?.exchangeRate ?? null,
    purchaseDate: row.purchase?.orderDate ?? null,
    receivedDate: row.receivedDate,
    vatRate: row.vatRate,
    itemPrice: one ? one.unitPrice : null,
    hammer: hammerLines([row.costBreakdown, ...row.purchaseItems.map((i) => i.costPlan)]),
    notes: row.notes,
  };
  return { lot, passport, orders };
}

export type ArticleLot = {
  lot: RawLot;
  qty: Decimal;
  incl: Decimal;
  excl: Decimal;
  extraIncl: Decimal;
  extraExcl: Decimal;
  orders: { orderId: string; number: string; label: string; qty: Decimal }[];
};

export type ArticleLots = {
  model: { id: string; name: string; sku: string | null; category: string };
  orders: number;
  produced: Decimal;
  lots: ArticleLot[];
};

/** «Изделие → лоты»: из каких лотов (меха и подкладки) сделано изделие и сколько ушло. null — изделия нет. */
export async function loadArticleLots(modelId: string, organizationId?: string): Promise<ArticleLots | null> {
  const orgId = await orgIdOf(organizationId);
  const model = await prisma.productModel.findFirst({ where: { id: modelId, organizationId: orgId }, select: { id: true, name: true, sku: true, category: true, categoryRef: { select: { name: true } } } });
  if (!model) return null;
  const lines = await prisma.productionMaterialUsage.findMany({
    where: { productionOrder: { organizationId: orgId, productModelId: modelId } },
    select: { ...USAGE_SELECT, lot: { include: LOT_INCLUDE } },
    orderBy: { date: "asc" },
  });
  const rows = lines.map((u) => usageRowOf({ ...u, lot: { ...u.lot, rawMaterial: u.lot.rawMaterial } }));
  await relabel(orgId, rows, usageRowPick);
  const lotById = new Map(lines.map((u) => [u.lotId, buildLot(u.lot)]));
  const orders = new Map<string, Decimal>();
  for (const r of rows) orders.set(r.orderId, r.produced);
  const lots: ArticleLot[] = usageByLot(rows).map((g) => ({ lot: lotById.get(g.lotId)!, ...g }));
  return {
    model: { id: model.id, name: model.name, sku: model.sku, category: model.categoryRef?.name ?? model.category ?? "" },
    orders: orders.size,
    produced: Array.from(orders.values()).reduce((s, p) => s.add(p), zero()),
    lots,
  };
}

// ───────────── «Сверка лотов» ─────────────

export type Recon = {
  mismatch: { lot: RawLot; issues: string[] }[];
  dormant: { lot: RawLot; days: number; remIncl: Decimal; remExcl: Decimal }[];
  over: { lot: RawLot; excess: Decimal }[];
};

/** Три списка для страницы «Сверка лотов»: расхождения учёта, лежащие без движения, использовано больше купленного. */
export function buildRecon(lots: RawLot[], now = new Date()): Recon {
  const mismatch = lots.map((lot) => ({ lot, issues: lotIssues(lot) })).filter((x) => x.issues.length > 0);
  const dormant = lots
    .filter(isDormant)
    .map((lot) => ({ lot, days: daysSince(lot.date, now), remIncl: lot.rem.mul(lot.unitIncl), remExcl: lot.rem.mul(lot.unitExcl) }))
    .sort((a, b) => b.days - a.days || b.remIncl.comparedTo(a.remIncl));
  const over = lots.filter(isOverused).map((lot) => ({ lot, excess: lot.used.sub(lot.recv) })).sort((a, b) => b.excess.comparedTo(a.excess));
  return { mismatch, dormant, over };
}
