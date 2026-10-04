import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { auctionName } from "@/lib/auction-payments";
import { isServiceAuction, shortAuctionName, NO_AUCTION_LABEL } from "@/lib/auction-names";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { lotYear, purchaseYear } from "@/lib/year-scope";
import type { YearFilter } from "@/lib/year-filter";

/**
 * Аналитика сырья: куплено → использовано в ТЗ → остаток, по аукционам, годам, видам меха,
 * лотам, сортам/цветам и размерам. Источник — лоты склада (RawMaterialLot): каждая принятая
 * позиция закупки создаёт лот, списания в ТЗ ссылаются на лот (ProductionMaterialUsage).
 * Среднее везде средневзвешенное: Σ(цена × кол-во) ÷ Σ кол-во.
 */

export type Scope = "fur" | "lining";
export type GroupBy = "auction" | "year" | "kind" | "lot" | "cat" | "size";
export const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "auction", label: "Аукцион" },
  { key: "year", label: "Год закупки" },
  { key: "kind", label: "Вид меха" },
  { key: "lot", label: "Лот" },
  { key: "cat", label: "Сорт / цвет" },
  { key: "size", label: "Размер" },
];

export const NO_AUCTION_KEY = "__none";
const zero = () => new Decimal(0);
const SIZE_RE = /(?:^|[\s,(])(XXXL|XXL|XL|L|M|S|XS)(?=$|[\s,)])/i;

/** Размер из текста сорта: «… XXL 3 - 2.1» → XXL. Нет — «Не указан». */
export function sizeOf(grade: string | null | undefined): string {
  const m = SIZE_RE.exec(grade ?? "");
  return m ? m[1].toUpperCase() : "Не указан";
}
/** Сорт/цвет без хвоста с размером: «Соболь баргузинский дикий сырец XXL 3 - 2.1» → «Соболь баргузинский дикий сырец». */
export function categoryOf(grade: string | null | undefined, color: string | null | undefined): string {
  const g = (grade ?? "").trim();
  const m = SIZE_RE.exec(g);
  const base = (m ? g.slice(0, m.index) : g).trim().replace(/[\s,;-]+$/, "");
  const c = (color ?? "").trim();
  if (base && c) return `${base}, ${c}`;
  return base || c || "Не указано";
}

export type UsageRef = { id: string; orderId: string; number: string; qty: Decimal };

export type RawLot = {
  id: string;
  lotNumber: string;
  auction: string; // полное название (ключ фильтра) или NO_AUCTION_KEY
  auctionLabel: string;
  year: number;
  month: string; // YYYY-MM
  kind: string;
  unit: string;
  cat: string;
  size: string;
  purchaseId: string | null;
  purchaseNumber: string | null;
  recv: Decimal;
  used: Decimal;
  rem: Decimal;
  unitIncl: Decimal;
  unitExcl: Decimal;
  usedIncl: Decimal;
  usedExcl: Decimal;
  usedExtraIncl: Decimal; // надбавка 4% по строкам списания, у которых она применяется
  usedExtraExcl: Decimal;
  usages: UsageRef[];
  gradeEmpty: boolean;
  /** Расхождения: получено − остаток − списано в ТЗ; чистое движение по журналу − остаток. */
  otherOut: Decimal;
  movementGap: Decimal;
};

export type RawData = {
  lots: RawLot[];
  /** Контроль: Σ количества принятых закупок за тот же год (по позициям закупок). */
  purchasedByItems: Decimal;
  usageTotal: Decimal; // Σ ProductionMaterialUsage по лотам года
  movementsWithoutLot: { count: number; qty: Decimal };
  receivedItemsWithoutLot: number;
};

const IN_TYPES = new Set(["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"]);

