import { formatPercent } from "@/lib/utils";
import { orderUnits } from "@/lib/production-totals";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderLabel } from "@/lib/order-label";
import { relabelOrders as relabel } from "@/lib/order-label-db";
import { requireSession } from "@/lib/session";
import { classifyProduct } from "@/lib/product-category";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { auctionName } from "@/lib/auction-payments";
import { isServiceAuction, shortAuctionName, NO_AUCTION_LABEL } from "@/lib/auction-names";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { usageExclVat } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { lotYear, purchaseYear } from "@/lib/year-scope";
import type { YearFilter } from "@/lib/year-filter";
import { sizeOf, categoryOf, lotSizes } from "@/lib/lot-size";
export { sizeOf, categoryOf };

/**
 * Аналитика сырья: куплено → использовано в ТЗ → остаток, по аукционам, годам, видам меха,
 * лотам, сортам/цветам и размерам. Источник — лоты склада (RawMaterialLot): каждая принятая
 * позиция закупки создаёт лот, списания в ТЗ ссылаются на лот (ProductionMaterialUsage).
 * Среднее везде средневзвешенное: Σ(цена × кол-во) ÷ Σ кол-во.
 */

export type Scope = "fur" | "lining";
export type LotGroupBy = "auction" | "year" | "kind" | "lot" | "cat" | "size";
/** «article» — по изделию (артикулу), «order» — по ТЗ: группировки по списаниям, а не по лотам. */
export type UsageGroupBy = "article" | "order";
export type GroupBy = LotGroupBy | UsageGroupBy;
export const isUsageBy = (b: GroupBy): b is UsageGroupBy => b === "article" || b === "order";
export const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "auction", label: "Аукцион" },
  { key: "year", label: "Год закупки" },
  { key: "kind", label: "Вид меха" },
  { key: "lot", label: "Лот" },
  { key: "cat", label: "Сорт / цвет" },
  { key: "size", label: "Размер шкуры" },
  { key: "article", label: "Изделие (артикул)" },
  { key: "order", label: "ТЗ" },
];

export const NO_AUCTION_KEY = "__none";
const zero = () => new Decimal(0);
/** label — единая подпись ТЗ («ТЗ 182 · поз. 1/3», см. order-label.ts); number — внутренний номер (для подсказки); wo — рабочий № ТЗ. */
export type UsageRef = { id: string; orderId: string; number: string; wo: string | null; label: string; modelId: string; qty: Decimal };

const usageRefPick = (i: UsageRef) => i;
const usageRowPick = (r: UsageRow) => ({ orderId: r.orderId, number: r.orderNumber, wo: r.wo });

export type RawLot = {
  id: string;
  lotNumber: string;
  auction: string; // полное название (ключ фильтра) или NO_AUCTION_KEY
  auctionLabel: string;
  year: number;
  month: string; // YYYY-MM
  kind: string;
  /** Название материала («Подкладочная ткань №2», «Соболь …»). */
  materialName: string;
  unit: string;
  cat: string;
  /** Основной размер лота по документам (первый из sizeGrade) для группировки; нет — «Не указан». */
  size: string;
  /** Все размеры лота по документам (RawMaterialLot.sizeGrade); пусто — размер в документах не указан. */
  sizes: string[];
  /** Признаки меха лота (справочник /settings/fur-attrs). */
  attrs: string[];
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
  /** Дата закупки (иначе дата прихода) — по ней год лота и «сколько лежит». */
  date: Date;
  /** Σ количества в позициях закупки, привязанных к лоту. */
  itemsQty: Decimal;
  /** Журнал движений склада (StockMovement) по лоту: приход, списано в ТЗ, списано иначе, остаток. */
  jIn: Decimal;
  jProdOut: Decimal;
  jOtherOut: Decimal;
  jNet: Decimal;
  /**
   * Строка «моста до Главной» — не лот склада: «ordered» — заказано, но не получено (лотов ещё нет),
   * «hides» — шкуры подрядчика (оплачены в составе пошива). Собираются в loadDashboard (src/lib/raw-analytics-dash.ts).
   */
  synthetic?: "ordered" | "hides";
  /** Суммы, заданные расчётом Главной (у синтетических строк цена за единицу не имеет смысла): вместо кол-во × цена. */
  fixed?: { recvIncl: Decimal; recvExcl: Decimal; remIncl: Decimal; remExcl: Decimal };
};

