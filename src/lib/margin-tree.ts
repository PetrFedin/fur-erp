// Разрезы маржи: показатели узла (набор строк) и дерево «категория → тип меха → артикул → цвет», размеры из отчёта о товарах.
// Чистые функции без БД. Узел = набор строк выгрузки; суммы штук и выручки узла равны сумме детей (проверяется тестом), отношения считаются заново по узлу.
import { exVatAt, priceIndex, vatPctAt, type FullLine, type MarginInput, type RetailRow } from "@/lib/margin";
import { CAT_LABEL, type CatClass, colorOfLine, furTypeOfFabric, variantOfArticle } from "@/lib/sales-receipts-core";

export type Metrics = {
  sold: number; received: number; revenueIncl: number; revenueEx: number;
  avgPrice: number | null; discountVsRetail: number | null; grossProfit: number | null; grossMarginPct: number | null; gpOfRetail: number | null;
  markupW: number | null; sellThrough: number | null;
  /** Скидка при продаже (Discount файла): Discount RUR ÷ (Retail RUR + Discount RUR) по строкам продаж. */
  discountGiven: number | null;
  /** Sales cost: себестоимость проданных единиц без НДС (ТЗ с работой × шт.) по строкам со штуками и себестоимостью; Discount файла, ₽ с НДС. */
  salesCost: number | null; discountSum: number;
  /** Режим «С НДС / Без НДС»: выручка и скидка в евро из выгрузки (Sales Retail EUR, Discount EUR) и средняя цена в евро. */
  revenueEur: number; discountEurSum: number; avgPriceEur: number | null;
  /** Выручка выбранного режима НДС, ₽. */
  revenue: number;
} & Partial<PriceMetrics>;

/**
 * Цены узла (решение владельца 2026-10-20): ГЛАВНАЯ розница — цена артикула/модели (ProductModel.sellingPrice, «карточка»); прайс-лист — справочная цена (кнопка «Взять из прайса» — в интерфейсе).
 * Все цены — в режиме НДС узла (с НДС или без НДС по ставке даты строки), средневзвешенные ПО ШТУКАМ: по проданным (pcs > 0), а если продаж нет — по полученным.
 * Суммы-основы (…Val, …Pcs) аддитивны: у узла они равны сумме детей (проверяется тестом), цены и проценты — отношения этих сумм.
 */
