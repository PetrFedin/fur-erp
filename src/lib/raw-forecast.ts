import "server-only";
import { prisma } from "@/lib/prisma";
import { loadReportSizesState } from "@/lib/import-keys";
import { loadBudgetStats } from "@/lib/budget-stats";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { normKey, type BudgetStat } from "@/lib/budget-calc";
import type { ReportSizeRow } from "@/lib/margin-tree";

/**
 * Прогноз сырья на остаток заказа FW26 (заказано − поступило по отчёту о товарах, по артикулу с учётом излишков других размеров — как «ждём» на Главной).
 * Значения на изделие: шкуры, цена шкуры, подкладка, цена метра — средние по ТЗ артикула (у новых — по категории), ₽ с НДС;
 * работа — прежняя цена модели из ТЗ (как в Excel «Работа на остаток заказа»). Где данных нет — null (поле пустое, вводится вручную).
 */
export type ForecastLine = {
  acode: string; cls: "clothes" | "acc"; cat2: string; fur: string; left: number;
  hp: number | null; hidePrice: number | null; mp: number | null; meterPrice: number | null; wp: number | null;
  /** Работа взята как ориентир (среднее по моделям того же меха и категории 2), своей цены ТЗ у модели ещё нет. */
  wpEst?: string;
  source: "ТЗ артикула" | "категория" | "нет данных";
};
export type RawForecast = { lines: ForecastLine[]; stock: { fur: string; stock: number }[]; asOf: string | null };

const FUR_RE: [RegExp, string][] = [[/SABLE/, "Соболь"], [/MINK/, "Норка"], [/LYNX/, "Рысь"], [/FOX/, "Лиса"], [/KARAKUL|SWAKARA/, "Свакара"]];
const norm = (c: string) => c.replace(/[-\s]/g, "").toUpperCase();
const MANUAL: Record<string, string> = { M030: "Шубы", M039: "Шубы", M040: "Шубы", M054: "Шубы", M058: "Шубы", M059: "Шубы", MCF02: "Манжеты" };

export async function loadRawForecast(orgId: string): Promise<RawForecast> {
  const [sizes, stats, dash, models, lvl, orders] = await Promise.all([
    loadReportSizesState(orgId), loadBudgetStats(orgId),
    loadDashboard(orgId, "all", parseDashFilters({}), "off"),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, sku: true, salesCode: true, category: true } }),
    prisma.salesReceiptLine.findMany({ select: { article: true, modelCode: true, level4: true } }),
    prisma.productionOrder.findMany({ where: { clientWorkPricePerUnit: { not: null } }, select: { plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, productModel: { select: { salesCode: true, sku: true } } } }),
  ]);
  const rows = ((sizes?.value as { rows?: ReportSizeRow[] } | undefined)?.rows ?? []);
  const idOf = new Map<string, { id: string; cat: string | null }>();
  for (const m of models) for (const c of [m.salesCode, m.sku]) if (c) idOf.set(norm(c), { id: m.id, cat: m.category });
  const catByArt = new Map<string, string>(), catByModel = new Map<string, string>();
  for (const l of lvl) { if (!l.level4) continue; if (!catByArt.has(l.article)) catByArt.set(l.article, l.level4); if (l.modelCode && !catByModel.has(norm(l.modelCode))) catByModel.set(norm(l.modelCode), l.level4); }
  // Прежняя цена работы модели: средневзвешенная по ТЗ с ценой (как в scripts/export-remaining-work-cost.ts).
  const rate = new Map<string, { qty: number; sum: number }>();
  for (const o of orders) {
    const code = o.productModel.salesCode || o.productModel.sku; const p = Number(o.clientWorkPricePerUnit);
    if (!code || !(p > 0)) continue;
    const q = Number(o.producedQuantity) > 0 ? Number(o.producedQuantity) : Number(o.plannedQuantity);
    const r = rate.get(norm(code)) ?? { qty: 0, sum: 0 }; r.qty += q; r.sum += q * p; rate.set(norm(code), r);
  }
  const furOf = (a: string) => FUR_RE.filter(([re]) => re.test(a.toUpperCase())).map(([, n]) => n).sort().join(" + ");
  const pool = new Map<string, { fur: string; l4: string; rate: number }>(); // по модели
  for (const l of lvl) {
    const mc = norm(l.modelCode ?? l.article.split("/")[0]); const r = rate.get(mc);
    if (r && l.level4 && !pool.has(mc + "|" + furOf(l.article))) pool.set(mc + "|" + furOf(l.article), { fur: furOf(l.article), l4: l.level4, rate: r.sum / r.qty });
  }
  const estimate = (fur: string, cat2: string) => {
    const eq = (a: string, b: string) => normKey(a) === normKey(b);
    for (const [what, f] of [["мех и категория", (x: { fur: string; l4: string }) => x.fur === fur && eq(x.l4, cat2)], ["категория", (x: { fur: string; l4: string }) => eq(x.l4, cat2)]] as const) {
      const v = [...pool.values()].filter(f).map((x) => x.rate);
      if (v.length) return { avg: v.reduce((a, b) => a + b, 0) / v.length, note: `ориентир: ${what}, ${v.length} мод.` };
    }
    return null;
  };
  const clsOf = new Map(rows.map((r) => [r.acode, r.cls]));
  const left = new Map<string, { model: string; left: number; l3: string }>();
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
  const key2 = (f: string) => f.split(" + ").sort().join(" + ");
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const lines: ForecastLine[] = [];
  for (const [acode, e] of left) {
    const mi = idOf.get(norm(e.model));
    const cat2 = catByArt.get(acode) ?? catByModel.get(norm(e.model)) ?? MANUAL[norm(e.model)] ?? "(без категории)";
    const cls = clsOf.get(acode) === "acc" ? "acc" : "clothes";
    const codeFurs = FUR_RE.filter(([re]) => re.test(acode.toUpperCase())).map(([, n]) => n);
    const r = rate.get(norm(e.model)); const wp = r ? r.sum / r.qty : null;
    const base = { acode, cls, cat2, left: e.left, wp } as const;
    const own = (mi ? byModel.get(mi.id) : undefined)?.filter((s) => !codeFurs.length || same(s.fur.split(" + "), codeFurs));
    let st: BudgetStat | undefined, source: ForecastLine["source"] = "ТЗ артикула";
    if (own?.length) st = own[0];
    else if (codeFurs.length) { const c = [mi?.cat, e.l3, cat2].map((k) => (k ? byCat.get(`${[...codeFurs].sort().join(" + ")}|${normKey(k)}`) : undefined)).find((x) => x && x.hidesPer > 0); if (c) { st = c; source = "категория"; } }
    const furName = st ? st.fur : codeFurs.join(" + ") || "—";
    const est = wp === null && st ? estimate(key2(furName), cat2) : null;
    lines.push(st
      ? { ...base, wp: est ? est.avg : wp, wpEst: est?.note, fur: st.fur, hp: st.hidesPer, hidePrice: st.hidePrice, mp: st.metersPer, meterPrice: st.meterPrice, source }
      : { ...base, fur: codeFurs.join(" + ") || "—", hp: null, hidePrice: null, mp: null, meterPrice: null, source: "нет данных" });
  }
  lines.sort((a, b) => a.cat2.localeCompare(b.cat2, "ru") || a.acode.localeCompare(b.acode));
  const stock = dash.rawFurBySource.all.types.map((t) => ({ fur: t.name, stock: t.pair.incl.remQty })).filter((x) => x.stock > 0);
  return { lines, stock, asOf: sizes?.key.slice(-10) ?? null };
}