/** Стоимость лота: получено и остаток, ₽ (с НДС / без НДС). Для обычного лота — кол-во × цена за единицу. */
export function lotValues(l: RawLot): { recvIncl: Decimal; recvExcl: Decimal; remIncl: Decimal; remExcl: Decimal } {
  return l.fixed ?? { recvIncl: l.recv.mul(l.unitIncl), recvExcl: l.recv.mul(l.unitExcl), remIncl: l.rem.mul(l.unitIncl), remExcl: l.rem.mul(l.unitExcl) };
}

export const SYNTHETIC_LABEL = { ordered: "Заказано, не получено", hides: "Доплата подрядчику: НДС 22 %" } as const;

export type RawData = {
  lots: RawLot[];
  /** Контроль: Σ количества принятых закупок за тот же год (по позициям закупок). */
  purchasedByItems: Decimal;
  usageTotal: Decimal; // Σ ProductionMaterialUsage по лотам года
  movementsWithoutLot: { count: number; qty: Decimal };
  receivedItemsWithoutLot: number;
};

const IN_TYPES = new Set(["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"]);

const LOT_INCLUDE = {
  rawMaterial: { select: { name: true, unit: true } },
  colorRef: { select: { name: true } },
  attrs: { select: { attr: { select: { name: true } } } },
  purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true } },
  purchaseItems: { select: { quantity: true } },
  usages: {
    select: {
      id: true, quantity: true, totalCost: true, commission4: true, vatRate: true,
      productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModelId: true } },
    },
    orderBy: { date: "asc" },
  },
  stockMovements: { select: { type: true, quantity: true } },
} satisfies Prisma.RawMaterialLotInclude;

type LotRow = Prisma.RawMaterialLotGetPayload<{ include: typeof LOT_INCLUDE }>;

/** Одна запись лота склада → строка аналитики (общая для таблицы, карточки и сверки). */
function buildLot(l: LotRow): RawLot {
  const k = new Decimal(COMMISSION_RATE);
  const unitExcl = lotUnitCostExclVat(l);
  const used = l.usages.reduce((s, u) => s.add(u.quantity), zero());
  let usedIncl = zero();
  let usedExcl = zero();
  let extraIncl = zero();
  let extraExcl = zero();
  for (const u of l.usages) {
    usedIncl = usedIncl.add(u.totalCost);
    const ex = usageExclVat(u, unitExcl);
    usedExcl = usedExcl.add(ex);
    if (u.commission4) {
      extraIncl = extraIncl.add(u.totalCost.mul(k));
      extraExcl = extraExcl.add(ex.mul(k));
    }
  }
  let jIn = zero();
  let jProdOut = zero();
  let jOtherOut = zero();
  for (const m of l.stockMovements) {
    if (IN_TYPES.has(m.type)) jIn = jIn.add(m.quantity);
    else if (m.type === "PRODUCTION_OUT") jProdOut = jProdOut.add(m.quantity);
    else jOtherOut = jOtherOut.add(m.quantity);
  }
  const name = auctionName(l.purchase?.auctionSession);
  const service = !name || isServiceAuction(name);
  const d = l.purchase?.orderDate ?? l.receivedDate;
  const byOrder = new Map<string, UsageRef>();
  for (const u of l.usages) {
    const cur = byOrder.get(u.productionOrder.id);
    if (cur) cur.qty = cur.qty.add(u.quantity);
    else byOrder.set(u.productionOrder.id, { id: u.id, orderId: u.productionOrder.id, number: u.productionOrder.number, wo: u.productionOrder.workOrderNumber, label: orderLabel(u.productionOrder), modelId: u.productionOrder.productModelId, qty: u.quantity });
  }
  return {
    id: l.id,
    lotNumber: l.lotNumber?.trim() || "Без номера",
    auction: name ?? NO_AUCTION_KEY,
    auctionLabel: service ? NO_AUCTION_LABEL : shortAuctionName(name),
    year: d.getUTCFullYear(),
    month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    kind: l.rawMaterial.unit === "M" ? "Подкладка" : l.rawMaterial.name,
    materialName: l.rawMaterial.name,
    unit: l.rawMaterial.unit,
    cat: categoryOf(l.grade, l.colorRef?.name ?? l.color),
    // Размер — только по документам (sizeGrade), текст сорта не разбираем: так же, как в таблицах /lots (lot-size.ts: lotSizes).
    size: lotSizes(l.sizeGrade)[0] ?? "Не указан",
    sizes: lotSizes(l.sizeGrade),
    attrs: l.attrs.map((a) => a.attr.name),
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
    movementGap: jIn.sub(jProdOut).sub(jOtherOut).sub(l.quantityRemaining),
    date: d,
    itemsQty: l.purchaseItems.reduce((s, i) => s.add(i.quantity), zero()),
    jIn,
    jProdOut,
    jOtherOut,
    jNet: jIn.sub(jProdOut).sub(jOtherOut),
  };
}

