import "server-only";
// Данные блока «Продажи и остатки» на Главной. Расчёт — те же функции, что в разделе /sales (sales-server.ts, margin-tree.ts, sales-section.ts):
// фильтр периода applyFilters, остаток на начало openingStock, показатели extOf, ряды bucketsOf и дерево buildSalesTree. Своих формул штук и выручки здесь нет;
// новые только суммы «по себестоимости» и «по прайсу» (приход и остаток), с охватом в штуках — где цены или себестоимости нет, строка не считается и охват это показывает.
import { exVatAt, type MarginInput } from "@/lib/margin";
import { makeCtx, type Ctx, type ReportSizeRow, type VatMode } from "@/lib/margin-tree";
import { furTypeOfFabric, seasonEndIso } from "@/lib/sales-receipts-core";
import { todayMsk, type Cat, type SDim } from "@/lib/sales-section";
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
  /** Маркап = цена ÷ себестоимость: продаж (выручка ÷ себестоимость проданного) и остатка (розница по прайсу ÷ себестоимость остатка); считаются по штукам, где есть и цена, и себестоимость. */
  markupSold: number | null; markupStock: number | null;
};
export type SalesSeason = { key: string; received: number; sold: number; gross: number; returns: number; stock: number; sellThrough: number | null; revenue: VatPair; avgPrice: { in: number | null; ex: number | null } };
export type SalesMonth = { key: string; label: string; received: number; sold: number; stock: number; /** Продано (нетто) за месяц по сезону товара: ключ — сезон, например «FW 25/26». */ soldBySeason: Record<string, number> };
/** Строка таблицы: штуки не зависят от НДС, выручка и цена — по режимам. */
export type SalesRow = {
  id: string; label: string; sub?: string; depth: number; received: number; sold: number; stock: number; sellThrough: number | null;
  revenue: VatPair; avgPrice: { in: number | null; ex: number | null }; /** Остаток в розничных ценах прайса 19.10 (строки без цены в сумму не входят). */ stockList: VatPair; /** Штуки остатка, покрытые розничной ценой (для средневзвешенной цены остатка). */ stockListPcs: number; /** Полученное в деньгах: себестоимость ТЗ (что мы заплатили за полученные штуки; штуки без себестоимости в сумму не входят). */ recvCost: VatPair; /** Штуки прихода, у которых есть себестоимость (для средневзвешенной цены прихода). */ recvCostPcs: number; /** Маркап продаж и остатка (×), по режимам НДС. */ markupSold: { in: number | null; ex: number | null }; markupStock: { in: number | null; ex: number | null }; /** Весь остаток на сегодня по всем сезонам (в срезе «все сезоны» равен stock); у сезона доля = stock ÷ stockCum. */ stockCum: number; /** Весь остаток в розничных ценах и штуки, покрытые ценой (для средневзвешенной цены всего остатка). */ stockListCum: VatPair; stockListPcsCum: number; markupStockCum: { in: number | null; ex: number | null }; /** SO AS: проданное до конца сезона ÷ получено (только у закончившихся сезонов). SO STD — sellThrough на сегодня. */ soAs: number | null; children: SalesRow[];
};
export type SalesCls = "all" | "clothes" | "acc";
export const SALES_CLS: SalesCls[] = ["all", "clothes", "acc"];
export type SalesHead = { /** SO AS: проданное до конца сезона ÷ получено; null, если сезон идёт. */ soAs: number | null; /** Весь остаток на сегодня по всем сезонам (в срезе «все сезоны» равен stock). */ stockCum: number; stockListCum: VatPair; markupStockCum: { in: number | null; ex: number | null }; received: number; sold: number; gross: number; returns: number; opening: number; stock: number; sellThrough: number | null; orders: number; articles: number; money: { in: SalesMoney; ex: SalesMoney } };
/** Заказ и приход. «Пришло» по сезонам — те же числа, что в плитке «Получено» (приход по датам). По закончившимся сезонам больше ничего не ждём: заказано = пришло; по сезону отчёта FW 26/27 заказано = пришло + ждём, где ждём = Conf − поступило из отчёта по товарам. Деньги — по прайсу 19.10 (в режиме НДС). */
export type OrderMoney = { in: number; ex: number };
export type OrderLine = { key: string; label: string; ordered: number; delivered: number; awaiting: number; orderedRub: OrderMoney; deliveredRub: OrderMoney; awaitingRub: OrderMoney };
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
export type SalesBlock = {
  year: YearFilter; periodNote: string;
  orders: number; articles: number;
  received: number; sold: number; gross: number; returns: number; opening: number; stock: number; sellThrough: number | null; firstReceipt: string | null; lastSale: string | null;
  money: { in: SalesMoney; ex: SalesMoney };
  seasons: SalesSeason[]; months: SalesMonth[]; rows: SalesRow[]; total: SalesRow;
  /** Срезы по сезонам: ключ «all» или сезон (FW25/26 …). */
  slices: Record<string, SalesSlice>;
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
function stockMoney(ctx: Ctx, lines: SLine[], scope: SLine[]): Pick<SalesMoney, "recvCost" | "recvCostPcs" | "recvList" | "recvListPcs" | "stockCost" | "stockCostPcs" | "stockList" | "stockListPcs" | "markupSold" | "markupStock"> {
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
  let sRev = 0, sCost = 0;
  for (const l of lines) {
    if (l.kind !== "SALE" || l.pcs === 0 || !ctx.hasCost(l)) continue;
    sRev += inc ? l.retailRub : l.retailRubExVat; sCost += cost(l) * l.pcs;
  }
  return { recvCost, recvCostPcs, recvList, recvListPcs, stockCost, stockCostPcs, stockList, stockListPcs, markupSold: sCost > 0 ? sRev / sCost : null, markupStock: bothCost > 0 ? bothList / bothCost : null };
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
      id: z.id, label: z.label, depth: depth + 1, received: m.received, sold: m.sold, stock: m.stock, sellThrough: m.sellThrough,
      revenue: { in: m.revenueIncl, ex: m.revenueEx }, avgPrice: { in: nul(m.avgPrice), ex: nul(m.sold > 0 ? m.revenueEx / m.sold : null) },
      stockList: { in: 0, ex: 0 }, stockListPcs: 0, recvCost: { in: 0, ex: 0 }, recvCostPcs: 0, markupSold: { in: null, ex: null }, markupStock: { in: null, ex: null }, stockCum: m.stock, stockListCum: { in: 0, ex: 0 }, stockListPcsCum: 0, markupStockCum: { in: null, ex: null }, soAs: null, children: [],
    };
  });
}

