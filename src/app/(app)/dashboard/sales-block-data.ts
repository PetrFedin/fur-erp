import "server-only";
// Данные блока «Продажи и остатки» на Главной. Расчёт — те же функции, что в разделе /sales (sales-server.ts, margin-tree.ts, sales-section.ts):
// фильтр периода applyFilters, остаток на начало openingStock, показатели extOf, ряды bucketsOf и дерево buildSalesTree. Своих формул штук и выручки здесь нет;
// новые только суммы «по себестоимости» и «по прайсу» (приход и остаток), с охватом в штуках — где цены или себестоимости нет, строка не считается и охват это показывает.
import { exVatAt, type MarginInput } from "@/lib/margin";
import { makeCtx, type Ctx, type ReportSizeRow, type VatMode } from "@/lib/margin-tree";
import { classOfLevel2, furTypeOfFabric, seasonEndIso, seasonOfDate } from "@/lib/sales-receipts-core";
import { seasonRank, todayMsk, type Cat, type SDim } from "@/lib/sales-section";
import { applyFilters, bucketsOf, buildSalesTree, extOf, lastMonthOf, NO_FILTERS, openingStock, sizeNodes, sortSeasons, totalSalesNode, type Ext, type Filters, type SLine, type SNode } from "@/lib/sales-section";
import { loadSalesInput } from "@/lib/sales-server";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { YearFilter } from "@/lib/year-filter";

export type VatPair = { in: number; ex: number };
const nul = (v: number | null) => v;