export type PriceMetrics = {
  /** «Цена по карточке (главная)». */
  cardPrice: number | null; cardVal: number; cardPcs: number; cardRecPrcVal: number; cardRecPrcPcs: number;
  /** «Цена прайса» (справочная). */
  listPrice: number | null; listVal: number; listPcs: number; listRecVal: number; listRecPcs: number;
  /** «Фактическая цена продажи»: выручка ÷ проданные штуки (нетто возвратов), с НДС и без НДС. */
  actualPriceIncl: number | null; actualPriceEx: number | null;
  /** «К карточке %» / «К прайсу %»: фактическая выручка ÷ (цена × штуки) по проданным строкам, у которых есть эта цена; …Rev — числитель, …Basis — знаменатель. */
  toCardPct: number | null; toCardRev: number; toCardBasis: number;
  toListPct: number | null; toListRev: number; toListBasis: number;
  /** Без продаж: маркап и маржа от цены КАРТОЧКИ по полученным строкам с себестоимостью (цена ÷ себестоимость; (цена без НДС − себестоимость без НДС) ÷ цена без НДС). */
  cardMarkup: number | null; cardMarginPct: number | null; cardCostIncl: number; cardCostEx: number; cardRecVal: number; cardRecValEx: number;
};
export const METRIC_KEYS = ["revenueEx", "sold", "sellThrough", "avgPrice", "discountVsRetail", "grossProfit", "grossMarginPct", "gpOfRetail", "markupW"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export type VatMode = "ex" | "in";
export type Ctx = { vat: VatMode; /** Цена по карточке (ProductModel.sellingPrice, с НДС) по коду модели строки. */ cardPrice?: (l: FullLine) => number | null; unitPrice: (l: FullLine) => number | null; hasCost: (l: FullLine) => boolean; unitExcl: (l: FullLine) => number; unitIncl: (l: FullLine) => number };

export function makeCtx(inp: MarginInput, vat: VatMode = "ex"): Ctx {
  const pidx = priceIndex(inp.prices);
  const byMc = new Map<string, Set<number>>();
  for (const r of inp.prices) { const k = r.modelCode + "|" + r.color; (byMc.get(k) ?? byMc.set(k, new Set()).get(k)!).add(r.price); }
  return {
    vat,
    cardPrice: (l) => (l.modelCode ? inp.modelPrice.get(l.modelCode) ?? null : null),
    unitPrice: (l) => {
      const exact = pidx.get(l.article + "|" + (l.colorId ?? ""));
      if (exact !== undefined) return exact;
      const s = l.modelCode ? byMc.get(l.modelCode + "|" + (l.colorId ?? "")) : undefined;
      return s && s.size === 1 ? [...s][0] : null;
    },
    hasCost: (l) => !!l.modelCode && (inp.costs.get(l.modelCode)?.qty ?? 0) > 0,
    unitExcl: (l) => inp.costs.get(l.modelCode!)!.unitExcl,
    unitIncl: (l) => inp.costs.get(l.modelCode!)!.unitIncl,
  };
}

/** Цены узла (см. PriceMetrics). Чистая функция: тесты пересчитывают независимо. */
export function priceMetricsOf(ctx: Ctx, lines: FullLine[]): PriceMetrics {
  const inc = ctx.vat === "in";
  const pv = (l: FullLine, price: number) => (inc ? price : exVatAt(price, l.iso));
  const revOf = (l: FullLine) => (inc ? l.retailRub : l.retailRubExVat);
  const sold = lines.filter((l) => l.kind === "SALE" && l.pcs > 0), rec = lines.filter((l) => l.kind === "RECEIPT" && l.pcs > 0);
  const card = (l: FullLine) => ctx.cardPrice?.(l) ?? null;
  const agg = (price: (l: FullLine) => number | null) => {
    const ls = sold.filter((l) => price(l) !== null), lr = rec.filter((l) => price(l) !== null);
    const sv = sum(ls.map((l) => pv(l, price(l)!) * l.pcs)), sp = sum(ls.map((l) => l.pcs));
    const rv = sum(lr.map((l) => pv(l, price(l)!) * l.pcs)), rp = sum(lr.map((l) => l.pcs));
    // суммы-основы аддитивны: по проданным (val/pcs) и по полученным (rv/rp) отдельно; цена = по проданным, нет продаж — по полученным
    return { val: sv, pcs: sp, rv, rp, rev: sum(ls.map(revOf)), basis: sv, price: sp > 0 ? sv / sp : rp > 0 ? rv / rp : null };
  };
  const c = agg(card), p = agg(ctx.unitPrice);
  const soldNet = sum(lines.filter((l) => l.kind === "SALE").map((l) => l.pcs));
  const rIncl = sum(lines.filter((l) => l.kind === "SALE").map((l) => l.retailRub)), rEx = sum(lines.filter((l) => l.kind === "SALE").map((l) => l.retailRubExVat));
  const rc = rec.filter((l) => card(l) !== null && ctx.hasCost(l));
  const cardRecVal = sum(rc.map((l) => card(l)! * l.pcs)), cardRecValEx = sum(rc.map((l) => exVatAt(card(l)!, l.iso) * l.pcs));
  const cardCostIncl = sum(rc.map((l) => ctx.unitIncl(l) * l.pcs)), cardCostEx = sum(rc.map((l) => ctx.unitExcl(l) * l.pcs));
  return {
    cardPrice: c.price, cardVal: c.val, cardPcs: c.pcs, cardRecPrcVal: c.rv, cardRecPrcPcs: c.rp,
    listPrice: p.price, listVal: p.val, listPcs: p.pcs, listRecVal: p.rv, listRecPcs: p.rp,
    actualPriceIncl: soldNet > 0 ? rIncl / soldNet : null, actualPriceEx: soldNet > 0 ? rEx / soldNet : null,
    toCardRev: c.rev, toCardBasis: c.basis, toCardPct: c.basis > 0 ? (c.rev / c.basis) * 100 : null,
    toListRev: p.rev, toListBasis: p.basis, toListPct: p.basis > 0 ? (p.rev / p.basis) * 100 : null,
    cardMarkup: cardCostIncl > 0 ? cardRecVal / cardCostIncl : null, cardMarginPct: cardRecValEx > 0 ? ((cardRecValEx - cardCostEx) / cardRecValEx) * 100 : null,
    cardCostIncl, cardCostEx, cardRecVal, cardRecValEx,
  };
}

/** Показатели набора строк: те же формулы, что в таблице по сезонам (см. подсказки «i»). */
export function metricsOf(ctx: Ctx, lines: FullLine[]): Metrics {
  const inc = ctx.vat === "in";
  const s = lines.filter((l) => l.kind === "SALE"), r = lines.filter((l) => l.kind === "RECEIPT");
  const sold = sum(s.map((l) => l.pcs)), received = sum(r.map((l) => l.pcs));
  const revenueIncl = sum(s.map((l) => l.retailRub)), revenueEx = sum(s.map((l) => l.retailRubExVat));
  const revOf = (l: FullLine) => (inc ? l.retailRub : l.retailRubExVat);
  const costOf = (l: FullLine) => (inc ? ctx.unitIncl(l) : ctx.unitExcl(l)) * l.pcs;
  const revenue = inc ? revenueIncl : revenueEx;
  const withP = s.filter((l) => ctx.unitPrice(l) !== null && l.pcs !== 0);
  const retailVal = sum(withP.map((l) => ctx.unitPrice(l)! * l.pcs));
  const both = s.filter((l) => ctx.hasCost(l) && l.pcs !== 0);
  const gp = both.length ? sum(both.map((l) => revOf(l) - costOf(l))) : null;
  const bothP = both.filter((l) => ctx.unitPrice(l) !== null);
  const rP = r.filter((l) => ctx.unitPrice(l) !== null && ctx.hasCost(l) && l.pcs > 0);
  const costW = sum(rP.map((l) => ctx.unitIncl(l) * l.pcs));
  const bothRev = sum(both.map(revOf));
  const discRub = sum(s.map((l) => (inc ? l.discountRub : l.discountRubExVat)));
  const retRub = sum(s.map((l) => (inc ? l.retailRub : l.retailRubExVat)));
  const revenueEur = sum(s.map((l) => (inc ? l.retailEur : l.retailEurExVat)));
  const retailValBasis = (l: FullLine) => ctx.unitPrice(l)! * l.pcs / (inc ? 1 : 1 + vatPctAt(l.iso) / 100);
  return {
    sold, received, revenueIncl, revenueEx, revenue, avgPrice: sold > 0 ? revenue / sold : null,
    discountVsRetail: retailVal > 0 ? 1 - sum(withP.map((l) => l.retailRub)) / retailVal : null,
    grossProfit: gp, grossMarginPct: gp !== null && bothRev > 0 ? (gp / bothRev) * 100 : null,
    gpOfRetail: bothP.length ? sum(bothP.map((l) => revOf(l) - costOf(l))) / sum(bothP.map(retailValBasis)) : null,
    markupW: costW > 0 ? sum(rP.map((l) => ctx.unitPrice(l)! * l.pcs)) / costW : null,
    sellThrough: received > 0 ? sold / received : null,
    salesCost: both.length ? sum(both.map(costOf)) : null,
    discountSum: discRub,
    discountGiven: retRub + discRub > 0 ? discRub / (retRub + discRub) : null,
    revenueEur, discountEurSum: sum(s.map((l) => (inc ? l.discountEur : l.discountEurExVat))),
    avgPriceEur: sold > 0 ? revenueEur / sold : null,
    ...priceMetricsOf(ctx, lines),
  };
}

export type Dim = "cls" | "c2" | "fur" | "article" | "color" | "size";
/** Порядок уровней для разреза: «Категории» → вся цепочка, «Тип меха» — с типа меха и т.д. */
export const CUT_ORDER = { cls: ["cls", "fur", "article", "color"], fur: ["fur", "article", "color"], article: ["article", "color"], color: ["color", "article"] } as const satisfies Record<string, readonly Dim[]>;
export type Cut = keyof typeof CUT_ORDER;

export type TreeNode = {
  id: string; dim: Dim; label: string;
  /** Для «Фото»: нормализованный код модели и вариант артикула (ткань). */
  modelCode: string | null; variant: string | null;
  /** Показатели: [Тотал, ...сезоны] в порядке `seasons`. */
  cols: Metrics[];
  children: TreeNode[];
};

const keyOf = (l: FullLine, d: Dim): { key: string; label: string } => {
  if (d === "cls") return { key: l.cls, label: CAT_LABEL[l.cls] };
  if (d === "c2") { const c = (l.level4 ?? l.level3 ?? "Без категории").trim(); return { key: c, label: c }; }
  if (d === "fur") { const f = furTypeOfFabric(l.fabric); return { key: f, label: f }; }
  if (d === "article") return { key: l.article, label: l.article };
  const c = colorOfLine(l.colorId); return { key: c, label: c };
};

export function seasonsOf(lines: FullLine[]): string[] {
  const rank = (s: string) => { const m = /(\d{2,4})/.exec(s); const y = m ? (Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1])) : 0; return y + (/^SS/i.test(s) ? 0.2 : 0.7); };
  return [...new Set(lines.map((l) => l.season))].sort((a, b) => rank(a) - rank(b));
}