export async function loadRawData(organizationId: string, year: YearFilter): Promise<RawData> {
  const [rows, items, usageAgg, noLotMov, noLotItems] = await Promise.all([
    prisma.rawMaterialLot.findMany({
      where: { organizationId, ...lotYear(year) },
      include: LOT_INCLUDE,
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

  // Вид меха лота — каноническое русское название по справочнику меха («Лиса красная» → «Лиса»); подкладка и неизвестное — как есть.
  const furIdx = await getFurIndex(organizationId);
  const lots = rows.map((r) => {
    const lot = buildLot(r);
    if (lot.unit !== "M") lot.kind = canonicalFur(lot.materialName, furIdx)?.name ?? lot.kind;
    return lot;
  });
  await relabel(organizationId, lots.flatMap((l) => l.usages), usageRefPick);
  return {
    lots,
    purchasedByItems: items._sum.quantity ?? zero(),
    usageTotal: usageAgg._sum.quantity ?? zero(),
    movementsWithoutLot: { count: noLotMov._count._all, qty: noLotMov._sum.quantity ?? zero() },
    receivedItemsWithoutLot: noLotItems,
  };
}

// ───────────── сверка учёта: журнал склада = лот = Σ ТЗ ─────────────

/** Три остатка лота: по журналу склада, по самому лоту, расчётный (получено − Σ ТЗ). */
export function lotBalances(l: RawLot): { journal: Decimal; lot: Decimal; calc: Decimal } {
  return { journal: l.jNet, lot: l.rem, calc: l.recv.sub(l.used) };
}

/** Что именно не сходится у лота (пусто — всё сходится). Используется карточкой лота и страницей «Сверка». */
export function lotIssues(l: RawLot): string[] {
  const out: string[] = [];
  if (!l.jIn.equals(l.recv)) out.push("приход: журнал ≠ лот");
  if (!l.jProdOut.equals(l.used)) out.push("списано в ТЗ: журнал ≠ Σ ТЗ");
  if (!l.jOtherOut.equals(l.otherOut)) out.push("списано иначе: журнал ≠ лот");
  const b = lotBalances(l);
  if (!b.journal.equals(b.lot) || !b.lot.equals(b.calc)) out.push("остаток: журнал, лот и «получено − ТЗ» не равны");
  if (l.itemsQty.greaterThan(0) && !l.itemsQty.equals(l.recv)) out.push("позиции закупки ≠ получено по лоту");
  if (l.used.greaterThan(l.recv)) out.push("использовано больше полученного");
  return out;
}

/** Лот лежит неиспользованным: что-то куплено, остаток есть, в ТЗ не списывали. */
export const isDormant = (l: RawLot) => l.usages.length === 0 && l.rem.greaterThan(0);
export const isOverused = (l: RawLot) => l.used.greaterThan(l.recv);

export function daysSince(d: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}
/** «1 г. 3 мес.», «45 дн.» — как давно лот лежит. */
export function ageText(days: number): string {
  if (days < 60) return `${days} дн.`;
  const months = Math.floor(days / 30.4375);
  if (months < 12) return `${months} мес.`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} г. ${m} мес.` : `${y} г.`;
}

// ───────────── фильтры и агрегация (чистые функции) ─────────────

/** auction / kind (вид меха) / pyear — мультивыбор (пусто = все); model — id изделия (только лоты, из которых его делали). */
export type RawFilters = { scope: Scope; auction: string[]; kind: string[]; pyear: string[]; size: string[]; attr: string[]; onlyRem: boolean; q: string; model: string };

const CYR_LAT: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ё: "e",
};
/**
 * Номер лота «в любом написании»: регистр, пробелы, дефисы, слэши и прочие знаки не важны,
 * кириллица и латиница-двойники равны (А/A, С/C), ведущие нули не важны (015016 = 15016).
 */
export function normLot(s: string | null | undefined): string {
  const t = (s ?? "").toLowerCase().replace(/[^a-zа-яё0-9]+/g, "");
  return t.replace(/[а-яё]/g, (ch) => CYR_LAT[ch] ?? ch).replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
}
export function lotMatches(l: RawLot, q: string): boolean {
  const raw = q.trim().toLowerCase();
  if (!raw) return true;
  if (`${l.lotNumber} ${l.cat} ${l.kind} ${l.materialName}`.toLowerCase().includes(raw)) return true;
  const n = normLot(q);
  return n.length > 0 && normLot(`${l.lotNumber} ${l.materialName}`).includes(n);
}

export function applyFilters(lots: RawLot[], f: RawFilters): RawLot[] {
  return lots.filter((l) => {
    if ((f.scope === "lining") !== (l.unit === "M")) return false;
    if (f.auction.length && !f.auction.includes(l.auction)) return false;
    if (f.kind.length && !f.kind.includes(l.kind)) return false;
    if (f.pyear.length && !f.pyear.includes(String(l.year))) return false;
    if (f.size.length && !(l.sizes.length ? l.sizes.some((x) => f.size.includes(x)) : f.size.includes("Не указан"))) return false;
    if (f.attr.length && !(l.attrs.length ? l.attrs.some((a) => f.attr.includes(a)) : f.attr.includes("none"))) return false;
    if (f.onlyRem && !l.rem.greaterThan(0)) return false;
    if (f.model && !l.usages.some((u) => u.modelId === f.model)) return false;
    if (!lotMatches(l, f.q)) return false;
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
  /** Остаток по журналу движений склада («в учёте»). */
  jrem: Decimal;
};
export const emptyAgg = (): Agg => ({
  lots: 0, recv: zero(), used: zero(), rem: zero(), recvIncl: zero(), recvExcl: zero(),
  usedIncl: zero(), usedExcl: zero(), usedExtraIncl: zero(), usedExtraExcl: zero(), remIncl: zero(), remExcl: zero(), jrem: zero(),
});
export function addLot(a: Agg, l: RawLot): void {
  a.lots += 1;
  a.recv = a.recv.add(l.recv);
  a.used = a.used.add(l.used);
  a.rem = a.rem.add(l.rem);
  const v = lotValues(l);
  a.recvIncl = a.recvIncl.add(v.recvIncl);
  a.recvExcl = a.recvExcl.add(v.recvExcl);
  a.usedIncl = a.usedIncl.add(l.usedIncl);
  a.usedExcl = a.usedExcl.add(l.usedExcl);
  a.usedExtraIncl = a.usedExtraIncl.add(l.usedExtraIncl);
  a.usedExtraExcl = a.usedExtraExcl.add(l.usedExtraExcl);
  a.remIncl = a.remIncl.add(v.remIncl);
  a.remExcl = a.remExcl.add(v.remExcl);
  a.jrem = a.jrem.add(l.jNet);
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

export function groupLots(lots: RawLot[], by: LotGroupBy): Group[] {
  const map = new Map<string, Group>();
  for (const l of lots) {
    let key: string;
    let label: string;
    let title: string | undefined;
    if (l.synthetic) {
      // «Заказано, не получено» и «Шкуры подрядчика» — всегда отдельными подписанными строками (в любой группировке).
      key = `syn:${l.synthetic}`; label = SYNTHETIC_LABEL[l.synthetic];
      let sg = map.get(key);
      if (!sg) map.set(key, (sg = { key, label, title: l.synthetic === "ordered" ? "Заказано по закупкам, лотов склада ещё нет (входит в «Куплено» и «Остаток» на Главной)" : "Шкуры подрядчика, оплаченные в составе пошива (входят в «Куплено» и «Использовано» на Главной)", agg: emptyAgg(), lots: [] }));
      sg.lots.push(l);
      addLot(sg.agg, l);
      continue;
    }
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
  // Строки моста до Главной — в конце, после обычных групп.
  return [...arr.filter((g) => !g.key.startsWith("syn:")), ...arr.filter((g) => g.key.startsWith("syn:"))];
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): { f: RawFilters; by: GroupBy } {
  const one = (v: string | string[] | undefined, max = 200) => (typeof v === "string" ? v.slice(0, max) : Array.isArray(v) && typeof v[0] === "string" ? v[0].slice(0, max) : "");
  // Мультивыбор: повтор параметра; старые имена (auc, kind, py, m) читаются как псевдонимы.
  const many = (...names: string[]) => {
    const out: string[] = [];
    for (const n of names) {
      const v = sp[n];
      for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
        const t = String(x).trim().slice(0, 200);
        if (t && !out.includes(t)) out.push(t);
      }
    }
    return out.slice(0, 60);
  };
  const by = GROUPS.some((g) => g.key === sp.g) ? (sp.g as GroupBy) : "auction";
  return {
    by,
    f: {
      scope: sp.scope === "lining" ? "lining" : "fur",
      auction: many("auction", "auc"),
      kind: many("fur", "kind"),
      pyear: many("pyear", "py").filter((y) => /^\d{4}$/.test(y)),
      size: many("size"),
      attr: many("attr"),
      onlyRem: one(sp.rest) === "1",
      q: one(sp.q, 100),
      model: one(sp.model ?? sp.m, 60),
    },
  };
}

export const pctText = (p: number | null) => (p == null ? "—" : formatPercent(p));

// ───────────── списания по изделиям и ТЗ ─────────────

const K4 = new Decimal(COMMISSION_RATE);
/** Произведено по ТЗ — все ТЗ без отменённых (production-totals.ts), как на Главной: выпуск завершённого, план ТЗ в работе. */
const producedDec = (o: { status: string; producedQuantity: Decimal; plannedQuantity: Decimal }) => new Decimal(orderUnits(o).toFixed(3));

type OrderBrief = {
  workOrderNumber: string | null;
  id: string;
  number: string;
  status: string;
  producedQuantity: Decimal;
  plannedQuantity: Decimal;
  workOrderDate: Date | null;
  endDate: Date | null;
  startDate: Date | null;
  materialDescription: string | null;
  batch: { id: string; number: number; year: number | null } | null;
  productModel: { id: string; name: string; sku: string | null; category: string | null; categoryRef: { name: string } | null };
};
const ORDER_BRIEF = {
  id: true, number: true, workOrderNumber: true, status: true, producedQuantity: true, plannedQuantity: true, workOrderDate: true, endDate: true, startDate: true, materialDescription: true,
  batch: { select: { id: true, number: true, year: true } },
  productModel: { select: { id: true, name: true, sku: true, category: true, categoryRef: { select: { name: true } } } },
} satisfies Prisma.ProductionOrderSelect;

const orderDateOf = (o: { workOrderDate: Date | null; endDate: Date | null; startDate: Date | null }) => o.workOrderDate ?? o.endDate ?? o.startDate;
const categoryOfOrder = (o: OrderBrief) =>
  classifyProduct({ refName: o.productModel.categoryRef?.name, modelCategory: o.productModel.category, orderDescription: o.materialDescription, modelName: o.productModel.name }).category;

/** Одно списание сырья в ТЗ (со стоимостью по цене лота). */
export type UsageRow = {
  id: string;
  lotId: string;
  orderId: string;
  orderNumber: string;
  /** Рабочий № ТЗ из документа. */
  wo: string | null;
  /** Единая подпись ТЗ («ТЗ 182 · поз. 1/3»). */
  label: string;
  orderDate: Date | null;
  modelId: string;
  modelName: string;
  sku: string | null;
  category: string;
  batchNumber: number | null;
  produced: Decimal;
  unit: string;
  qty: Decimal;
  incl: Decimal;
  excl: Decimal;
  c4: boolean;
};

const usageRowOf = (u: {
  id: string; lotId: string; quantity: Decimal; totalCost: Decimal; commission4: boolean; vatRate: Decimal | null;
  lot: Parameters<typeof lotUnitCostExclVat>[0] & { rawMaterial: { unit: string } };
  productionOrder: OrderBrief;
}): UsageRow => ({
  id: u.id,
  lotId: u.lotId,
  orderId: u.productionOrder.id,
  orderNumber: u.productionOrder.number,
  wo: u.productionOrder.workOrderNumber,
  label: orderLabel(u.productionOrder),
  orderDate: orderDateOf(u.productionOrder),
  modelId: u.productionOrder.productModel.id,
  modelName: u.productionOrder.productModel.name,
  sku: u.productionOrder.productModel.sku,
  category: categoryOfOrder(u.productionOrder),
  batchNumber: u.productionOrder.batch?.number ?? null,
  produced: producedDec(u.productionOrder),
  unit: u.lot.rawMaterial.unit,
  qty: u.quantity,
  incl: u.totalCost,
  excl: usageExclVat(u, lotUnitCostExclVat(u.lot)),
  c4: u.commission4,
});

const USAGE_SELECT = {
  id: true, lotId: true, quantity: true, totalCost: true, commission4: true, vatRate: true,
  lot: { select: { unitCost: true, vatRate: true, materialCostExclVat: true, expenseCostExclVat: true, rawMaterial: { select: { unit: true } } } },
  productionOrder: { select: ORDER_BRIEF },
} satisfies Prisma.ProductionMaterialUsageSelect;

/** Все списания по лотам выбранного года (год — как в таблице лотов: по дате закупки лота). */
export async function loadUsageRows(organizationId: string, year: YearFilter): Promise<UsageRow[]> {
  const rows = await prisma.productionMaterialUsage.findMany({
    where: { productionOrder: { organizationId }, lot: lotYear(year) },
    select: USAGE_SELECT,
    orderBy: { date: "asc" },
  });
  const out = rows.map(usageRowOf);
  await relabel(organizationId, out, usageRowPick);
  return out;
}

export type UsageGroup = {
  key: string;
  label: string;
  sub: string;
  orders: number;
  lots: number;
  /** Произведено единиц изделия в этих ТЗ (каждое ТЗ учтено один раз). */
  produced: Decimal;
  qty: Decimal;
  incl: Decimal;
  excl: Decimal;
  extraIncl: Decimal;
  extraExcl: Decimal;
  rows: UsageRow[];
};

export function groupUsage(rows: UsageRow[], by: UsageGroupBy): UsageGroup[] {
  const map = new Map<string, UsageGroup & { _o: Set<string>; _l: Set<string> }>();
  for (const r of rows) {
    const key = by === "article" ? r.modelId : r.orderId;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: by === "article" ? r.modelName : r.label,
        sub: by === "article" ? `${r.sku ? `${r.sku} · ` : ""}${r.category}` : `${r.modelName} · ${r.category}${r.batchNumber != null ? ` · партия ${r.batchNumber}` : ""}`,
        orders: 0, lots: 0, produced: zero(), qty: zero(), incl: zero(), excl: zero(), extraIncl: zero(), extraExcl: zero(), rows: [],
        _o: new Set(), _l: new Set(),
      };
      map.set(key, g);
    }
    if (!g._o.has(r.orderId)) {
      g._o.add(r.orderId);
      g.produced = g.produced.add(r.produced);
    }
    g._l.add(r.lotId);
    g.qty = g.qty.add(r.qty);
    g.incl = g.incl.add(r.incl);
    g.excl = g.excl.add(r.excl);
    if (r.c4) {
      g.extraIncl = g.extraIncl.add(r.incl.mul(K4));
      g.extraExcl = g.extraExcl.add(r.excl.mul(K4));
    }
    g.rows.push(r);
  }
  const arr = Array.from(map.values()).map(({ _o, _l, ...g }) => ({ ...g, orders: _o.size, lots: _l.size }));
  arr.sort((a, b) => b.incl.comparedTo(a.incl) || a.label.localeCompare(b.label, "ru", { numeric: true }));
  return arr;
}

/** Строки списаний → по лотам (внутри изделия или ТЗ): сколько из какого лота ушло. */
export type UsageByLot = { lotId: string; qty: Decimal; incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal; orders: { orderId: string; number: string; label: string; qty: Decimal }[] };
export function usageByLot(rows: UsageRow[]): UsageByLot[] {
  const map = new Map<string, UsageByLot>();
  for (const r of rows) {
    let g = map.get(r.lotId);
    if (!g) map.set(r.lotId, (g = { lotId: r.lotId, qty: zero(), incl: zero(), excl: zero(), extraIncl: zero(), extraExcl: zero(), orders: [] }));
    g.qty = g.qty.add(r.qty);
    g.incl = g.incl.add(r.incl);
    g.excl = g.excl.add(r.excl);
    if (r.c4) {
      g.extraIncl = g.extraIncl.add(r.incl.mul(K4));
      g.extraExcl = g.extraExcl.add(r.excl.mul(K4));
    }
    const o = g.orders.find((x) => x.orderId === r.orderId);
    if (o) o.qty = o.qty.add(r.qty);
    else g.orders.push({ orderId: r.orderId, number: r.orderNumber, label: r.label, qty: r.qty });
  }
  return Array.from(map.values()).sort((a, b) => b.incl.comparedTo(a.incl));
}

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