/** Деньги блока в одном режиме НДС. */
export type SalesMoney = {
  revenue: number; grossRev: number; discount: number; avgPrice: number | null;
  /** Приход и остаток: по себестоимости ТЗ и по прайсу 19.10 (в режиме НДС); pcs — сколько штук покрыто ценой (остальные в сумму не входят). */
  recvCost: number; recvCostPcs: number; recvList: number; recvListPcs: number;
  stockCost: number; stockCostPcs: number; stockList: number; stockListPcs: number;
  /** Продано по себестоимости ТЗ (нетто-штуки × себестоимость единицы модели; штуки без себестоимости в сумму не входят). */
  soldCost: number; soldCostPcs: number;
  /** Маркап = цена ÷ себестоимость: продаж (выручка ÷ себестоимость проданного) и остатка (розница по прайсу ÷ себестоимость остатка); считаются по штукам, где есть и цена, и себестоимость. */
  markupSold: number | null; markupStock: number | null;
};
export type SalesSeason = { key: string; received: number; sold: number; gross: number; returns: number; stock: number; sellThrough: number | null; revenue: VatPair; avgPrice: { in: number | null; ex: number | null } };
export type SalesMonth = { key: string; label: string; received: number; sold: number; stock: number; /** Продано (нетто) за месяц по сезону товара: ключ — сезон, например «FW 25/26». */ soldBySeason: Record<string, number> };
/** Строка таблицы: штуки не зависят от НДС, выручка и цена — по режимам. */
/** Помесячный ряд узла на оси месяцев среза: r — получено, s — продано (нетто), st — остаток нарастающим итогом, ss — продано по сезону товара. */
export type NodeSeries = { r: number[]; s: number[]; st: number[]; ss: Record<string, number[]> };
export type SalesRow = {
  id: string; label: string; sub?: string; depth: number; /** Заказано, шт. (пришло + ждём): только в срезе сезона отчёта с «ждём» (FW 26/27). */ ordered?: number; /** Приход / продано / остаток по месяцам узла на оси месяцев среза (график при наведении на строку; верхние три уровня). */ series?: NodeSeries; received: number; sold: number; stock: number; sellThrough: number | null; /** Приход в розничных ценах прайса 19.10 (штуки без цены в сумму не входят). */ recvList: VatPair;
  revenue: VatPair; avgPrice: { in: number | null; ex: number | null }; /** Остаток в розничных ценах прайса 19.10 (строки без цены в сумму не входят). */ stockList: VatPair; /** Штуки остатка, покрытые розничной ценой (для средневзвешенной цены остатка). */ stockListPcs: number; /** Полученное в деньгах: себестоимость ТЗ (что мы заплатили за полученные штуки; штуки без себестоимости в сумму не входят). */ recvCost: VatPair; /** Штуки прихода, у которых есть себестоимость (для средневзвешенной цены прихода). */ recvCostPcs: number; /** Маркап продаж и остатка (×), по режимам НДС. */ markupSold: { in: number | null; ex: number | null }; markupStock: { in: number | null; ex: number | null }; /** Весь остаток на сегодня по всем сезонам (в срезе «все сезоны» равен stock); у сезона доля = stock ÷ stockCum. */ stockCum: number; /** Весь остаток в розничных ценах и штуки, покрытые ценой (для средневзвешенной цены всего остатка). */ stockListCum: VatPair; stockListPcsCum: number; markupStockCum: { in: number | null; ex: number | null }; /** SO AS: проданное до конца сезона ÷ получено (только у закончившихся сезонов). SO STD — sellThrough на сегодня. */ soAs: number | null; children: SalesRow[];
};
export type SalesCls = "all" | "clothes" | "acc";
export const SALES_CLS: SalesCls[] = ["all", "clothes", "acc"];
export type SalesHead = { /** SO AS: проданное до конца сезона ÷ получено; null, если сезон идёт. */ soAs: number | null; /** Весь остаток на сегодня по всем сезонам (в срезе «все сезоны» равен stock). */ stockCum: number; stockListCum: VatPair; markupStockCum: { in: number | null; ex: number | null }; received: number; sold: number; gross: number; returns: number; opening: number; stock: number; sellThrough: number | null; orders: number; articles: number; money: { in: SalesMoney; ex: SalesMoney } };
/** Заказ и приход. «Пришло» по сезонам — те же числа, что в плитке «Получено» (приход по датам). По закончившимся сезонам больше ничего не ждём: заказано = пришло; по сезону отчёта FW 26/27 заказано = пришло + ждём, где ждём = Conf − поступило из отчёта по товарам. Деньги — по прайсу 19.10 (в режиме НДС). */
export type OrderMoney = { in: number; ex: number };
export type OrderNode = { id: string; label: string; ordered: number; delivered: number; awaiting: number; orderedRub: OrderMoney; deliveredRub: OrderMoney; awaitingRub: OrderMoney; children: OrderNode[] };
/** Сливает приход (по сезону) и «ждём» (по FW 26/27) в одно дерево по подписям узлов: заказано = пришло + ждём. */
export function mergeOrderNodes(delivered: OrderNode[], awaiting: OrderNode[]): OrderNode[] {
  const add = (a: OrderMoney, b: OrderMoney): OrderMoney => ({ in: a.in + b.in, ex: a.ex + b.ex });
  const by = new Map(awaiting.map((n) => [n.label, n]));
  const out = delivered.map((d): OrderNode => {
    const w = by.get(d.label); by.delete(d.label);
    if (!w) return d;
    return { ...d, awaiting: w.awaiting, awaitingRub: w.awaitingRub, ordered: d.delivered + w.awaiting, orderedRub: add(d.deliveredRub, w.awaitingRub), children: mergeOrderNodes(d.children, w.children) };
  });
  for (const w of by.values()) out.push({ ...w, delivered: 0, deliveredRub: { in: 0, ex: 0 }, ordered: w.awaiting, orderedRub: w.awaitingRub });
  return out.sort((a, b) => b.ordered - a.ordered);
}
export type OrderLine = { key: string; /** Разворот сезона: тип меха → кат. 1 → кат. 2 («fur») и кат. 1 → кат. 2 → тип меха («cls»); нет категорий в данных — нет разворота. */ tree?: Record<"fur" | "cls", OrderNode[]>; label: string; ordered: number; delivered: number; awaiting: number; orderedRub: OrderMoney; deliveredRub: OrderMoney; awaitingRub: OrderMoney };
export type OrdersSummary = { lines: OrderLine[]; total: OrderLine; /** Conf отчёта целиком (включая разницу по закончившимся сезонам). */ confReport: number };
export const ORDERS_OPEN_SEASON = "FW 26/27";
export function ordersSummary(sizes: ReportSizeRow[], cls: SalesCls, received: { season: string; received: number; recvList: OrderMoney }[], unit: (r: ReportSizeRow) => OrderMoney | null = () => null, allRecvList?: OrderMoney): OrdersSummary | null {
  if (!sizes.some((r) => r.fw26Conf !== undefined)) return null;
  const rs = sizes.filter((r) => cls === "all" || r.cls === (cls === "clothes" ? "clothes" : "acc"));
  const sum = (f: (r: ReportSizeRow) => number) => rs.reduce((a, r) => a + f(r), 0);
  const awaiting = Math.max(0, sum((r) => (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0)));
  const awaitingRub: OrderMoney = { in: 0, ex: 0 };
  if (awaiting > 0) for (const r of rs) { const u = unit(r), d = (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0); if (u && d !== 0) { awaitingRub.in += u.in * d; awaitingRub.ex += u.ex * d; } }
  const zero = (): OrderMoney => ({ in: 0, ex: 0 });
  const add = (a: OrderMoney, b: OrderMoney): OrderMoney => ({ in: a.in + b.in, ex: a.ex + b.ex });
  const lines = received.map((x): OrderLine => {
    const open = x.season === ORDERS_OPEN_SEASON, w = open ? awaiting : 0, wr = open ? awaitingRub : zero();
    return { key: x.season, label: x.season, ordered: x.received + w, delivered: x.received, awaiting: w, orderedRub: add(x.recvList, wr), deliveredRub: x.recvList, awaitingRub: wr };
  });
  const tot = (f: (l: OrderLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const totM = (f: (l: OrderLine) => OrderMoney): OrderMoney => lines.reduce((a, l) => add(a, f(l)), zero());
  const total: OrderLine = { key: "total", label: "Всего", ordered: tot((l) => l.ordered), delivered: tot((l) => l.delivered), awaiting: tot((l) => l.awaiting), orderedRub: totM((l) => l.orderedRub), deliveredRub: totM((l) => l.deliveredRub), awaitingRub: totM((l) => l.awaitingRub) };
  // «Пришло» в рублях в итоге — ровно как в плитке «Получено» (срез «все сезоны»): сумма сезонов может отличаться на копейки округления по строкам.
  if (allRecvList) { total.deliveredRub = allRecvList; total.orderedRub = add(allRecvList, total.awaitingRub); }
  return { lines, total, confReport: sum((r) => r.conf ?? 0) };
}
export type SalesView = { rows: SalesRow[]; total: SalesRow };
/** Срез блока: «все сезоны» или один сезон; внутри — Тотал / Одежда / Аксессуары, две иерархии таблицы (мех → кат.1 → кат.2 и кат.1 → кат.2 → мех) и ряд по месяцам. */
export type SalesSlice = { /** Дата окончания сезона, если он закончился (тогда есть SO AS), иначе null. */ soAsEnd: string | null; head: Record<SalesCls, SalesHead>; months: Record<SalesCls, SalesMonth[]>; views: Record<SalesCls, { fur: SalesView; cls: SalesView }> };
/** Продажи по календарным сезонам (по дате продажи): весь проданный товар, товар того же сезона (SSN) и товара прошлых сезонов (non-SSN). */
export type SsnPart = { pcs: number; rub: OrderMoney };
/** Календарный сезон (по дате): пришло (приход по дате прихода), продано всего, SSN — товар этого сезона, non-SSN — товар прошлых сезонов. */
export type SsnRow = { key: string; recv: number; total: SsnPart; ssn: SsnPart; non: SsnPart };
/** Матрица как в отчёте Sales: строки — сезон товара (приход, продано по календарным сезонам), столбцы — календарные сезоны продаж. */
export type SsnMatrixRow = { goods: string; recv: number; sold: SsnPart; cells: Record<string, SsnPart> };
export type SsnData = { rows: SsnRow[]; matrix: SsnMatrixRow[]; cal: string[] };
function ssnDataOf(lines: SLine[], cls: SalesCls): SsnData {
  const blank = (): SsnPart => ({ pcs: 0, rub: { in: 0, ex: 0 } });
  const by = new Map<string, SsnRow>(), mx = new Map<string, SsnMatrixRow>();
  const row = (key: string) => by.get(key) ?? by.set(key, { key, recv: 0, total: blank(), ssn: blank(), non: blank() }).get(key)!;
  const mrow = (goods: string) => mx.get(goods) ?? mx.set(goods, { goods, recv: 0, sold: blank(), cells: {} }).get(goods)!;
  for (const l of lines) {
    const c = classOfLevel2(l.level2);
    if (cls !== "all" && c !== (cls === "clothes" ? "clothes" : "acc")) continue;
    const key = seasonOfDate(l.iso);
    if (l.kind === "RECEIPT") { row(key).recv += l.pcs; mrow(l.season).recv += l.pcs; continue; }
    if (l.kind !== "SALE") continue;
    const r = row(key), part = l.season === key ? r.ssn : r.non;
    for (const p of [r.total, part]) { p.pcs += l.pcs; p.rub.in += l.retailRub ?? 0; p.rub.ex += l.retailRubExVat ?? 0; }
    const m = mrow(l.season), cell = (m.cells[key] ??= blank());
    for (const p of [m.sold, cell]) { p.pcs += l.pcs; p.rub.in += l.retailRub ?? 0; p.rub.ex += l.retailRubExVat ?? 0; }
  }
  const rows = [...by.values()].sort((a, b) => seasonRank(a.key) - seasonRank(b.key));
  const matrix = [...mx.values()].sort((a, b) => seasonRank(a.goods) - seasonRank(b.goods));
  return { rows, matrix, cal: rows.map((r) => r.key) };
}
export type SalesBlock = {
  year: YearFilter; periodNote: string;
  orders: number; articles: number;
  received: number; sold: number; gross: number; returns: number; opening: number; stock: number; sellThrough: number | null; firstReceipt: string | null; lastSale: string | null;
  money: { in: SalesMoney; ex: SalesMoney };
  seasons: SalesSeason[]; months: SalesMonth[]; rows: SalesRow[]; total: SalesRow;
  /** Срезы по сезонам: ключ «all» или сезон (FW25/26 …). */
  slices: Record<string, SalesSlice>;
  /** Продажи по календарным сезонам: SSN-товар и non-SSN-товар (для Всего / Одежда / Аксессуары). */
  ssn: Record<SalesCls, SsnData>;
  /** Заказ и приход по сезонам (отчёт по товарам) для Тотал / Одежда / Аксессуары; нет данных — null. */
  orderSummary: Record<SalesCls, OrdersSummary | null>;
  /** Адрес страницы «Продажи и остатки» с тем же периодом (год) и режимом НДС. */
  href: { in: string; ex: string };
  hasData: boolean;
};

/** Русские названия типов меха (в выгрузке — английские). Неизвестный тип остаётся как в выгрузке. */
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", SWAKARA: "Свакара", FOX: "Лиса", "ARCTIC FOX": "Песец", LYNX: "Рысь", BEAVER: "Бобр", "Не указан": "Тип меха не указан" };
export const furRu = (k: string) => FUR_RU[k.toUpperCase()] ?? k;

/** Суммы «по себестоимости» и «по прайсу» для прихода и остатка набора строк (до конца периода). Остаток по артикулу и цвету = приход − продано. */
function stockMoney(ctx: Ctx, lines: SLine[], scope: SLine[]): Pick<SalesMoney, "recvCost" | "recvCostPcs" | "recvList" | "recvListPcs" | "stockCost" | "stockCostPcs" | "stockList" | "stockListPcs" | "soldCost" | "soldCostPcs" | "markupSold" | "markupStock"> {
  const inc = ctx.vat === "in";
  const price = (l: SLine, p: number) => (inc ? p : exVatAt(p, l.iso));
  const cost = (l: SLine) => (inc ? ctx.unitIncl(l) : ctx.unitExcl(l));
  let recvCost = 0, recvCostPcs = 0, recvList = 0, recvListPcs = 0;
  for (const l of lines) {
    if (l.kind !== "RECEIPT") continue;
    if (ctx.hasCost(l)) { recvCost += cost(l) * l.pcs; recvCostPcs += l.pcs; }
    const p = ctx.unitPrice(l);
    if (p !== null) { recvList += price(l, p) * l.pcs; recvListPcs += l.pcs; }
  }
  // Остаток: по артикулу+цвету; цена и себестоимость берутся с последней строки группы (одни и те же для артикула), НДС прайса — по дате последней строки.
  const by = new Map<string, { net: number; last: SLine }>();
  for (const l of scope) {
    const k = l.article + "|" + (l.colorId ?? "");
    const g = by.get(k) ?? { net: 0, last: l };
    g.net += l.kind === "RECEIPT" ? l.pcs : -l.pcs;
    if (l.iso >= g.last.iso) g.last = l;
    by.set(k, g);
  }
  let stockCost = 0, stockCostPcs = 0, stockList = 0, stockListPcs = 0, bothList = 0, bothCost = 0;
  for (const g of by.values()) {
    if (g.net <= 0) continue; // денежные суммы остатка — только по артикулам с положительным остатком
    if (ctx.hasCost(g.last)) { stockCost += cost(g.last) * g.net; stockCostPcs += g.net; }
    const p = ctx.unitPrice(g.last);
    if (p !== null) { stockList += price(g.last, p) * g.net; stockListPcs += g.net; }
    if (p !== null && ctx.hasCost(g.last)) { bothList += price(g.last, p) * g.net; bothCost += cost(g.last) * g.net; }
  }
  let sRev = 0, sCost = 0, sPcs = 0;
  for (const l of lines) {
    if (l.kind !== "SALE" || !ctx.hasCost(l)) continue;
    // Строка продажи без штук (корректировка цены: сумма есть, штук нет) входит в выручку артикула, но не в штуки и себестоимость — как в отчёте по товарам.
    sRev += inc ? l.retailRub : l.retailRubExVat; sCost += cost(l) * l.pcs; sPcs += l.pcs;
  }
  return { recvCost, recvCostPcs, recvList, recvListPcs, stockCost, stockCostPcs, stockList, stockListPcs, soldCost: sCost, soldCostPcs: sPcs, markupSold: sCost > 0 ? sRev / sCost : null, markupStock: bothCost > 0 ? bothList / bothCost : null };
}

function moneyOf(ctx: Ctx, head: Ext, lines: SLine[], scope: SLine[]): SalesMoney {
  return { revenue: head.revenue, grossRev: head.grossRev, discount: head.discountSum, avgPrice: head.avgPrice, ...stockMoney(ctx, lines, scope) };
}

/** Период блока в виде фильтров /sales: год → с 1 января по 31 декабря; «все годы» — без периода. */
export const salesFilters = (year: YearFilter): Filters => (year === "all" ? NO_FILTERS : { ...NO_FILTERS, from: `${year}-01-01`, to: `${year}-12-31` });

/** Адрес /sales с периодом года, режимом НДС и (необязательно) сезоном. */
export function salesHref(year: YearFilter, vat: VatMode, season?: string): string {
  const p = new URLSearchParams();
  if (year !== "all") { p.set("from", `${year}-01-01`); p.set("to", `${year}-12-31`); }
  if (season) p.set("season", season);
  if (vat === "ex") p.set("vat", "ex");
  const q = p.toString();
  return "/sales" + (q ? "?" + q : "");
}

/** Размеры под цветом: итоги по Report на 19.10 (штуки и выручка), остальных показателей по размерам нет. */
function sizeRows(n: SNode, depth: number, e: RowEnv): SalesRow[] {
  if (n.dim !== "color" || e.sizes.length === 0) return [];
  return sizeNodes(n, e.sizes, e.cat, 1).map((z) => {
    const m = z.cols[0];
    return {
      id: z.id, label: z.label, depth: depth + 1, recvList: { in: 0, ex: 0 }, received: m.received, sold: m.sold, stock: m.stock, sellThrough: m.sellThrough,
      revenue: { in: m.revenueIncl, ex: m.revenueEx }, avgPrice: { in: nul(m.avgPrice), ex: nul(m.sold > 0 ? m.revenueEx / m.sold : null) },
      stockList: { in: 0, ex: 0 }, stockListPcs: 0, recvCost: { in: 0, ex: 0 }, recvCostPcs: 0, markupSold: { in: null, ex: null }, markupStock: { in: null, ex: null }, stockCum: m.stock, stockListCum: { in: 0, ex: 0 }, stockListPcsCum: 0, markupStockCum: { in: null, ex: null }, soAs: null, children: [],
    };
  });
}

const inPeriod2 = (l: SLine, e: RowEnv) => e.inPeriod(l);
type CumNode = { stock: number; list: VatPair; listPcs: number; markup: { in: number | null; ex: number | null } };
type RowEnv = { /** Помесячный ряд узла по его строкам на оси месяцев среза; null — не считать. */ seriesOf: ((lines: SLine[]) => NodeSeries) | null; seasonEnd: string | null; cum: Map<string, CumNode> | null; ctxs: { in: Ctx; ex: Ctx }; inPeriod: (l: SLine) => boolean; /** Размеры из Report (справочно, без привязки к датам и сезонам): только в срезе «все сезоны». */ sizes: ReportSizeRow[]; cat: Cat };
function rowOf(n: SNode, depth: number, tIn: SNode, tEx: SNode, e: RowEnv): SalesRow {
  // cols[0] — всё до конца периода (остаток), cols[1] — движения внутри периода.
  const inP = n.cols[1], inE = tEx.cols[1], inI = tIn.cols[1];
  const label = n.dim === "fur" ? furRu(n.label) : n.label;
  const inPer = n.lines.filter(e.inPeriod);
  return {
    id: n.id, label, depth,
    recvList: { in: stockMoney(e.ctxs.in, inPer, n.lines).recvList, ex: stockMoney(e.ctxs.ex, inPer, n.lines).recvList },
    series: depth <= 2 && e.seriesOf && n.dim !== "article" && n.dim !== "color" ? e.seriesOf(n.lines) : undefined,
    received: inP.received, sold: inP.sold, stock: n.cols[0].stock, sellThrough: inP.sellThrough,
    revenue: { in: inI.revenue, ex: inE.revenue }, avgPrice: { in: nul(inI.avgPrice), ex: nul(inE.avgPrice) },
    stockList: { in: stockMoney(e.ctxs.in, inPer, n.lines).stockList, ex: stockMoney(e.ctxs.ex, inPer, n.lines).stockList },
    stockListPcs: stockMoney(e.ctxs.in, inPer, n.lines).stockListPcs,
    markupSold: { in: stockMoney(e.ctxs.in, inPer, n.lines).markupSold, ex: stockMoney(e.ctxs.ex, inPer, n.lines).markupSold },
    markupStock: { in: stockMoney(e.ctxs.in, inPer, n.lines).markupStock, ex: stockMoney(e.ctxs.ex, inPer, n.lines).markupStock },
    recvCostPcs: stockMoney(e.ctxs.in, inPer, n.lines).recvCostPcs,
    recvCost: { in: stockMoney(e.ctxs.in, inPer, n.lines).recvCost, ex: stockMoney(e.ctxs.ex, inPer, n.lines).recvCost },
    soAs: e.seasonEnd && inP.received > 0 ? n.lines.filter((l) => l.kind === "SALE" && l.iso <= e.seasonEnd! && inPeriod2(l, e)).reduce((a, l) => a + l.pcs, 0) / inP.received : null,
    stockCum: e.cum?.get(n.id)?.stock ?? n.cols[0].stock,
    stockListCum: e.cum?.get(n.id)?.list ?? { in: stockMoney(e.ctxs.in, inPer, n.lines).stockList, ex: stockMoney(e.ctxs.ex, inPer, n.lines).stockList },
    stockListPcsCum: e.cum?.get(n.id)?.listPcs ?? stockMoney(e.ctxs.in, inPer, n.lines).stockListPcs,
    markupStockCum: e.cum?.get(n.id)?.markup ?? { in: stockMoney(e.ctxs.in, inPer, n.lines).markupStock, ex: stockMoney(e.ctxs.ex, inPer, n.lines).markupStock },
    children: n.children.map((c, i) => rowOf(c, depth + 1, tIn.children[i], tEx.children[i], e)).concat(sizeRows(n, depth, e)),
  };
}

/** Чистая сборка блока из загруженных данных (для тестов: те же числа, что и в загрузчике). */
/** Вид меха из справочника → тип меха в выгрузке продаж (фильтр «Вид меха» Главной действует и здесь). */
const FUR_KEY: Record<string, string> = { Соболь: "SABLE", Норка: "MINK", Лиса: "FOX", Свакара: "SWAKARA", Рысь: "LYNX", Бобр: "BEAVER" };

export function buildSalesBlock(input: MarginInput, year: YearFilter, sizes: ReportSizeRow[] = [], furNames: string[] = []): SalesBlock {
  const furKeys = furNames.map((n) => FUR_KEY[n]).filter(Boolean);
  const all = furNames.length ? (input.lines as SLine[]).filter((l) => furKeys.includes(furTypeOfFabric(l.fabric))) : (input.lines as SLine[]);
  const base = salesFilters(year);
  const env = { lastMonth: lastMonthOf(all) };
  const ctxs = { in: makeCtx(input, "in"), ex: makeCtx(input, "ex") };
  /** Закончившийся сезон: дата окончания раньше сегодняшнего дня; для идущего сезона SO AS не считаем. */
  const finishedEnd = (season: string): string | null => { const end = season === "all" ? null : seasonEndIso(season); return end && end < todayMsk() ? end : null; };
  const inPeriod = (l: SLine) => (!base.from || l.iso >= base.from) && (!base.to || l.iso <= base.to);
  /** Помесячный ряд узла на заданной оси месяцев (месяцы без движений — нули, остаток переносится). */
  const seriesFor = (axis: string[]) => (ls0: SLine[]): NodeSeries => {
    const ls = ls0.filter(inPeriod);
    const bk = new Map(bucketsOf(ctxs.in, env, ls, "month", openingStock(ls0, base)).map((x) => [x.key, x]));
    const seasons = Array.from(new Set(ls.filter((l) => l.kind === "SALE").map((l) => l.season)));
    const out: NodeSeries = { r: [], s: [], st: [], ss: Object.fromEntries(seasons.map((k) => [k, [] as number[]])) };
    let run = openingStock(ls0, base);
    for (const k of axis) {
      const b = bk.get(k);
      if (b) run = b.stock;
      out.r.push(b ? b.m.received : 0); out.s.push(b ? b.m.sold : 0); out.st.push(run);
      for (const sk of seasons) out.ss[sk].push(ls.filter((l) => l.kind === "SALE" && l.season === sk && l.iso.slice(0, 7) === k).reduce((a, l) => a + l.pcs, 0));
    }
    return out;
  };
  const rowEnvOf = (season: string, cat: Cat, cum: Map<string, CumNode> | null, axis: string[] = []): RowEnv => ({ seriesOf: axis.length ? seriesFor(axis) : null, seasonEnd: finishedEnd(season), cum, ctxs, inPeriod, sizes: season === "all" ? sizes : [], cat });

  const headOf = (f: Filters): SalesHead => {
    const lines = applyFilters(all, f), scope = applyFilters(all, { ...f, from: null });
    const opening = openingStock(all, f);
    const hIn = extOf(ctxs.in, lines, env), hEx = extOf(ctxs.ex, lines, env);
    return {
      soAs: (() => { const se = f.seasons.length === 1 ? finishedEnd(f.seasons[0]) : null; return se && hIn.received > 0 ? lines.filter((l) => l.kind === "SALE" && l.iso <= se).reduce((a, l) => a + l.pcs, 0) / hIn.received : null; })(),
      stockCum: 0, stockListCum: { in: 0, ex: 0 }, markupStockCum: { in: null, ex: null },
      received: hIn.received, sold: hIn.sold, gross: hIn.gross, returns: hIn.returns, opening, stock: opening + hIn.received - hIn.sold, sellThrough: hIn.sellThrough,
      orders: new Set(lines.map((l) => l.orderNo)).size, articles: new Set(lines.map((l) => l.article)).size,
      money: { in: moneyOf(ctxs.in, hIn, lines, scope), ex: moneyOf(ctxs.ex, hEx, lines, scope) },
    };
  };
  const viewOf = (f: Filters, order: readonly SDim[], cumSeasons: string[] | null): SalesView => {
    // Весь остаток по узлам: то же дерево на строках всех сезонов; узлы сопоставляются по id.
    let cum: Map<string, CumNode> | null = null;
    if (cumSeasons) {
      const scopeC = applyFilters(all, { ...f, seasons: cumSeasons, from: null });
      cum = new Map<string, CumNode>();
      const put = (n: SNode) => {
        const inPer = n.lines.filter(inPeriod);
        const mi = stockMoney(ctxs.in, inPer, n.lines), me = stockMoney(ctxs.ex, inPer, n.lines);
        cum!.set(n.id, { stock: n.cols[0].stock, list: { in: mi.stockList, ex: me.stockList }, listPcs: mi.stockListPcs, markup: { in: mi.markupStock, ex: me.markupStock } });
      };
      const walk = (ns: SNode[]) => { for (const n of ns) { put(n); walk(n.children); } };
      const kidsC = buildSalesTree(ctxs.in, env, scopeC, order, [inPeriod]);
      walk(kidsC);
      put(totalSalesNode(ctxs.in, env, scopeC, [inPeriod], kidsC));
    }
    const axis = bucketsOf(ctxs.in, env, applyFilters(all, f), "month", 0).map((x) => x.key);
    const rowEnv = rowEnvOf(f.seasons[0] ?? "all", f.cat, cum, axis);
    const scope = applyFilters(all, { ...f, from: null });
    const trees = (v: "in" | "ex") => { const kids = buildSalesTree(ctxs[v], env, scope, order, [inPeriod]); return { kids, total: totalSalesNode(ctxs[v], env, scope, [inPeriod], kids) }; };
    const tIn = trees("in"), tEx = trees("ex");
    const rows = tIn.kids.map((n, i) => rowOf(n, 0, n, tEx.kids[i], rowEnv)).filter((r) => r.received !== 0 || r.sold !== 0 || r.stock !== 0);
    return { rows, total: rowOf(tIn.total, 0, tIn.total, tEx.total, rowEnv) };
  };
  const sliceOf = (season: string, seasonKeys: string[]): SalesSlice => {
    // Для выбранного сезона «весь остаток» — остаток всех сезонов на сегодня (без фильтра сезона); доля сезона считается от него.
    const upto = season === "all" ? null : ([] as string[]);
    const mk = (cls: SalesCls): Filters => ({ ...base, seasons: season === "all" ? [] : [season], cat: cls });
    const head = {} as Record<SalesCls, SalesHead>, views = {} as SalesSlice["views"], months = {} as SalesSlice["months"];
    for (const c of SALES_CLS) {
      head[c] = headOf(mk(c));
      if (upto) { const hc = headOf({ ...mk(c), seasons: upto }); head[c].stockCum = hc.stock; head[c].stockListCum = { in: hc.money.in.stockList, ex: hc.money.ex.stockList }; head[c].markupStockCum = { in: hc.money.in.markupStock, ex: hc.money.ex.markupStock }; }
      else { head[c].stockCum = head[c].stock; head[c].stockListCum = { in: head[c].money.in.stockList, ex: head[c].money.ex.stockList }; head[c].markupStockCum = { in: head[c].money.in.markupStock, ex: head[c].money.ex.markupStock }; }
      views[c] = { fur: viewOf(mk(c), ["fur", "cls", "c2", "article", "color"], upto), cls: viewOf(mk(c), ["cls", "c2", "fur", "article", "color"], upto) };
      {
        const ls = applyFilters(all, mk(c));
        months[c] = bucketsOf(ctxs.in, env, ls, "month", openingStock(all, mk(c))).map((b) => {
          const bySeason: Record<string, number> = {};
          for (const l of ls) if (l.kind === "SALE" && l.iso.slice(0, 7) === b.key) bySeason[l.season] = (bySeason[l.season] ?? 0) + l.pcs;
          return { key: b.key, label: b.label, received: b.m.received, sold: b.m.sold, stock: b.stock, soldBySeason: bySeason };
        });
      }
    }
    return { soAsEnd: finishedEnd(season), head, months, views };
  };

  const lines = applyFilters(all, base);
  const seasonKeys = sortSeasons(lines.map((l) => l.season));
  const slices: Record<string, SalesSlice> = { all: sliceOf("all", seasonKeys) };
  for (const k of seasonKeys) slices[k] = sliceOf(k, seasonKeys);
  const all0 = slices.all, h = all0.head.all;

  const season = (v: "in" | "ex") => bucketsOf(ctxs[v], env, lines, "season", 0);
  const sIn = season("in"), sEx = season("ex");
  let run = h.opening;
  const seasons: SalesSeason[] = sIn.map((b, i) => {
    run += b.m.received - b.m.sold;
    return { key: b.key, received: b.m.received, sold: b.m.sold, gross: b.m.gross, returns: b.m.returns, stock: run, sellThrough: b.m.sellThrough, revenue: { in: b.m.revenue, ex: sEx[i].m.revenue }, avgPrice: { in: nul(b.m.avgPrice), ex: nul(sEx[i].m.avgPrice) } };
  });
  const hIn = extOf(ctxs.in, lines, env);
  /** Разворот «Заказ и приход» по иерархиям: приход сезона — из деревьев срезов (те же узлы, что в таблице ниже), «ждём» (FW 26/27) — те же деревья на строках Conf − поступило из отчёта. */
  /** Категории строки отчёта: из самой строки (внесены l2–l5), иначе из строк прихода того же артикула, затем той же модели; нет нигде — группа по классу и «Без категории». */
  const levelsByArticle = new Map<string, { l2: string | null; l3: string | null; l4: string | null; l5: string | null }>();
  const levelsByModel = new Map<string, { l2: string | null; l3: string | null; l4: string | null; l5: string | null }>();
  for (const l of all) {
    const v = { l2: l.level2, l3: l.level3, l4: l.level4, l5: l.level5 };
    if (!levelsByArticle.has(l.article)) levelsByArticle.set(l.article, v);
    if (l.modelCode && !levelsByModel.has(l.modelCode)) levelsByModel.set(l.modelCode, v);
  }
  const levelsOf = (r: ReportSizeRow) => {
    if (r.l2 !== undefined) return { l2: r.l2 || null, l3: r.l3 || null, l4: r.l4 || null, l5: r.l5 || null };
    return levelsByArticle.get(r.acode) ?? (r.modelCode ? levelsByModel.get(r.modelCode) : undefined) ?? { l2: r.cls === "clothes" ? "Одежда" : "Аксессуары", l3: null, l4: null, l5: null };
  };
  const HIER_ORDER: Record<"fur" | "cls", readonly SDim[]> = { fur: ["fur", "cls", "c2"], cls: ["cls", "c2", "fur"] };
  const awaitingNodes = (c: SalesCls, hier: "fur" | "cls"): OrderNode[] => {
    const lines: SLine[] = [];
    for (const r of sizes) {
      const d = (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0);
      if (d === 0 || (c !== "all" && r.cls !== (c === "clothes" ? "clothes" : "acc"))) continue;
      const lv = levelsOf(r);
      lines.push({ id: `await|${r.acode}|${r.color}|${r.size}`, kind: "RECEIPT", iso: todayMsk(), season: ORDERS_OPEN_SEASON, orderNo: "", modelCode: r.modelCode, article: r.acode, colorId: r.color, fabric: r.acode.includes("/") ? r.acode.slice(r.acode.indexOf("/") + 1) : r.acode, level2: lv.l2, level3: lv.l3, level4: lv.l4, level5: lv.l5, importTag: "", pcs: d, retailRub: 0, retailRubExVat: 0, discountRub: 0, discountRubExVat: 0, retailEur: 0, retailEurExVat: 0, discountEur: 0, discountEurExVat: 0, cls: r.cls } as SLine);
    }
    if (lines.length === 0) return [];
    const conv = (ns: SNode[], depth: number): OrderNode[] => ns.map((n): OrderNode => {
      const q = n.cols[1].received, mi = stockMoney(ctxs.in, n.lines, n.lines), me = stockMoney(ctxs.ex, n.lines, n.lines), m = { in: mi.recvList, ex: me.recvList };
      return { id: n.id, label: n.dim === "fur" ? furRu(n.label) : n.label, ordered: q, delivered: 0, awaiting: q, orderedRub: m, deliveredRub: { in: 0, ex: 0 }, awaitingRub: m, children: depth < 2 ? conv(n.children, depth + 1) : [] };
    }).filter((n) => n.awaiting !== 0);
    return conv(buildSalesTree(ctxs.in, env, lines, HIER_ORDER[hier], [() => true]), 0);
  };
  const deliveredNodes = (rows: SalesRow[], depth: number): OrderNode[] => rows.filter((r) => r.received !== 0).map((r): OrderNode => ({ id: r.id, label: r.label, ordered: r.received, delivered: r.received, awaiting: 0, orderedRub: r.recvList, deliveredRub: r.recvList, awaitingRub: { in: 0, ex: 0 }, children: depth < 2 ? deliveredNodes(r.children, depth + 1) : [] }));
  const orderTrees = (c: SalesCls, season: string): Record<"fur" | "cls", OrderNode[]> => {
    const one = (hier: "fur" | "cls") => { const d = deliveredNodes(slices[season].views[c][hier].rows, 0); return season === ORDERS_OPEN_SEASON ? mergeOrderNodes(d, awaitingNodes(c, hier)) : d; };
    return { fur: one("fur"), cls: one("cls") };
  };
  /** Цена прайса 19.10 на строку отчёта (артикул × цвет) в режимах НДС; НДС для «без НДС» — по сегодняшней дате. */
  const today = todayMsk();
  const orderUnit = (r: ReportSizeRow): OrderMoney | null => { const p = ctxs.in.unitPrice({ article: r.acode, colorId: r.color, modelCode: r.modelCode } as SLine); return p === null ? null : { in: p, ex: exVatAt(p, today) }; };
  const orderSummary = Object.fromEntries(SALES_CLS.map((c) => {
      const sum = ordersSummary(sizes, c, seasonKeys.map((k) => { const m = slices[k].head[c].money; return { season: k, received: slices[k].head[c].received, recvList: { in: m.in.recvList, ex: m.ex.recvList } }; }), orderUnit, { in: slices.all.head[c].money.in.recvList, ex: slices.all.head[c].money.ex.recvList });
      if (sum) for (const l of sum.lines) l.tree = orderTrees(c, l.key);
      return [c, sum];
    })) as Record<SalesCls, OrdersSummary | null>;

  /** Сезон отчёта с «ждём» (FW 26/27): у строк таблицы — «Заказано, шт.» (пришло + ждём); узлы, где пока ничего не пришло, добавляются строками с нулями. */
  const blankRow = (id: string, label: string, depth: number): SalesRow => ({
    id, label, depth, recvList: { in: 0, ex: 0 }, received: 0, sold: 0, stock: 0, sellThrough: null, revenue: { in: 0, ex: 0 }, avgPrice: { in: null, ex: null },
    stockList: { in: 0, ex: 0 }, stockListPcs: 0, recvCost: { in: 0, ex: 0 }, recvCostPcs: 0, markupSold: { in: null, ex: null }, markupStock: { in: null, ex: null },
    stockCum: 0, stockListCum: { in: 0, ex: 0 }, stockListPcsCum: 0, markupStockCum: { in: null, ex: null }, soAs: null, children: [],
  });
  const attachOrdered = (rows: SalesRow[], tree: OrderNode[], depth: number, idp: string) => {
    for (const n of tree) {
      if (n.ordered === 0 && n.delivered === 0) continue;
      let r = rows.find((x) => x.label === n.label);
      if (!r) { r = blankRow(`${idp}/ord:${n.label}`, n.label, depth); rows.push(r); }
      r.ordered = n.ordered;
      if (depth < 2) attachOrdered(r.children, n.children, depth + 1, r.id);
    }
  };
  if (slices[ORDERS_OPEN_SEASON] && orderSummary.all) {
    for (const c of SALES_CLS) {
      const fw = orderSummary[c]?.lines.find((l) => l.key === ORDERS_OPEN_SEASON);
      if (!fw?.tree) continue;
      for (const hier of ["fur", "cls"] as const) {
        const view = slices[ORDERS_OPEN_SEASON].views[c][hier];
        attachOrdered(view.rows, fw.tree[hier], 0, `${c}/${hier}`);
        view.total.ordered = fw.ordered;
        view.rows.sort((x, y) => (y.ordered ?? y.received) - (x.ordered ?? x.received) || y.received - x.received);
      }
    }
  }

  // «Заказано, шт.» в таблице — в каждом срезе: по закончившимся сезонам заказано = пришло (ничего не ждём); во «все сезоны» к пришедшему добавляется «ждём» по FW 26/27.
  const fillOrdered = (rows: SalesRow[]) => { for (const r of rows) { if (r.ordered === undefined) r.ordered = r.received; fillOrdered(r.children); } };
  const addAwaiting = (rows: SalesRow[], tree: OrderNode[], depth: number, idp: string) => {
    for (const n of tree) {
      if (!(n.awaiting > 0)) continue;
      let r = rows.find((x) => x.label === n.label);
      if (!r) { r = blankRow(`${idp}/aw:${n.label}`, n.label, depth); r.ordered = 0; rows.push(r); }
      r.ordered = (r.ordered ?? r.received) + n.awaiting;
      if (depth < 2) addAwaiting(r.children, n.children, depth + 1, r.id);
    }
  };
  for (const [sk, sl] of Object.entries(slices)) {
    for (const c of SALES_CLS) for (const hier of ["fur", "cls"] as const) {
      const view = sl.views[c][hier];
      if (sk === ORDERS_OPEN_SEASON) { if (view.total.ordered === undefined) view.total.ordered = view.total.received; fillOrdered(view.rows); continue; }
      fillOrdered(view.rows);
      view.total.ordered = view.total.received;
      if (sk === "all") {
        const fw = orderSummary[c]?.lines.find((l) => l.key === ORDERS_OPEN_SEASON);
        if (fw?.tree) { addAwaiting(view.rows, fw.tree[hier], 0, `${c}/${hier}/all`); view.total.ordered = view.total.received + fw.awaiting; view.rows.sort((x, y) => (y.ordered ?? y.received) - (x.ordered ?? x.received) || y.received - x.received); }
      }
    }
  }

  return {
    year, periodNote: year === "all" ? "все годы" : `${year} год`,
    orders: h.orders, articles: h.articles,
    received: h.received, sold: h.sold, gross: h.gross, returns: h.returns, opening: h.opening, stock: h.stock, sellThrough: h.sellThrough, firstReceipt: hIn.firstReceipt, lastSale: hIn.lastSale,
    money: h.money, seasons, months: all0.months.all, rows: all0.views.all.fur.rows, total: all0.views.all.fur.total, slices,
    orderSummary,
    ssn: Object.fromEntries(SALES_CLS.map((c) => [c, ssnDataOf(all, c)])) as Record<SalesCls, SsnData>,
    href: { in: salesHref(year, "in"), ex: salesHref(year, "ex") },
    hasData: all.length > 0,
  };
}

import { tzAwaitSizes } from "@/lib/tz-await";

export async function loadSalesBlock(orgId: string, c4: Commission4Mode, year: YearFilter, furNames: string[] = []): Promise<SalesBlock> {
  const data = await loadSalesInput(orgId, c4);
  // «Ждём» и заказ — по нашим ТЗ (объём ТЗ − получено), а не по заказу из отчёта: заказ в продажах равен «В выпуске» в производстве.
  return buildSalesBlock(data.input, year, await tzAwaitSizes(orgId, c4), furNames);
}

