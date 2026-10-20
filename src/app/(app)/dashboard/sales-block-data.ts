import "server-only";
// Данные блока «Продажи и остатки» на Главной. Расчёт — те же функции, что в разделе /sales (sales-server.ts, margin-tree.ts, sales-section.ts):
// фильтр периода applyFilters, остаток на начало openingStock, показатели extOf, ряды bucketsOf и дерево buildSalesTree. Своих формул штук и выручки здесь нет;
// новые только суммы «по себестоимости» и «по прайсу» (приход и остаток), с охватом в штуках — где цены или себестоимости нет, строка не считается и охват это показывает.
import { exVatAt, type MarginInput } from "@/lib/margin";
import { makeCtx, type Ctx, type VatMode } from "@/lib/margin-tree";
import { applyFilters, bucketsOf, buildSalesTree, extOf, lastMonthOf, NO_FILTERS, openingStock, totalSalesNode, type Ext, type Filters, type SLine, type SNode } from "@/lib/sales-section";
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
};
export type SalesSeason = { key: string; received: number; sold: number; gross: number; returns: number; stock: number; sellThrough: number | null; revenue: VatPair; avgPrice: { in: number | null; ex: number | null } };
export type SalesMonth = { key: string; label: string; received: number; sold: number; stock: number };
/** Строка таблицы: штуки не зависят от НДС, выручка и цена — по режимам. */
export type SalesRow = {
  id: string; label: string; sub?: string; depth: 0 | 1 | 2; received: number; sold: number; stock: number; sellThrough: number | null;
  revenue: VatPair; avgPrice: { in: number | null; ex: number | null }; children: SalesRow[];
};
export type SalesBlock = {
  year: YearFilter; periodNote: string;
  orders: number; articles: number;
  received: number; sold: number; gross: number; returns: number; opening: number; stock: number; sellThrough: number | null; firstReceipt: string | null; lastSale: string | null;
  money: { in: SalesMoney; ex: SalesMoney };
  seasons: SalesSeason[]; months: SalesMonth[]; rows: SalesRow[]; total: SalesRow;
  /** Адрес страницы «Продажи и остатки» с тем же периодом (год) и режимом НДС. */
  href: { in: string; ex: string };
  hasData: boolean;
};

/** Русские названия типов меха (в выгрузке — английские). Неизвестный тип остаётся как в выгрузке. */
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", SWAKARA: "Свакара", KARAKULCHA: "Каракульча", FOX: "Лиса", "SILVER FOX": "Чернобурка", "ARCTIC FOX": "Песец", BROADTAIL: "Каракуль-бродтейл", LYNX: "Рысь", BEAVER: "Бобр", "Не указан": "Тип меха не указан" };
export const furRu = (k: string) => FUR_RU[k.toUpperCase()] ?? k;