const inPeriod2 = (l: SLine, e: RowEnv) => e.inPeriod(l);
type CumNode = { stock: number; list: VatPair; listPcs: number; markup: { in: number | null; ex: number | null } };
type RowEnv = { seasonEnd: string | null; cum: Map<string, CumNode> | null; ctxs: { in: Ctx; ex: Ctx }; inPeriod: (l: SLine) => boolean; /** Размеры из Report (справочно, без привязки к датам и сезонам): только в срезе «все сезоны». */ sizes: ReportSizeRow[]; cat: Cat };
function rowOf(n: SNode, depth: number, tIn: SNode, tEx: SNode, e: RowEnv): SalesRow {
  // cols[0] — всё до конца периода (остаток), cols[1] — движения внутри периода.
  const inP = n.cols[1], inE = tEx.cols[1], inI = tIn.cols[1];
  const label = n.dim === "fur" ? furRu(n.label) : n.label;
  const inPer = n.lines.filter(e.inPeriod);
  return {
    id: n.id, label, depth,
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
  const rowEnvOf = (season: string, cat: Cat, cum: Map<string, CumNode> | null): RowEnv => ({ seasonEnd: finishedEnd(season), cum, ctxs, inPeriod, sizes: season === "all" ? sizes : [], cat });

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
    const rowEnv = rowEnvOf(f.seasons[0] ?? "all", f.cat, cum);
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
  /** Цена прайса 19.10 на строку отчёта (артикул × цвет) в режимах НДС; НДС для «без НДС» — по сегодняшней дате. */
  const today = todayMsk();
  const orderUnit = (r: ReportSizeRow): OrderMoney | null => { const p = ctxs.in.unitPrice({ article: r.acode, colorId: r.color, modelCode: r.modelCode } as SLine); return p === null ? null : { in: p, ex: exVatAt(p, today) }; };
  return {
    year, periodNote: year === "all" ? "все годы" : `${year} год`,
    orders: h.orders, articles: h.articles,
    received: h.received, sold: h.sold, gross: h.gross, returns: h.returns, opening: h.opening, stock: h.stock, sellThrough: h.sellThrough, firstReceipt: hIn.firstReceipt, lastSale: hIn.lastSale,
    money: h.money, seasons, months: all0.months.all, rows: all0.views.all.fur.rows, total: all0.views.all.fur.total, slices,
    orderSummary: Object.fromEntries(SALES_CLS.map((c) => [c, ordersSummary(sizes, c, seasonKeys.map((k) => { const m = slices[k].head[c].money; return { season: k, received: slices[k].head[c].received, recvList: { in: m.in.recvList, ex: m.ex.recvList } }; }), orderUnit, { in: slices.all.head[c].money.in.recvList, ex: slices.all.head[c].money.ex.recvList })])) as Record<SalesCls, OrdersSummary | null>,
    href: { in: salesHref(year, "in"), ex: salesHref(year, "ex") },
    hasData: all.length > 0,
  };
}

export async function loadSalesBlock(orgId: string, c4: Commission4Mode, year: YearFilter, furNames: string[] = []): Promise<SalesBlock> {
  const data = await loadSalesInput(orgId, c4);
  return buildSalesBlock(data.input, year, data.sizes, furNames);
}

