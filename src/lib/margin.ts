// Маркап и валовая прибыль по моделям и сезонам: розница (прайс) × себестоимость (ТЗ) × приход и продажи (выгрузка).
// Чистые функции без БД: данные собирает margin-server.ts. Всё считается из реальных данных; где не хватает себестоимости или цены — «нет данных» и охват.
import type { CatClass, SalesLineKindT } from "@/lib/sales-receipts-core";

/** Прежний зашитый ключ прайса (его пишет только старый скрипт apply-retail-prices-2026-10-19.ts). Код читает версию через src/lib/import-keys.ts (указатель retail-prices:current). Подрядчику не отдаётся. */
export const RETAIL_PRICES_KEY = "retail-prices:2026-10-19";
/** Ставка НДС розницы в текущем прайсе (с января 2026 — 22%). */
export const RETAIL_VAT_PCT = 22;

export type RetailRow = { acode: string; color: string; size: string; price: number; modelCode: string };
/** Себестоимость единицы модели из ТЗ («Себестоимость с работой»): с НДС и без НДС, и выпуск, шт. */
export type ModelCost = { name: string; unitIncl: number; unitExcl: number; qty: number };
export type FullLine = { kind: SalesLineKindT; iso: string; season: string; modelCode: string | null; article: string; colorId: string | null; fabric: string | null; level3: string | null; level4: string | null; pcs: number; retailRub: number; retailRubExVat: number; discountRub: number; discountRubExVat: number; retailEur: number; retailEurExVat: number; discountEur: number; discountEurExVat: number; cls: CatClass };

export type MarginInput = {
  lines: FullLine[];
  prices: RetailRow[];
  /** ProductModel.sellingPrice по коду модели (с НДС) — запасной источник, когда прайс по артикулу и цвету не найден. */
  modelPrice: Map<string, number>;
  /** Себестоимость по нормализованному коду модели. */
  costs: Map<string, ModelCost>;
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const exVatOf = (priceIncl: number) => priceIncl / (1 + RETAIL_VAT_PCT / 100);
/** Ставка НДС розницы на дату строки: 20% до конца 2025, 22% с 01.2026 (как в выгрузке продаж). */
export const vatPctAt = (iso: string) => (iso < "2026-01-01" ? 20 : 22);
/** Цена с НДС → без НДС по ставке на дату строки. */
export const exVatAt = (priceIncl: number, iso: string) => priceIncl / (1 + vatPctAt(iso) / 100);

/** Цена артикула+цвета из прайса: одна уникальная цена по всем размерам, иначе null (неоднозначно — не выдумываем). */
export function priceIndex(rows: RetailRow[]): Map<string, number> {
  const by = new Map<string, Set<number>>();
  for (const r of rows) { const k = r.acode + "|" + r.color; (by.get(k) ?? by.set(k, new Set()).get(k)!).add(r.price); }
  const out = new Map<string, number>();
  for (const [k, s] of by) if (s.size === 1) out.set(k, [...s][0]);
  return out;
}

export type ModelRow = {
  code: string; name: string;
  unitIncl: number | null; unitExcl: number | null;
  /** Текущая розница с НДС: средневзвешенная по приходу артикулов с ценой; нет прихода — цена модели. */
  price: number | null; priceKind: "прайс" | "цена модели" | "карточка" | null;
  /** «Цена по карточке (главная)» = ProductModel.sellingPrice и «Цена прайса» (средневзвешенная по приходу) — обе с НДС, для сравнения. Без продаж маркап и маржа считаются от карточки. */
  cardPrice: number | null; listPrice: number | null;
  markup: number | null; markupPct: number | null; grossPerUnit: number | null;
  received: number; sold: number;
};

export type SeasonRow = {
  season: string; sold: number; received: number; revenueIncl: number; revenueEx: number;
  avgPrice: number | null;
  /** Скидка от текущей розницы: 1 − выручка с НДС / (штуки × текущая цена) по строкам с ценой. */
  discountVsRetail: number | null;
  grossProfit: number | null; grossMarginPct: number | null;
  /** Валовая прибыль / розничная стоимость проданного (без НДС), по строкам с ценой и себестоимостью. */
  gpOfRetail: number | null;
  markupW: number | null;
  sellThrough: number | null;
  costCoverage: number | null; priceCoverage: number | null;
};

export type MarginData = {
  models: ModelRow[];
  avgMarkup: number | null; avgMarkupN: number;
  weightedByReceipts: number | null; weightedBySales: number | null;
  /** Охват: доля проданных единиц, у которых нашлась себестоимость, и цена. */
  costCoverage: number | null; priceCoverage: number | null;
  seasons: SeasonRow[];
  /** Маржа = ВП ÷ выручка строк со штуками и себестоимостью; excluded — выручка без НДС строк продаж без штук или без себестоимости (в ВП не входит); marginFullPct — ВП ÷ вся выручка. */
  totals: { sold: number; revenueEx: number; grossProfit: number | null; grossMarginPct: number | null; excludedRevenueEx: number; marginFullPct: number | null };
};

/** Хронологический порядок сезонов: «FW 25/26» — осень 2025, «SS 2026» — весна 2026. */
const SEASON_ORDER = (s: string) => {
  const m = /(\d{2,4})/.exec(s);
  if (!m) return 0;
  const y = Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1]);
  return y + (/^SS/i.test(s) ? 0.2 : 0.7);
};