export type ColPred = (l: FullLine) => boolean;

/** Дерево по произвольным столбцам-группам (сезоны, месяцы): cols[0] — Тотал, далее по одному на предикат. */
export function buildTreeBy(ctx: Ctx, lines: FullLine[], order: readonly Dim[], preds: ColPred[], path = "", inh: { modelCode: string | null; variant: string | null } = { modelCode: null, variant: null }): TreeNode[] {
  if (!order.length) return [];
  const [d, ...rest] = order;
  const groups = new Map<string, { label: string; lines: FullLine[] }>();
  for (const l of lines) { const k = keyOf(l, d); (groups.get(k.key) ?? groups.set(k.key, { label: k.label, lines: [] }).get(k.key)!).lines.push(l); }
  const nodes: TreeNode[] = [...groups].map(([key, g]) => {
    const first = g.lines[0];
    const id = path + "/" + d + ":" + key;
    const next = { modelCode: d === "article" ? first.modelCode : inh.modelCode, variant: d === "article" ? variantOfArticle(first.article) : inh.variant };
    return { id, dim: d, label: g.label, modelCode: next.modelCode, variant: next.variant, cols: [metricsOf(ctx, g.lines), ...preds.map((p) => metricsOf(ctx, g.lines.filter(p)))], children: buildTreeBy(ctx, g.lines, rest, preds, id, next) };
  });
  return nodes.sort((a, b) => b.cols[0].revenueEx - a.cols[0].revenueEx || b.cols[0].received - a.cols[0].received || a.label.localeCompare(b.label));
}