/** Суммы «по себестоимости» и «по прайсу» для прихода и остатка набора строк (до конца периода). Остаток по артикулу и цвету = приход − продано. */
function stockMoney(ctx: Ctx, lines: SLine[], scope: SLine[]): Pick<SalesMoney, "recvCost" | "recvCostPcs" | "recvList" | "recvListPcs" | "stockCost" | "stockCostPcs" | "stockList" | "stockListPcs"> {
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
  let stockCost = 0, stockCostPcs = 0, stockList = 0, stockListPcs = 0;
  for (const g of by.values()) {
    if (g.net === 0) continue;
    if (ctx.hasCost(g.last)) { stockCost += cost(g.last) * g.net; stockCostPcs += g.net; }
    const p = ctx.unitPrice(g.last);
    if (p !== null) { stockList += price(g.last, p) * g.net; stockListPcs += g.net; }
  }
  return { recvCost, recvCostPcs, recvList, recvListPcs, stockCost, stockCostPcs, stockList, stockListPcs };
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

function rowOf(n: SNode, depth: 0 | 1 | 2, tIn: SNode, tEx: SNode): SalesRow {
  // cols[0] — всё до конца периода (остаток), cols[1] — движения внутри периода.
  const inP = n.cols[1], inE = tEx.cols[1], inI = tIn.cols[1];
  const label = n.dim === "fur" ? furRu(n.label) : n.label;
  return {
    id: n.id, label, sub: n.dim === "fur" && furRu(n.label) !== n.label ? n.label : undefined, depth,
    received: inP.received, sold: inP.sold, stock: n.cols[0].stock, sellThrough: inP.sellThrough,
    revenue: { in: inI.revenue, ex: inE.revenue }, avgPrice: { in: nul(inI.avgPrice), ex: nul(inE.avgPrice) },
    children: depth === 2 ? [] : n.children.map((c, i) => rowOf(c, (depth + 1) as 1 | 2, tIn.children[i], tEx.children[i])),
  };
}

/** Чистая сборка блока из загруженных данных (для тестов: те же числа, что и в загрузчике). */
export function buildSalesBlock(input: MarginInput, year: YearFilter): SalesBlock {
  const all = input.lines as SLine[];
  const f = salesFilters(year);
  const env = { lastMonth: lastMonthOf(all) };
  const ctxs = { in: makeCtx(input, "in"), ex: makeCtx(input, "ex") };
  const lines = applyFilters(all, f);
  const opening = openingStock(all, f);
  const headIn = extOf(ctxs.in, lines, env), headEx = extOf(ctxs.ex, lines, env);
  const stock = opening + headIn.received - headIn.sold;
  // До конца периода (для остатка по узлам) и внутри периода (движения).
  const scope = f.to ? all.filter((l) => l.iso <= f.to!) : all;
  const inPeriod = (l: SLine) => (!f.from || l.iso >= f.from) && (!f.to || l.iso <= f.to);
  const order = ["fur", "cls", "c2"] as const;
  const trees = (v: "in" | "ex") => { const kids = buildSalesTree(ctxs[v], env, scope, order, [inPeriod]); return { kids, total: totalSalesNode(ctxs[v], env, scope, [inPeriod], kids) }; };
  const tIn = trees("in"), tEx = trees("ex");
  const rows = tIn.kids.map((n, i) => rowOf(n, 0, n, tEx.kids[i])).filter((r) => r.received !== 0 || r.sold !== 0 || r.stock !== 0);
  const total = rowOf(tIn.total, 0, tIn.total, tEx.total);
  const season = (v: "in" | "ex") => bucketsOf(ctxs[v], env, lines, "season", 0);
  const sIn = season("in"), sEx = season("ex");
  let run = opening;
  const seasons: SalesSeason[] = sIn.map((b, i) => {
    run += b.m.received - b.m.sold;
    return { key: b.key, received: b.m.received, sold: b.m.sold, gross: b.m.gross, returns: b.m.returns, stock: run, sellThrough: b.m.sellThrough, revenue: { in: b.m.revenue, ex: sEx[i].m.revenue }, avgPrice: { in: nul(b.m.avgPrice), ex: nul(sEx[i].m.avgPrice) } };
  });
  const months: SalesMonth[] = bucketsOf(ctxs.in, env, lines, "month", opening).map((b) => ({ key: b.key, label: b.label, received: b.m.received, sold: b.m.sold, stock: b.stock }));
  return {
    year, periodNote: year === "all" ? "все годы" : `${year} год`,
    orders: new Set(lines.map((l) => l.orderNo)).size, articles: new Set(lines.map((l) => l.article)).size,
    received: headIn.received, sold: headIn.sold, gross: headIn.gross, returns: headIn.returns, opening, stock, sellThrough: headIn.sellThrough,
    firstReceipt: headIn.firstReceipt, lastSale: headIn.lastSale,
    money: { in: moneyOf(ctxs.in, headIn, lines, scope), ex: moneyOf(ctxs.ex, headEx, lines, scope) },
    seasons, months, rows, total,
    href: { in: salesHref(year, "in"), ex: salesHref(year, "ex") },
    hasData: all.length > 0,
  };
}

export async function loadSalesBlock(orgId: string, c4: Commission4Mode, year: YearFilter): Promise<SalesBlock> {
  const data = await loadSalesInput(orgId, c4);
  return buildSalesBlock(data.input, year);
}

