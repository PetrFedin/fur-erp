import "server-only";
import { prisma } from "@/lib/prisma";
import { loadReportSizesState } from "@/lib/import-keys";
import { loadBudgetStats } from "@/lib/budget-stats";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { DEFAULT_PARAMS, normKey, type BudgetStat } from "@/lib/budget-calc";
import type { ReportSizeRow } from "@/lib/margin-tree";

/** Прогноз сырья: сколько шкур уйдёт на остаток заказа FW26 (заказано − поступило по отчёту о товарах) и сколько останется по типам меха. */
export type ForecastArticle = { acode: string; label: string; left: number; hidesPer: number | null; hides: number; source: "ТЗ артикула" | "категория" | "нет данных" };
/** Строка таблицы «Артикулы в заказе»: примерный расход и стоимость на весь остаток заказа по ТЗ (₽ с НДС, 4% — на мех и подкладку). */
export type ForecastLine = { acode: string; cls: "clothes" | "acc"; cat2: string; fur: string; left: number; hides: number; fur$: number; meters: number; lining$: number; c4$: number; work$: number; total$: number; source: "ТЗ артикула" | "категория" };
export type ForecastFur = { fur: string; stock: number; need: number; rest: number; articles: ForecastArticle[] };
export type RawForecast = { lines: ForecastLine[]; furs: ForecastFur[]; leftPcs: number; noData: { acode: string; left: number; fur: string; cls: "clothes" | "acc"; cat2: string }[]; asOf: string | null };

const FUR_RE: [RegExp, string][] = [[/SABLE/, "Соболь"], [/MINK/, "Норка"], [/LYNX/, "Рысь"], [/FOX/, "Лиса"], [/KARAKUL|SWAKARA/, "Свакара"]];
const norm = (c: string) => c.replace(/[-\s]/g, "").toUpperCase();