export async function loadRawData(organizationId: string, year: YearFilter): Promise<RawData> {
  const [rows, items, usageAgg, noLotMov, noLotItems] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId, ...lotYear(year) },
      include: {
        rawMaterial: { select: { name: true, unit: true } },
        purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true } },
        usages: {
          select: { id: true, quantity: true, totalCost: true, commission4: true, productionOrder: { select: { id: true, number: true } } },
          orderBy: { date: "asc" },
        },
        stockMovements: { select: { type: true, quantity: true } },
      },
      orderBy: [{ receivedDate: "asc" }, { lotNumber: "asc" }],
    }),
    prisma.purchaseItem.aggregate({
      where: { purchase: { organizationId, status: "RECEIVED", ...purchaseYear(year) } },
      _sum: { quantity: true },
    }),
    prisma.productionMaterialUsage.aggregate({
      where: { productionOrder: { organizationId }, lot: lotYear(year) },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.aggregate({
      where: { organizationId, lotId: null },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    prisma.purchaseItem.count({ where: { lotId: null, purchase: { organizationId, status: "RECEIVED" } } }),
  ]);

  const k = new Decimal(COMMISSION_RATE);
  const lots: RawLot[] = rows.map((l) => {
    const unitExcl = lotUnitCostExclVat(l);
    const used = l.usages.reduce((s, u) => s.add(u.quantity), zero());
    let usedIncl = zero();
    let usedExcl = zero();
    let extraIncl = zero();
    let extraExcl = zero();
    for (const u of l.usages) {
      usedIncl = usedIncl.add(u.totalCost);
      const ex = u.quantity.mul(unitExcl);
      usedExcl = usedExcl.add(ex);
      if (u.commission4) {
        extraIncl = extraIncl.add(u.totalCost.mul(k));
        extraExcl = extraExcl.add(ex.mul(k));
      }
    }
    const net = l.stockMovements.reduce((s, m) => (IN_TYPES.has(m.type) ? s.add(m.quantity) : s.sub(m.quantity)), zero());
    const name = auctionName(l.purchase?.auctionSession);
    const service = !name || isServiceAuction(name);
    const d = l.purchase?.orderDate ?? l.receivedDate;
    const byOrder = new Map<string, UsageRef>();
    for (const u of l.usages) {
      const cur = byOrder.get(u.productionOrder.id);
      if (cur) cur.qty = cur.qty.add(u.quantity);
      else byOrder.set(u.productionOrder.id, { id: u.id, orderId: u.productionOrder.id, number: u.productionOrder.number, qty: u.quantity });
    }
    return {
      id: l.id,
      lotNumber: l.lotNumber?.trim() || "Без номера",
      auction: name ?? NO_AUCTION_KEY,
      auctionLabel: service ? NO_AUCTION_LABEL : shortAuctionName(name),
      year: d.getUTCFullYear(),
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      kind: l.rawMaterial.unit === "M" ? "Подкладка" : l.rawMaterial.name,
      unit: l.rawMaterial.unit,
      cat: categoryOf(l.grade, l.color),
      size: sizeOf(l.grade),
      purchaseId: l.purchase?.id ?? null,
      purchaseNumber: l.purchase?.number ?? null,
      recv: l.quantityReceived,
      used,
      rem: l.quantityRemaining,
      unitIncl: l.unitCost,
      unitExcl,
      usedIncl,
      usedExcl,
      usedExtraIncl: extraIncl,
      usedExtraExcl: extraExcl,
      usages: Array.from(byOrder.values()),
      gradeEmpty: !(l.grade ?? "").trim() && !(l.color ?? "").trim(),
      otherOut: l.quantityReceived.sub(l.quantityRemaining).sub(used),
      movementGap: net.sub(l.quantityRemaining),
    };
  });

  return {
    lots,
    purchasedByItems: items._sum.quantity ?? zero(),
    usageTotal: usageAgg._sum.quantity ?? zero(),
    movementsWithoutLot: { count: noLotMov._count._all, qty: noLotMov._sum.quantity ?? zero() },
    receivedItemsWithoutLot: noLotItems,
  };
}

// ───────────── фильтры и агрегация (чистые функции) ─────────────

export type RawFilters = { scope: Scope; auction: string; kind: string; onlyRem: boolean; q: string };

export function applyFilters(lots: RawLot[], f: RawFilters): RawLot[] {
  const q = f.q.trim().toLowerCase();
  return lots.filter((l) => {
    if ((f.scope === "lining") !== (l.unit === "M")) return false;
    if (f.auction && l.auction !== f.auction) return false;
    if (f.kind && l.kind !== f.kind) return false;
    if (f.onlyRem && !l.rem.greaterThan(0)) return false;
    if (q && !`${l.lotNumber} ${l.cat} ${l.kind}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type Agg = {
  lots: number;
  recv: Decimal;
  used: Decimal;
  rem: Decimal;
  recvIncl: Decimal;
  recvExcl: Decimal;
  usedIncl: Decimal;
  usedExcl: Decimal;
  usedExtraIncl: Decimal;
  usedExtraExcl: Decimal;
  remIncl: Decimal;
  remExcl: Decimal;
};
export const emptyAgg = (): Agg => ({
  lots: 0, recv: zero(), used: zero(), rem: zero(), recvIncl: zero(), recvExcl: zero(),
  usedIncl: zero(), usedExcl: zero(), usedExtraIncl: zero(), usedExtraExcl: zero(), remIncl: zero(), remExcl: zero(),
});
export function addLot(a: Agg, l: RawLot): void {
  a.lots += 1;
  a.recv = a.recv.add(l.recv);
  a.used = a.used.add(l.used);
  a.rem = a.rem.add(l.rem);
  a.recvIncl = a.recvIncl.add(l.recv.mul(l.unitIncl));
  a.recvExcl = a.recvExcl.add(l.recv.mul(l.unitExcl));
  a.usedIncl = a.usedIncl.add(l.usedIncl);
  a.usedExcl = a.usedExcl.add(l.usedExcl);
  a.usedExtraIncl = a.usedExtraIncl.add(l.usedExtraIncl);
  a.usedExtraExcl = a.usedExtraExcl.add(l.usedExtraExcl);
  a.remIncl = a.remIncl.add(l.rem.mul(l.unitIncl));
  a.remExcl = a.remExcl.add(l.rem.mul(l.unitExcl));
}
export const aggOf = (lots: RawLot[]): Agg => {
  const a = emptyAgg();
  for (const l of lots) addLot(a, l);
  return a;
};
/** Средневзвешенная цена закупки за единицу: Σ(кол-во × цена) ÷ Σ кол-во. */
export const avgPrice = (a: Agg): { incl: Decimal; excl: Decimal } | null =>
  a.recv.greaterThan(0) ? { incl: a.recvIncl.div(a.recv), excl: a.recvExcl.div(a.recv) } : null;
export const usedPct = (a: Agg): number | null => (a.recv.greaterThan(0) ? a.used.div(a.recv).mul(100).toNumber() : null);

export type Group = { key: string; label: string; title?: string; agg: Agg; lots: RawLot[] };

const SIZE_ORDER = ["XXXL", "XXL", "XL", "L", "M", "S", "XS"];

export function groupLots(lots: RawLot[], by: GroupBy): Group[] {
  const map = new Map<string, Group>();
  for (const l of lots) {
    let key: string;
    let label: string;
    let title: string | undefined;
    switch (by) {
      case "auction": key = l.auction; label = l.auctionLabel; title = l.auction === NO_AUCTION_KEY ? undefined : l.auction; break;
      case "year": key = String(l.year); label = String(l.year); break;
      case "kind": key = l.kind; label = l.kind; break;
      case "lot": key = `${l.lotNumber}`; label = l.lotNumber; break;
      case "cat": key = l.cat; label = l.cat; break;
      case "size": key = l.size; label = l.size; break;
    }
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, label, title, agg: emptyAgg(), lots: [] }));
    g.lots.push(l);
    addLot(g.agg, l);
  }
  const arr = Array.from(map.values());
  const byRem = (a: Group, b: Group) => b.agg.remIncl.comparedTo(a.agg.remIncl) || a.label.localeCompare(b.label, "ru", { numeric: true });
  if (by === "year") arr.sort((a, b) => Number(a.key) - Number(b.key));
  else if (by === "lot") arr.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
  else if (by === "size") arr.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.key), ib = SIZE_ORDER.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || byRem(a, b);
  });
  else arr.sort(byRem);
  return arr;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): { f: RawFilters; by: GroupBy } {
  const one = (v: string | string[] | undefined, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  const by = GROUPS.some((g) => g.key === sp.g) ? (sp.g as GroupBy) : "auction";
  return {
    by,
    f: {
      scope: sp.scope === "lining" ? "lining" : "fur",
      auction: one(sp.auction),
      kind: one(sp.kind),
      onlyRem: sp.rest === "1",
      q: one(sp.q, 100),
    },
  };
}

export const pctText = (p: number | null) => (p == null ? "—" : `${p.toFixed(1).replace(".", ",")}%`);
