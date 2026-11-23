import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { NO_AUCTION_KEY, SYNTHETIC_LABEL, categoryOf, type RawData, type RawLot, type UsageRef } from "@/lib/raw-analytics";
import { isMartFresh } from "@/lib/mart/snapshots";
import { lotSizes } from "@/lib/lot-size";
import { yearRange } from "@/lib/year-filter";
import type { YearFilter } from "@/lib/year-filter";

/**
 * Сырьё для «Аналитики сырья» из единой витрины: лоты (DmLot), расходы по ТЗ (DmLotUse) и строки моста Главной (DmLotBridge).
 * Те же поля, что собирает loadRawData + loadDashboard, но без обращения к лотам, движениям склада и ТЗ: одним запросом на таблицу.
 * Витрина пересобирается в фоне после любых записей; null — витрины ещё нет (пустая), тогда страница считает по-старому.
 */
const d = (v: unknown) => new Decimal(v === null || v === undefined ? 0 : String(v));

export async function loadRawFromMart(orgId: string, year: YearFilter): Promise<{ data: RawData; all: RawLot[] } | null> {
  // После записи витрина устарела до фоновой пересборки: тогда страница считает вживую, и «по лотам» не расходится с расходом по ТЗ.
  if (!(await isMartFresh(orgId))) return null;
  const r = yearRange(year);
  const y = r ? r.gte.getUTCFullYear() : null;
  const [lots, uses, bridge] = await Promise.all([
    prisma.dmLot.findMany({ where: { organizationId: orgId, ...(y ? { purchaseYear: y, purchaseId: { not: null } } : {}) }, orderBy: [{ receivedDate: "asc" }, { lotNumber: "asc" }] }),
    prisma.dmLotUse.findMany({ where: { organizationId: orgId }, select: { usageId: true, lotId: true, orderId: true, orderNumber: true, orderWo: true, orderLabel: true, modelId: true, qty: true }, orderBy: { date: "asc" } }),
    prisma.dmLotBridge.findMany({ where: { organizationId: orgId, ...(y ? { year: y } : {}) } }),
  ]);
  if (lots.length === 0) return null;

  const usesBy = new Map<string, typeof uses>();
  for (const u of uses) { const a = usesBy.get(u.lotId) ?? []; a.push(u); usesBy.set(u.lotId, a); }

  const real: RawLot[] = lots.map((l) => {
    const byOrder = new Map<string, UsageRef>();
    for (const u of usesBy.get(l.lotId) ?? []) {
      const cur = byOrder.get(u.orderId);
      if (cur) cur.qty = cur.qty.add(d(u.qty));
      else byOrder.set(u.orderId, { id: u.usageId, orderId: u.orderId, number: u.orderNumber, wo: u.orderWo, label: u.orderLabel || u.orderNumber, modelId: u.modelId, qty: d(u.qty) });
    }
    const recv = d(l.qtyReceived), used = d(l.qtyUsed), rem = d(l.qtyRemaining);
    const dt = l.receivedDate;
    const jIn = d(l.jIn), jProd = d(l.jProdOut), jOther = d(l.jOtherOut);
    const colorText = l.colorName ?? "";
    return {
      id: l.lotId,
      lotNumber: l.lotNumber?.trim() || "Без номера",
      auction: l.auction ?? NO_AUCTION_KEY,
      auctionLabel: l.auctionLabel,
      year: l.purchaseYear,
      month: l.purchaseMonth,
      kind: l.kindName,
      materialName: l.material,
      unit: l.unit,
      cat: categoryOf(l.grade, colorText),
      size: lotSizes(l.sizeGrade)[0] ?? "Не указан",
      sizes: lotSizes(l.sizeGrade),
      attrs: l.attrs ? l.attrs.split("|") : [],
      purchaseId: l.purchaseId,
      purchaseNumber: l.purchaseNumber,
      recv, used, rem,
      unitIncl: d(l.unitCost),
      unitExcl: d(l.unitCostExcl),
      usedIncl: d(l.usedCost),
      usedExcl: d(l.usedCostExcl),
      usedExtraIncl: d(l.usedExtraIncl),
      usedExtraExcl: d(l.usedExtraExcl),
      usages: Array.from(byOrder.values()),
      gradeEmpty: !(l.grade ?? "").trim() && !colorText.trim(),
      otherOut: recv.sub(rem).sub(used),
      movementGap: jIn.sub(jProd).sub(jOther).sub(rem),
      date: dt,
      itemsQty: d(l.itemsQty),
      jIn, jProdOut: jProd, jOtherOut: jOther, jNet: jIn.sub(jProd).sub(jOther),
    };
  });

  const syn: RawLot[] = bridge.map((b) => {
    const kind: "ordered" | "hides" = b.kind === "hides" ? "hides" : "ordered";
    const recv = d(b.qtyReceived);
    return {
      id: b.key, lotNumber: SYNTHETIC_LABEL[kind].toLowerCase(), auction: b.auction, auctionLabel: b.auctionLabel, year: b.year, month: `${b.year}-01`,
      kind: b.furKind, materialName: b.furKind, unit: "шт.", cat: SYNTHETIC_LABEL[kind], size: "Не указан", sizes: [], attrs: [],
      purchaseId: null, purchaseNumber: null,
      recv, used: d(0), rem: d(b.qtyRemaining),
      unitIncl: recv.greaterThan(0) ? d(b.totalCost).div(recv) : d(0), unitExcl: recv.greaterThan(0) ? d(b.totalCostExcl).div(recv) : d(0),
      usedIncl: d(b.usedCost), usedExcl: d(b.usedCostExcl), usedExtraIncl: d(0), usedExtraExcl: d(0),
      usages: [], gradeEmpty: false, otherOut: d(0), movementGap: d(0),
      date: new Date(Date.UTC(b.year, 0, 1)), itemsQty: d(0),
      jIn: recv, jProdOut: d(0), jOtherOut: d(0), jNet: d(b.qtyRemaining),
      synthetic: kind,
      fixed: { recvIncl: d(b.totalCost), recvExcl: d(b.totalCostExcl), remIncl: d(b.remCost), remExcl: d(b.remCostExcl) },
    };
  });

  return {
    data: { lots: real, purchasedByItems: d(0), usageTotal: d(0), movementsWithoutLot: { count: 0, qty: d(0) }, receivedItemsWithoutLot: 0 },
    all: [...real, ...syn],
  };
}