export function buildTree(ctx: Ctx, lines: FullLine[], order: readonly Dim[], seasons: string[]): TreeNode[] {
  return buildTreeBy(ctx, lines, order, seasons.map((sn) => (l: FullLine) => l.season === sn));
}

/** Строка «Всего»: те же показатели по всем строкам. */
export function totalNode(ctx: Ctx, lines: FullLine[], preds: ColPred[], children: TreeNode[]): TreeNode {
  return { id: "total", dim: "cls", label: "Всего", modelCode: null, variant: null, cols: [metricsOf(ctx, lines), ...preds.map((p) => metricsOf(ctx, lines.filter(p)))], children };
}

/** Порядок иерархии таблицы: категория → тип меха → артикул → цвет. */
export const TREE_ORDER: readonly Dim[] = ["cls", "fur", "article", "color"];
/** Две структуры дерева: А — Категория 1 (Level 02) → Категория 2 (Level 04, иначе Level 03) → Тип меха → Артикул → Цвет; Б — Тип меха → Категория 1 → Категория 2 → Артикул → Цвет. */
export const TREE_ORDERS: Record<"a" | "b", readonly Dim[]> = { a: ["cls", "c2", "fur", "article", "color"], b: ["fur", "cls", "c2", "article", "color"] };
export const DIM_LABEL: Record<Dim, string> = { cls: "Категория 1", c2: "Категория 2", fur: "Тип меха", article: "Артикул", color: "Цвет", size: "Размер" };

