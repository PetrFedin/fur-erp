// Раздел «Продажи и остатки»: фильтры, показатели узла, ряды по периодам и деревья детализации (структуры А–Е).
// Чистые функции без БД: данные собирает sales-server.ts. Всё считается из строк выгрузки «поступления и продажи» (SalesReceiptLine).
// Остаток расчётный: приход − продано нарастающим итогом (корректировки прихода с минусом и возвраты уже в штуках со знаком).
import { exVatAt, vatPctAt, type FullLine } from "@/lib/margin";
import { metricsOf, type Ctx, type Metrics, type ReportSizeRow } from "@/lib/margin-tree";
import { CAT_LABEL, colorOfLine, furTypeOfFabric, variantOfArticle, type CatClass } from "@/lib/sales-receipts-core";

/** Строка выгрузки с полями для ленты движений: заказ, категории 1/4, источник. */
export type SLine = FullLine & { id: string; orderNo: string; level2: string | null; level5: string | null; importTag: string };

export type Cat = "all" | "clothes" | "acc";
/** Фильтры верхней панели. from/to — даты ISO включительно; season — строки заказов сезона; q — поиск. */
export type Filters = { from: string | null; to: string | null; seasons: string[]; cat: Cat; cat2: string[]; furs: string[]; q: string };
export const NO_FILTERS: Filters = { from: null, to: null, seasons: [], cat: "all", cat2: [], furs: [], q: "" };
export const cat2Of = (l: SLine) => (l.level4 ?? l.level3 ?? "Без категории").trim();
export const furOf = (l: SLine) => furTypeOfFabric(l.fabric);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function seasonRank(s: string): number {
  const m = /(\d{2,4})/.exec(s);
  const y = m ? (Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1])) : 0;
  return y + (/^SS/i.test(s) ? 0.2 : 0.7);
}
export const sortSeasons = (a: string[]) => [...new Set(a)].sort((x, y) => seasonRank(x) - seasonRank(y));

/** Строки без фильтра периода и сезона: категория и поиск (для остатка на начало периода). */
function passBase(l: SLine, f: Filters): boolean {
  if (f.cat !== "all" && l.cls !== f.cat) return false;
  if (f.cat2.length && !f.cat2.includes(cat2Of(l))) return false;
  if (f.furs.length && !f.furs.includes(furOf(l))) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [l.article, l.modelCode ?? "", l.colorId ?? "", l.orderNo, l.fabric ?? ""].some((v) => v.toLowerCase().includes(q));
}
const passPeriod = (l: SLine, f: Filters) => (!f.seasons.length || f.seasons.includes(l.season)) && (!f.from || l.iso >= f.from) && (!f.to || l.iso <= f.to);

export const applyFilters = (lines: SLine[], f: Filters): SLine[] => lines.filter((l) => passBase(l, f) && passPeriod(l, f));

/** Остаток на начало периода: Σ(приход − продано) строк до `from` с теми же категорией, поиском и сезоном. */
export function openingStock(lines: SLine[], f: Filters): number {
  if (!f.from) return 0;
  return sum(lines.filter((l) => passBase(l, f) && (!f.seasons.length || f.seasons.includes(l.season)) && l.iso < f.from!).map((l) => (l.kind === "RECEIPT" ? l.pcs : -l.pcs)));
}

/** Показатели набора строк: Metrics из «Маржи» + валовое/возвраты, остаток, прайс, себестоимость, покрытие, даты. */
export type Ext = Metrics & {
  /** Продано до возвратов (положительные штуки продаж) и возвраты (модуль отрицательных). */
  gross: number; returns: number;
  stock: number;
  /** Средняя цена прайса 19.10 по проданному (режим НДС как в метриках), цена продажи к прайсу, доля. */
  listPrice: number | null; priceToList: number | null;
  unitCost: number | null;
  coverMonths: number | null;
  firstReceipt: string | null; lastSale: string | null;
  /** Строк продаж без штук (скидка без движения товара). */
  noPcs: number;
  /** Розница до скидки (Gross) = выручка + Discount в режиме НДС; цена до скидки на штуку. */
  grossRev: number; priceBefore: number | null;
};
/** lastMonth — последний месяц данных. */
export type Env = { lastMonth: string };

const monthIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export function extOf(ctx: Ctx, lines: SLine[], env: Env): Ext {
  const m = metricsOf(ctx, lines);
  const inc = ctx.vat === "in";
  const sales = lines.filter((l) => l.kind === "SALE");
  const gross = sum(sales.filter((l) => l.pcs > 0).map((l) => l.pcs));
  const returns = -sum(sales.filter((l) => l.pcs < 0).map((l) => l.pcs));
  const withP = sales.filter((l) => ctx.unitPrice(l) !== null && l.pcs !== 0);
  const pcsP = sum(withP.map((l) => l.pcs));
  const listVal = sum(withP.map((l) => (inc ? ctx.unitPrice(l)! : exVatAt(ctx.unitPrice(l)!, l.iso)) * l.pcs));
  const incVal = sum(withP.map((l) => ctx.unitPrice(l)! * l.pcs));
  const both = sales.filter((l) => ctx.hasCost(l) && l.pcs !== 0);
  const pcsB = sum(both.map((l) => l.pcs));
  const stock = m.received - m.sold;
  const firstSaleIso = sales.filter((l) => l.pcs > 0).map((l) => l.iso).sort()[0] ?? null;
  const months = firstSaleIso ? Math.max(1, monthIdx(env.lastMonth) - monthIdx(firstSaleIso) + 1) : 0;
  const perMonth = months > 0 && m.sold > 0 ? m.sold / months : 0;
  const rec = lines.filter((l) => l.kind === "RECEIPT" && l.pcs > 0).map((l) => l.iso).sort();
  const lastSale = sales.filter((l) => l.pcs > 0).map((l) => l.iso).sort().pop() ?? null;
  return {
    grossRev: m.revenue + m.discountSum, priceBefore: m.sold > 0 ? (m.revenue + m.discountSum) / m.sold : null,
    ...m, gross, returns, stock,
    listPrice: pcsP > 0 ? listVal / pcsP : null,
    priceToList: incVal > 0 ? sum(withP.map((l) => l.retailRub)) / incVal - 1 : null,
    unitCost: pcsB > 0 && m.salesCost !== null ? m.salesCost / pcsB : null,
    coverMonths: stock > 0 && perMonth > 0 ? stock / perMonth : null,
    firstReceipt: rec[0] ?? null, lastSale,
    noPcs: sales.filter((l) => l.pcs === 0 && l.retailRub === 0).length,
  };
}

/** Последний месяц данных (для расчёта «месяцев покрытия»). */
export const lastMonthOf = (lines: SLine[]): string => lines.map((l) => l.iso.slice(0, 7)).sort().pop() ?? "1970-01";

/* ---------- Периоды ---------- */

export type Gran = "month" | "season";
export const GRAN_LABEL: Record<Gran, string> = { month: "Месяц", season: "Сезон" };
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const monthHead = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const dmy = (iso: string) => iso.split("-").reverse().join(".");
export const dmyShort = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