export function buildMargin(inp0: MarginInput, cls: CatClass | "all" = "all"): MarginData {
  const inp = cls === "all" ? inp0 : { ...inp0, lines: inp0.lines.filter((l) => l.cls === cls) };
  const pidx = priceIndex(inp.prices);
  // Запасной ключ: код модели + цвет, если по всем артикулам этого цвета в прайсе одна и та же цена.
  const byMc = new Map<string, Set<number>>();
  for (const r of inp.prices) { const k = r.modelCode + "|" + r.color; (byMc.get(k) ?? byMc.set(k, new Set()).get(k)!).add(r.price); }
  const unitPrice = (l: FullLine) => {
    const exact = pidx.get(l.article + "|" + (l.colorId ?? ""));
    if (exact !== undefined) return exact;
    const s = l.modelCode ? byMc.get(l.modelCode + "|" + (l.colorId ?? "")) : undefined;
    return s && s.size === 1 ? [...s][0] : null;
  };
  const rec = inp.lines.filter((l) => l.kind === "RECEIPT"), sale = inp.lines.filter((l) => l.kind === "SALE");
  const lineCodes = inp.lines.map((l) => l.modelCode).filter(Boolean) as string[];
  // Для категории — только модели из её строк; для «Всё» — ещё модели с себестоимостью или ценой (без прихода).
  const codes = new Set<string>(cls === "all" ? [...inp.costs.keys(), ...lineCodes, ...inp.modelPrice.keys()] : lineCodes);

  const models: ModelRow[] = [];
  for (const code of codes) {
    const c = inp.costs.get(code);
    const r = rec.filter((l) => l.modelCode === code), s = sale.filter((l) => l.modelCode === code);
    const pr = r.map((l) => ({ p: unitPrice(l), w: l.pcs })).filter((x): x is { p: number; w: number } => x.p !== null && x.w > 0);
    let price: number | null = null, kind: ModelRow["priceKind"] = null;
    if (pr.length) { price = sum(pr.map((x) => x.p * x.w)) / sum(pr.map((x) => x.w)); kind = "прайс"; }
    else if (inp.modelPrice.has(code)) { price = inp.modelPrice.get(code)!; kind = "цена модели"; }
    const cardPrice = inp.modelPrice.get(code) ?? null, listPrice = pr.length ? sum(pr.map((x) => x.p * x.w)) / sum(pr.map((x) => x.w)) : null;
    // Главная цена — карточка: нет продаж у модели — маркап и маржа от цены карточки, а не прайса.
    if (cardPrice !== null && sum(s.map((l) => l.pcs)) <= 0) { price = cardPrice; kind = "карточка"; }
    const unitIncl = c && c.qty > 0 ? c.unitIncl : null, unitExcl = c && c.qty > 0 ? c.unitExcl : null;
    const markup = price !== null && unitIncl ? price / unitIncl : null;
    models.push({
      code, name: c?.name ?? code, unitIncl, unitExcl, price, priceKind: kind, cardPrice, listPrice, markup, markupPct: markup === null ? null : (markup - 1) * 100,
      grossPerUnit: price !== null && unitExcl !== null ? exVatOf(price) - unitExcl : null, received: sum(r.map((l) => l.pcs)), sold: sum(s.map((l) => l.pcs)),
    });
  }
  models.sort((a, b) => b.received - a.received || a.code.localeCompare(b.code));

  const ok = models.filter((m) => m.markup !== null);
  const avgMarkup = ok.length ? sum(ok.map((m) => m.markup!)) / ok.length : null;
  const wAvg = (w: (m: ModelRow) => number) => {
    const sel = ok.filter((m) => w(m) > 0);
    const cost = sum(sel.map((m) => m.unitIncl! * w(m)));
    return cost > 0 ? sum(sel.map((m) => m.price! * w(m))) / cost : null;
  };
  const soldUnits = sum(sale.map((l) => l.pcs));
  const covUnits = (pred: (l: FullLine) => boolean) => (soldUnits > 0 ? sum(sale.filter(pred).map((l) => l.pcs)) / soldUnits : null);
  const hasCost = (l: FullLine) => !!l.modelCode && (inp.costs.get(l.modelCode)?.qty ?? 0) > 0;

  const seasonNames = [...new Set(inp.lines.map((l) => l.season))].sort((a, b) => SEASON_ORDER(a) - SEASON_ORDER(b));
  const seasons: SeasonRow[] = seasonNames.map((season) => {
    const s = sale.filter((l) => l.season === season), r = rec.filter((l) => l.season === season);
    const sold = sum(s.map((l) => l.pcs)), received = sum(r.map((l) => l.pcs));
    const revenueIncl = sum(s.map((l) => l.retailRub)), revenueEx = sum(s.map((l) => l.retailRubExVat));
    const withP = s.filter((l) => unitPrice(l) !== null && l.pcs !== 0);
    const retailVal = sum(withP.map((l) => unitPrice(l)! * l.pcs));
    const both = s.filter((l) => hasCost(l) && l.pcs !== 0);
    const gp = both.length ? sum(both.map((l) => l.retailRubExVat - inp.costs.get(l.modelCode!)!.unitExcl * l.pcs)) : null;
    const bothP = both.filter((l) => unitPrice(l) !== null);
    const rWithP = r.filter((l) => unitPrice(l) !== null && hasCost(l) && l.pcs > 0);
    const costW = sum(rWithP.map((l) => inp.costs.get(l.modelCode!)!.unitIncl * l.pcs));
    return {
      season, sold, received, revenueIncl, revenueEx, avgPrice: sold > 0 ? revenueIncl / sold : null,
      discountVsRetail: retailVal > 0 ? 1 - sum(withP.map((l) => l.retailRub)) / retailVal : null,
      grossProfit: gp, grossMarginPct: gp !== null && sum(both.map((l) => l.retailRubExVat)) > 0 ? (gp / sum(both.map((l) => l.retailRubExVat))) * 100 : null,
      gpOfRetail: bothP.length ? sum(bothP.map((l) => l.retailRubExVat - inp.costs.get(l.modelCode!)!.unitExcl * l.pcs)) / sum(bothP.map((l) => exVatAt(unitPrice(l)!, l.iso) * l.pcs)) : null,
      markupW: costW > 0 ? sum(rWithP.map((l) => unitPrice(l)! * l.pcs)) / costW : null,
      sellThrough: received > 0 ? sold / received : null,
      costCoverage: sold > 0 ? sum(s.filter(hasCost).map((l) => l.pcs)) / sold : null,
      priceCoverage: sold > 0 ? sum(s.filter((l) => unitPrice(l) !== null).map((l) => l.pcs)) / sold : null,
    };
  });

  const bothAll = sale.filter((l) => hasCost(l) && l.pcs !== 0);
  const gpAll = bothAll.length ? sum(bothAll.map((l) => l.retailRubExVat - inp.costs.get(l.modelCode!)!.unitExcl * l.pcs)) : null;
  return {
    models, avgMarkup, avgMarkupN: ok.length,
    weightedByReceipts: wAvg((m) => m.received), weightedBySales: wAvg((m) => m.sold),
    costCoverage: covUnits(hasCost), priceCoverage: covUnits((l) => unitPrice(l) !== null),
    seasons,
    totals: { sold: soldUnits, revenueEx: sum(sale.map((l) => l.retailRubExVat)), grossProfit: gpAll, grossMarginPct: gpAll !== null && sum(bothAll.map((l) => l.retailRubExVat)) > 0 ? (gpAll / sum(bothAll.map((l) => l.retailRubExVat))) * 100 : null, excludedRevenueEx: sum(sale.map((l) => l.retailRubExVat)) - sum(bothAll.map((l) => l.retailRubExVat)), marginFullPct: gpAll !== null && sum(sale.map((l) => l.retailRubExVat)) > 0 ? (gpAll / sum(sale.map((l) => l.retailRubExVat))) * 100 : null },
  };
}

/** Вид для передачи в клиентский компонент (Map → массивы). */
export type MarginInputS = { lines: FullLine[]; prices: RetailRow[]; modelPrice: [string, number][]; costs: [string, ModelCost][] };
export const serializeInput = (i: MarginInput): MarginInputS => ({ lines: i.lines, prices: i.prices, modelPrice: [...i.modelPrice], costs: [...i.costs] });
export const deserializeInput = (s: MarginInputS): MarginInput => ({ lines: s.lines, prices: s.prices, modelPrice: new Map(s.modelPrice), costs: new Map(s.costs) });