/** Размеры из отчёта о товарах (лист Report, строки артикул × цвет × размер). Сезонов и дат в нём нет — только итоги на 19.10.2026. */
export type ReportSizeRow = { conf?: number; acode: string; color: string; size: string; modelCode: string | null; cls: CatClass; deliv: number; sold: number; stock: number; nsRub: number; nsRubEx: number };
/** Прежний зашитый ключ размеров (старый скрипт); код читает версию через src/lib/import-keys.ts (указатель sales-report-sizes:current). */
export const REPORT_SIZES_KEY = "sales-report-sizes:2026-10-19";
export type SizeAgg = { size: string; received: number; sold: number; stock: number; revenueEx: number; revenueIncl: number; sellThrough: number | null; avgPrice: number | null };

const SIZE_RANK = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 1e6; };
/** Размеры по значению размера; `keep` — например, фильтр категории (KTT Level 02 отчёта). */
export function sizeAgg(rows: ReportSizeRow[], keep: (r: ReportSizeRow) => boolean = () => true): SizeAgg[] {
  const by = new Map<string, ReportSizeRow[]>();
  for (const r of rows.filter(keep)) (by.get(r.size) ?? by.set(r.size, []).get(r.size)!).push(r);
  return [...by].map(([size, rs]) => {
    const received = sum(rs.map((r) => r.deliv)), sold = sum(rs.map((r) => r.sold));
    const revenueIncl = sum(rs.map((r) => r.nsRub));
    return { size, received, sold, stock: sum(rs.map((r) => r.stock)), revenueEx: sum(rs.map((r) => r.nsRubEx)), revenueIncl, sellThrough: received > 0 ? sold / received : null, avgPrice: sold > 0 ? revenueIncl / sold : null };
  }).sort((a, b) => SIZE_RANK(a.size) - SIZE_RANK(b.size) || a.size.localeCompare(b.size));
}

export type { RetailRow };

/** Розница по месяцам продаж внутри сезонов: итог сезона = сумма месяцев (штуки, выручка). Месяц — по дате строки выгрузки. */
export type MonthRow = { month: string; m: Metrics };
export type SeasonMonths = { season: string; total: Metrics; months: MonthRow[] };
export function monthlyBySeason(ctx: Ctx, lines: FullLine[], seasons: string[]): SeasonMonths[] {
  return seasons.map((season) => {
    const sl = lines.filter((l) => l.season === season);
    const months = [...new Set(sl.filter((l) => l.kind === "SALE").map((l) => l.iso.slice(0, 7)))].sort();
    return { season, total: metricsOf(ctx, sl.filter((l) => l.kind === "SALE")), months: months.map((month) => ({ month, m: metricsOf(ctx, sl.filter((l) => l.kind === "SALE" && l.iso.startsWith(month))) })) };
  });
}

/** Sell-through сезона = продано ÷ получено единиц по заказам этого сезона (без обрезки до 100%). Пометки: «over» — продано больше получено (продажи включают остатки других поступлений), «small» — получено меньше 10 шт. */
export function sellNote(m: { sold: number; received: number }): "over" | "small" | null {
  if (m.received <= 0) return null;
  if (m.sold > m.received) return "over";
  return m.received < 10 ? "small" : null;
}