/** Понедельник недели, к которой относится дата ISO (UTC-арифметика на «чистых» датах: границы по МСК не сдвигаются). */
export function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
/** Сегодня по Москве (для пресетов «последние 30/90 дней» и давности продаж). */
export function todayMsk(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export type Bucket = { key: string; label: string; m: Ext; stock: number };

export function bucketKey(l: SLine, g: Gran): string {
  return g === "month" ? l.iso.slice(0, 7) : l.season;
}
export function bucketLabel(key: string, g: Gran): string {
  return g === "month" ? monthHead(key) : key;
}

/** Ряд для графика и таблицы по периодам. Остаток нарастающий: начинается с `opening` и идёт по корзинам по порядку. */
export function bucketsOf(ctx: Ctx, env: Env, lines: SLine[], g: Gran, opening = 0): Bucket[] {
  const by = new Map<string, SLine[]>();
  for (const l of lines) { const k = bucketKey(l, g); (by.get(k) ?? by.set(k, []).get(k)!).push(l); }
  const keys = [...by.keys()].sort(g === "season" ? (a, b) => seasonRank(a) - seasonRank(b) : undefined);
  let run = opening;
  return keys.map((key) => {
    const m = extOf(ctx, by.get(key)!, env);
    run += m.received - m.sold;
    return { key, label: bucketLabel(key, g), m, stock: run };
  });
}

/* ---------- Деревья детализации ---------- */

export type SDim = "cls" | "c2" | "fur" | "article" | "color" | "size";
export const SDIM_LABEL: Record<SDim, string> = { cls: "Категория 1", c2: "Категория 2", fur: "Тип меха", article: "Артикул", color: "Цвет", size: "Размер" };
export type Struct = "a" | "b";
export const STRUCTS: { key: Struct; label: string; order: SDim[] }[] = [
  { key: "a", label: "Мех → Категория 1 → Категория 2 → Артикул → Цвет → Размер", order: ["fur", "cls", "c2", "article", "color", "size"] },
  { key: "b", label: "Категория 1 → Категория 2 → Мех → Артикул → Цвет → Размер", order: ["cls", "c2", "fur", "article", "color", "size"] },
];
export const STRUCT_SHORT: Record<Struct, string> = { a: "Мех первым", b: "Категории первыми" };
export const parseStruct = (v: string | undefined): Struct => (STRUCTS.some((s) => s.key === v) ? (v as Struct) : "b");

/** Тип строки движения: приход, продажа, возврат (продажа с минусом) или корректировка (приход с минусом, строка без штук). */
export type MoveType = "receipt" | "sale" | "return" | "adjust";
export const MOVE_LABEL: Record<MoveType, string> = { receipt: "Приход", sale: "Продажа", return: "Возврат", adjust: "Корректировка" };
export function moveType(l: Pick<SLine, "kind" | "pcs">): MoveType {
  if (l.kind === "RECEIPT") return l.pcs > 0 ? "receipt" : "adjust";
  return l.pcs > 0 ? "sale" : l.pcs < 0 ? "return" : "adjust";
}

export type SNode = {
  id: string; dim: SDim; label: string;
  modelCode: string | null; variant: string | null; article: string | null; color: string | null;
  cols: Ext[]; children: SNode[]; n: number;
  /** Строки, вошедшие в узел (для сумм по ним: остаток в розничных ценах и т.п.). */
  lines: SLine[];
};
type Inh = { modelCode: string | null; variant: string | null; article: string | null; color: string | null };
export type Pred = (l: SLine) => boolean;

const keyOf = (l: SLine, d: SDim): { key: string; label: string } => {
  switch (d) {
    case "cls": return { key: l.cls, label: CAT_LABEL[l.cls as CatClass] };
    case "c2": { const c = (l.level4 ?? l.level3 ?? "Без категории").trim(); return { key: c, label: c }; }
    case "fur": { const f = furTypeOfFabric(l.fabric); return { key: f, label: f }; }
    case "article": return { key: l.article, label: l.article };
    case "color": { const c = colorOfLine(l.colorId); return { key: c, label: c }; }
    default: return { key: "", label: "" };
  }
};

/** Дерево по списку уровней; cols[0] — Тотал, далее по одному столбцу на предикат (сезон или месяц). Размеры (из Report) добавляет вызывающий код. */
export function buildSalesTree(ctx: Ctx, env: Env, lines: SLine[], order: readonly SDim[], preds: Pred[], path = "", inh: Inh = { modelCode: null, variant: null, article: null, color: null }): SNode[] {
  const real = order.filter((d) => d !== "size");
  if (!real.length || order[0] === "size") return [];
  const [d, ...rest] = order;
  const groups = new Map<string, { label: string; lines: SLine[] }>();
  for (const l of lines) { const k = keyOf(l, d); (groups.get(k.key) ?? groups.set(k.key, { label: k.label, lines: [] }).get(k.key)!).lines.push(l); }
  const nodes: SNode[] = [...groups].map(([key, g]) => {
    const first = g.lines[0];
    const id = path + "/" + d + ":" + key;
    const next: Inh = {
      modelCode: d === "article" ? first.modelCode : inh.modelCode,
      variant: d === "article" ? variantOfArticle(first.article) : inh.variant,
      article: d === "article" ? first.article : inh.article,
      color: d === "color" ? g.label : inh.color,
    };
    return { id, dim: d, label: g.label, ...next, n: g.lines.length, lines: g.lines, cols: [extOf(ctx, g.lines, env), ...preds.map((p) => extOf(ctx, g.lines.filter(p), env))], children: buildSalesTree(ctx, env, g.lines, rest, preds, id, next) };
  });
  return nodes.sort((a, b) => {
    return b.cols[0].revenueEx - a.cols[0].revenueEx || b.cols[0].received - a.cols[0].received || a.label.localeCompare(b.label);
  });
}

export function totalSalesNode(ctx: Ctx, env: Env, lines: SLine[], preds: Pred[], children: SNode[]): SNode {
  return { id: "total", dim: "cls", label: "Всего", modelCode: null, variant: null, article: null, color: null, n: lines.length, lines, cols: [extOf(ctx, lines, env), ...preds.map((p) => extOf(ctx, lines.filter(p), env))], children };
}

/** Размеры из Report как справочный уровень под цветом: итоги по Report на 19.10, с датами и сезонами не связаны. */
export function sizeNodes(n: SNode, sizes: ReportSizeRow[], cat: Cat, colCount: number): SNode[] {
  if (n.dim !== "color" || !n.modelCode) return [];
  const rows = sizes.filter((r) => r.modelCode === n.modelCode && colorOfLine(r.color) === n.label && (cat === "all" || r.cls === cat));
  return rows.map((r) => {
    const base = zeroExt();
    const m: Ext = { ...base, sold: r.sold, gross: r.sold, received: r.deliv, stock: r.stock, revenueEx: r.nsRubEx, revenueIncl: r.nsRub, revenue: r.nsRubEx, avgPrice: r.sold > 0 ? r.nsRub / r.sold : null, sellThrough: r.deliv > 0 ? r.sold / r.deliv : null };
    return { id: `${n.id}/size:${r.size}:${r.acode}`, dim: "size" as const, label: `${r.size} · по Report на 19.10`, modelCode: null, variant: null, article: null, color: null, n: 0, lines: [], cols: [m, ...Array.from({ length: colCount }, () => zeroExt())], children: [] };
  });
}

export function zeroExt(): Ext {
  return { sold: 0, received: 0, revenueIncl: 0, revenueEx: 0, revenue: 0, avgPrice: null, discountVsRetail: null, grossProfit: null, grossMarginPct: null, gpOfRetail: null, markupW: null, sellThrough: null, discountGiven: null, salesCost: null, discountSum: 0, revenueEur: 0, discountEurSum: 0, avgPriceEur: null, gross: 0, returns: 0, stock: 0, listPrice: null, priceToList: null, unitCost: null, coverMonths: null, firstReceipt: null, lastSale: null, noPcs: 0, grossRev: 0, priceBefore: null };
}

/** Все узлы дерева подряд (для тестов и CSV): [узел, глубина]. */
export function walkTree(root: SNode, fn: (n: SNode, depth: number) => void, depth = 0): void {
  fn(root, depth);
  for (const c of root.children) walkTree(c, fn, depth + 1);
}

/* ---------- Остатки, топ, заказы ---------- */

export type Group = { key: string; label: string; article: string | null; color: string | null; modelCode: string | null; variant: string | null; m: Ext; lines: SLine[] };
/** Группировка строк по артикулу или артикулу+цвету. */
export function groupBy(ctx: Ctx, env: Env, lines: SLine[], by: "article" | "color" | "order"): Group[] {
  const g = new Map<string, SLine[]>();
  for (const l of lines) {
    const k = by === "article" ? l.article : by === "order" ? l.orderNo : l.article + "|" + colorOfLine(l.colorId);
    (g.get(k) ?? g.set(k, []).get(k)!).push(l);
  }
  return [...g].map(([key, ls]) => {
    const f = ls[0];
    return { key, label: by === "order" ? f.orderNo : by === "article" ? f.article : `${f.article} · ${colorOfLine(f.colorId)}`, article: by === "order" ? null : f.article, color: by === "color" ? colorOfLine(f.colorId) : null, modelCode: f.modelCode, variant: by === "order" ? null : variantOfArticle(f.article), m: extOf(ctx, ls, env), lines: ls };
  });
}

/** Лента движений: строки по дате, внутри даты приход раньше продажи; остаток нарастающим. */
export type MoveRow = { line: SLine; type: MoveType; delta: number; stock: number };
export function movements(lines: SLine[]): MoveRow[] {
  const sorted = [...lines].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.kind === b.kind ? 0 : a.kind === "RECEIPT" ? -1 : 1));
  let run = 0;
  return sorted.map((line) => {
    const delta = line.kind === "RECEIPT" ? line.pcs : -line.pcs;
    run += delta;
    return { line, type: moveType(line), delta, stock: run };
  });
}

/** Ставка НДС строки (на дату продажи). */
export const vatOf = vatPctAt;