export async function loadRawForecast(orgId: string): Promise<RawForecast> {
  const [sizes, stats, dash, models] = await Promise.all([
    loadReportSizesState(orgId), loadBudgetStats(orgId),
    loadDashboard(orgId, "all", parseDashFilters({}), "off"),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, sku: true, salesCode: true, category: true } }),
  ]);
  const rows = ((sizes?.value as { rows?: ReportSizeRow[] } | undefined)?.rows ?? []);
  const idOf = new Map<string, { id: string; cat: string | null }>();
  for (const m of models) for (const c of [m.salesCode, m.sku]) if (c) idOf.set(norm(c), { id: m.id, cat: m.category });
  // Остаток заказа по артикулам.
  const lvl = await prisma.salesReceiptLine.findMany({ select: { article: true, modelCode: true, level4: true } });
  const catByArt = new Map<string, string>(), catByModel = new Map<string, string>();
  for (const l of lvl) { if (!l.level4) continue; if (!catByArt.has(l.article)) catByArt.set(l.article, l.level4); if (l.modelCode && !catByModel.has(norm(l.modelCode))) catByModel.set(norm(l.modelCode), l.level4); }
  // Новые артикулы без строк прихода: категория 2 со слов владельца (22.10).
  const MANUAL: Record<string, string> = { M030: "Шубы", M039: "Шубы", M040: "Шубы", M054: "Шубы", M058: "Шубы", M059: "Шубы", MCF02: "Манжеты" };
  const clsOf = new Map(rows.map((r) => [r.acode, r.cls]));
  const left = new Map<string, { model: string; left: number; l3: string }>();
  // По артикулу: заказано − поступило с учётом излишков по другим размерам (как «ждём» на Главной).
  for (const r of rows) {
    const d = (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0);
    if (!d && !r.fw26Conf) continue;
    const e = left.get(r.acode) ?? { model: r.modelCode ?? r.acode.split("/")[0], left: 0, l3: r.l4 || r.l3 || "" };
    e.left += d; left.set(r.acode, e);
  }
  for (const [k, e] of left) if (e.left <= 0) left.delete(k);
  const byModel = new Map<string, BudgetStat[]>(), byCat = new Map<string, BudgetStat>();
  for (const s of stats) {
    if (s.len) continue;
    if (s.modelId) byModel.set(s.modelId, [...(byModel.get(s.modelId) ?? []), s]);
    else byCat.set(`${s.fur}|${normKey(s.cat)}`, s);
  }
  const stock = new Map<string, number>();
  for (const t of dash.rawFurBySource.all.types) stock.set(t.name, t.pair.incl.remQty);
  const furs = new Map<string, ForecastFur>();
  const get = (fur: string) => { let f = furs.get(fur); if (!f) { f = { fur, stock: stock.get(fur) ?? 0, need: 0, rest: 0, articles: [] }; furs.set(fur, f); } return f; };
  for (const name of stock.keys()) get(name);
  const noData: RawForecast["noData"] = [];
  const lines: ForecastLine[] = [];
  const line = (acode: string, s: BudgetStat, n: number, source: ForecastLine["source"], model: string) => {
    const cat2 = catByArt.get(acode) ?? catByModel.get(norm(model)) ?? MANUAL[norm(model)] ?? "(без категории)";
    const hides = s.hidesPer * n, fur$ = hides * s.hidePrice, meters = s.metersPer * n, lining$ = meters * s.meterPrice, work$ = s.workPer * n, c4$ = (fur$ + lining$) * DEFAULT_PARAMS.c4 / 100;
    lines.push({ acode, cls: clsOf.get(acode) === "acc" ? "acc" : "clothes", cat2, fur: s.fur, left: n, hides, fur$, meters, lining$, c4$, work$, total$: fur$ + lining$ + c4$ + work$, source });
  };
  let leftPcs = 0;
  for (const [acode, e] of left) {
    leftPcs += e.left;
    const mi = idOf.get(norm(e.model));
    const own = mi ? byModel.get(mi.id) : undefined;
    const code = acode.toUpperCase();
    const codeFurs = FUR_RE.filter(([re]) => re.test(code)).map(([, n]) => n);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    const mine = own?.filter((s) => !codeFurs.length || same(s.fur.split(" + "), codeFurs));
    if (mine?.length) {
      for (const s of mine) { const f = get(s.fur); const h = s.hidesPer * e.left; f.need += h; f.articles.push({ acode, label: acode, left: e.left, hidesPer: s.hidesPer, hides: h, source: "ТЗ артикула" }); line(acode, s, e.left, "ТЗ артикула", e.model); }
      continue;
    }
    let placed = false;
    for (const fur of codeFurs) {
      const s = byCat.get(`${fur}|${normKey(mi?.cat ?? e.l3)}`);
      if (!s || !(s.hidesPer > 0) || codeFurs.length > 1) continue;
      const f = get(fur); const h = s.hidesPer * e.left; f.need += h;
      f.articles.push({ acode, label: acode, left: e.left, hidesPer: s.hidesPer, hides: h, source: "категория" }); line(acode, s, e.left, "категория", e.model); placed = true;
    }
    if (!placed) noData.push({ acode, left: e.left, fur: codeFurs.join(" + ") || "—", cls: clsOf.get(acode) === "acc" ? "acc" : "clothes", cat2: catByArt.get(acode) ?? catByModel.get(norm(e.model)) ?? MANUAL[norm(e.model)] ?? "(без категории)" });
  }
  for (const f of furs.values()) { f.rest = f.stock - f.need; f.articles.sort((a, b) => b.hides - a.hides); }
  lines.sort((a, b) => a.cat2.localeCompare(b.cat2, "ru") || b.total$ - a.total$);
  return { lines, furs: [...furs.values()].sort((a, b) => b.stock - a.stock), leftPcs, noData, asOf: sizes?.key.slice(-10) ?? null };
}
