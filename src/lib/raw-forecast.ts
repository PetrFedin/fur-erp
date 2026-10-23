import "server-only";
import { prisma } from "@/lib/prisma";
import { loadReportSizesState } from "@/lib/import-keys";
import { loadBudgetStats } from "@/lib/budget-stats";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { normKey, type BudgetStat } from "@/lib/budget-calc";
import type { ReportSizeRow } from "@/lib/margin-tree";

/** Прогноз сырья: сколько шкур уйдёт на остаток заказа FW26 (заказано − поступило по отчёту о товарах) и сколько останется по типам меха. */
export type ForecastArticle = { acode: string; label: string; left: number; hidesPer: number | null; hides: number; source: "ТЗ артикула" | "категория" | "нет данных" };
export type ForecastFur = { fur: string; stock: number; need: number; rest: number; articles: ForecastArticle[] };
export type RawForecast = { furs: ForecastFur[]; leftPcs: number; noData: { acode: string; left: number; fur: string }[]; asOf: string | null };

const FUR_RE: [RegExp, string][] = [[/SABLE/, "Соболь"], [/MINK/, "Норка"], [/LYNX/, "Рысь"], [/FOX/, "Лиса"], [/KARAKUL|SWAKARA/, "Каракуль (свакара)"]];
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
  const left = new Map<string, { model: string; left: number; l3: string }>();
  for (const r of rows) {
    const d = (r.fw26Conf ?? 0) - (r.fw26Deliv ?? 0);
    if (d <= 0) continue;
    const e = left.get(r.acode) ?? { model: r.modelCode ?? r.acode.split("/")[0], left: 0, l3: r.l4 || r.l3 || "" };
    e.left += d; left.set(r.acode, e);
  }
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
  let leftPcs = 0;
  for (const [acode, e] of left) {
    leftPcs += e.left;
    const mi = idOf.get(norm(e.model));
    const own = mi ? byModel.get(mi.id) : undefined;
    const code = acode.toUpperCase();
    const codeFurs = FUR_RE.filter(([re]) => re.test(code)).map(([, n]) => n);
    if (own?.length) {
      for (const s of own) { const f = get(s.fur); const h = s.hidesPer * e.left; f.need += h; f.articles.push({ acode, label: acode, left: e.left, hidesPer: s.hidesPer, hides: h, source: "ТЗ артикула" }); }
      continue;
    }
    let placed = false;
    for (const fur of codeFurs) {
      const s = byCat.get(`${fur}|${normKey(mi?.cat ?? e.l3)}`);
      if (!s || !(s.hidesPer > 0) || codeFurs.length > 1) continue;
      const f = get(fur); const h = s.hidesPer * e.left; f.need += h;
      f.articles.push({ acode, label: acode, left: e.left, hidesPer: s.hidesPer, hides: h, source: "категория" }); placed = true;
    }
    if (!placed) noData.push({ acode, left: e.left, fur: codeFurs.join(" + ") || "—" });
  }
  for (const f of furs.values()) { f.rest = f.stock - f.need; f.articles.sort((a, b) => b.hides - a.hides); }
  return { furs: [...furs.values()].sort((a, b) => b.stock - a.stock), leftPcs, noData, asOf: sizes?.key.slice(-10) ?? null };
}
