import "server-only";
import { prisma } from "@/lib/prisma";
import { loadReportSizesState } from "@/lib/import-keys";
import { loadBudgetStats } from "@/lib/budget-stats";
import { loadDashboard } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { normKey, type BudgetStat } from "@/lib/budget-calc";
import type { ReportSizeRow } from "@/lib/margin-tree";
import { loadReportSizes } from "@/lib/margin-server";
import { tzAwaitSizes } from "@/lib/tz-await";
import { loadOrderRows, receivedByModel } from "@/lib/analytics-orders";

/**
 * Прогноз сырья и затрат на изделия заказа FW26, которые ещё не произведены (по нашим ТЗ: объём ТЗ модели − получено в рознице, как «ждём» на Главной).
 * По каждой модели «ждём» делится: produced — по ТЗ, отмеченным завершёнными (шкуры уже списаны со склада), и inWork — ТЗ в работе / запланированы
 * (нужно за вычетом уже выданного подрядчику, issued). Расход и затраты показываются на все изделия; со склада ещё уйдёт только непокрытая часть.
 * Значения на изделие: по ТЗ этой модели («ТЗ артикула»), иначе по категории того же меха («категория»), иначе — той же категории другого меха
 * с ценой шкуры своего меха («аналог»). Работа — цена модели из ТЗ, иначе ориентир по похожим моделям. ₽ с НДС.
 */
export type ForecastLine = {
  acode: string; cls: "clothes" | "acc"; cat2: string; fur: string;
  /** Ждём всего, шт. = produced + inWork + notStarted. */
  left: number;
  produced?: number; inWork?: number; notStarted?: number;
  hp: number | null; hidePrice: number | null; mp: number | null; meterPrice: number | null; wp: number | null;
  /** Работа взята как ориентир (среднее по моделям того же меха и категории 2), своей цены ТЗ у модели ещё нет. */
  wpEst?: string;
  source: "ТЗ артикула" | "категория" | "аналог" | "нет данных";
  /** Для «аналог»/«категория»: откуда взят расход (модель/категория/мех). */
  sourceNote?: string;
  /** Уже выдано подрядчику по ТЗ этой модели в работе (шкуры и метры подкладки списаны со склада): из потребности вычитается. */
  issued?: number; issuedM?: number;
};
/** Сколько изделий ещё предстоит сшить (затраты впереди): в работе + без ТЗ. У старых строк без разбивки — весь остаток. */
export const toMake = (l: Pick<ForecastLine, "left" | "inWork" | "notStarted">) => (l.inWork == null && l.notStarted == null ? l.left : (l.inWork ?? 0) + (l.notStarted ?? 0));
/** Шкуры, которые ещё уйдут СО СКЛАДА: в работе × шкур на изд. − уже выдано (по завершённым ТЗ шкуры уже списаны). Без разбивки — весь остаток. */
export const hidesToGo = (l: Pick<ForecastLine, "left" | "inWork" | "notStarted" | "issued">, hp: number) =>
  Math.max(0, (l.inWork ?? (l.notStarted == null ? l.left : 0)) * hp - (l.issued ?? 0)) + (l.notStarted ?? 0) * hp;
export const metersToGo = (l: Pick<ForecastLine, "left" | "inWork" | "notStarted" | "issuedM">, mp: number) =>
  Math.max(0, (l.inWork ?? (l.notStarted == null ? l.left : 0)) * mp - (l.issuedM ?? 0)) + (l.notStarted ?? 0) * mp;
export type RawForecast = { lines: ForecastLine[]; stock: { fur: string; stock: number }[]; asOf: string | null };

const FUR_RE: [RegExp, string][] = [[/SABLE/, "Соболь"], [/MINK/, "Норка"], [/LYNX/, "Рысь"], [/FOX/, "Лиса"], [/KARAKUL|SWAKARA/, "Свакара"]];
// Коды моделей пишут то латиницей, то кириллицей (М040 / M040, МН11 / MH11): сравниваем в латинице без дефисов и пробелов.
const CYR: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
const norm = (c: string) => c.replace(/[-\s]/g, "").toUpperCase().replace(/[АВЕКМНОРСТХУ]/g, (ch) => CYR[ch] ?? ch);
const base = (c: string) => norm(c.split(/[ /+]/)[0]);
const MANUAL: Record<string, string> = { M030: "Шубы", M039: "Шубы", M040: "Шубы", M054: "Шубы", M058: "Шубы", M059: "Шубы", MCF02: "Манжеты" };
// Категории отчёта о товарах (KTT Level 04/05) → категории статистики ТЗ (справочник категорий): чтобы найти расход у моделей без своих ТЗ.
const SYN: Record<string, string[]> = {
  "Шуба удлиненная": ["Пальто", "Шубы"], "Шуба укороченная": ["Полупальто", "Шубы"], "Шуба однобортная": ["Шубы"], "Полупальто меховое": ["Полупальто"],
  "Манжеты": ["Варежки"], "Варежки": ["Варежки"], "Муфта меховая": ["Муфта", "Варежки"], "Шапка": ["Головной убор"], "Шапка меховая": ["Головной убор"],
  "Повязка": ["Головной убор"], "Повязка меховая": ["Головной убор"], "Шарф меховой": ["Шарф"], "Шарфы": ["Шарф"], "Жилет меховой": ["Жилет"],
  "Куртки меховые": ["Куртка"], "Юбка меховая": ["Юбка"], "Кардиган меховой": ["Жакет"],
};
const withSyn = (cats: string[]) => [...new Set(cats.flatMap((c) => [c, ...(SYN[c] ?? [])]))];

export async function loadRawForecast(orgId: string): Promise<RawForecast> {
  const [sizes, sizeRows, stats, dash, models, lvl, orders, orderRows, recv] = await Promise.all([
    loadReportSizesState(orgId), loadReportSizes(orgId), loadBudgetStats(orgId),
    loadDashboard(orgId, "all", parseDashFilters({}), "off"),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, sku: true, salesCode: true, aliases: true, category: true } }),
    prisma.salesReceiptLine.findMany({ select: { article: true, modelCode: true, level4: true } }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId, clientWorkPricePerUnit: { not: null } }, select: { plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, productModelId: true } }),
    loadOrderRows(orgId, "all", "off"), receivedByModel(orgId),
  ]);
  const tzRows: ReportSizeRow[] = await tzAwaitSizes(orgId, "off");
  // Модель по любому её коду: название, артикул, код продаж, псевдонимы.
  const idOf = new Map<string, { id: string; name: string; cat: string | null }>();
  for (const m of models) for (const c of [m.name, m.sku, m.salesCode, ...(m.aliases ?? [])]) if (c && !idOf.has(base(c))) idOf.set(base(c), { id: m.id, name: m.name, cat: m.category });
  const catByArt = new Map<string, string>(), catByModel = new Map<string, string>();
  for (const l of lvl) { if (!l.level4) continue; if (!catByArt.has(l.article)) catByArt.set(l.article, l.level4); if (l.modelCode && !catByModel.has(base(l.modelCode))) catByModel.set(base(l.modelCode), l.level4); }
  for (const r of sizeRows) { const c = r.l5 || r.l4; if (!c) continue; const k = base(r.modelCode ?? r.acode); if (!catByModel.has(k)) catByModel.set(k, c); }
  // Прежняя цена работы модели: средневзвешенная по ТЗ с ценой (по id модели).
  const rate = new Map<string, { qty: number; sum: number }>();
  for (const o of orders) {
    const p = Number(o.clientWorkPricePerUnit); if (!(p > 0)) continue;
    const q = Number(o.producedQuantity) > 0 ? Number(o.producedQuantity) : Number(o.plannedQuantity);
    const r = rate.get(o.productModelId) ?? { qty: 0, sum: 0 }; r.qty += q; r.sum += q * p; rate.set(o.productModelId, r);
  }
  const furOf = (a: string) => FUR_RE.filter(([re]) => re.test(a.toUpperCase())).map(([, n]) => n).sort().join(" + ");
  const pool = new Map<string, { fur: string; l4: string; rate: number }>(); // по модели и меху
  for (const l of lvl) {
    const mi = idOf.get(base(l.modelCode ?? l.article)); const r = mi ? rate.get(mi.id) : undefined;
    if (r && l.level4 && !pool.has(mi!.id + "|" + furOf(l.article))) pool.set(mi!.id + "|" + furOf(l.article), { fur: furOf(l.article), l4: l.level4, rate: r.sum / r.qty });
  }
  const estimate = (fur: string, cat2: string | string[]) => {
    const want = (Array.isArray(cat2) ? cat2 : [cat2]).map(normKey);
    const eq = (a: string) => want.includes(normKey(a));
    for (const [what, f] of [["мех и категория", (x: { fur: string; l4: string }) => x.fur === fur && eq(x.l4)], ["категория", (x: { fur: string; l4: string }) => eq(x.l4)]] as const) {
      const v = [...pool.values()].filter(f).map((x) => x.rate);
      if (v.length) return { avg: v.reduce((a, b) => a + b, 0) / v.length, note: `ориентир: ${what}, ${v.length} мод.` };
    }
    return null;
  };

  // 1. Разбивка ТЗ по моделям: сшито (завершённые) и в работе; без ремонта.
  const tz = new Map<string, { prod: number; work: number }>();
  for (const r of orderRows) {
    if (r.category === "Ремонт") continue;
    const e = tz.get(r.modelId) ?? { prod: 0, work: 0 };
    if (r.status === "COMPLETED") e.prod += r.qty; else e.work += r.qty;
    tz.set(r.modelId, e);
  }
  // 2. Строки «ждём по ТЗ» (объём ТЗ − получено), по модели и меху.
  type E = { modelId: string | null; model: string; acode: string; cls: "clothes" | "acc"; l3: string; produced: number; inWork: number; notStarted: number };
  const ent = new Map<string, E>();
  const awaitByModel = new Map<string, number>();
  for (const r of tzRows) {
    const mi = idOf.get(base(r.modelCode ?? r.acode)); if (!mi) continue;
    awaitByModel.set(mi.id, (awaitByModel.get(mi.id) ?? 0) + (r.fw26Conf ?? 0));
  }
  for (const r of tzRows) {
    const mi = idOf.get(base(r.modelCode ?? r.acode)); const n = r.fw26Conf ?? 0; if (!mi || n <= 0) continue;
    const t = tz.get(mi.id) ?? { prod: 0, work: 0 }, aw = awaitByModel.get(mi.id) ?? n;
    const prodNR = Math.min(aw, Math.max(0, t.prod - (recv.get(mi.id) ?? 0)));
    const share = n / aw;
    ent.set(r.acode, { modelId: mi.id, model: mi.name, acode: r.acode, cls: r.cls === "acc" ? "acc" : "clothes", l3: r.l4 || r.l3 || "", produced: prodNR * share, inWork: (aw - prodNR) * share, notStarted: 0 });
  }
  // 4. Расход и цены на изделие.
  const byModel = new Map<string, BudgetStat[]>(), byCat = new Map<string, BudgetStat>();
  for (const s of stats) {
    if (s.len) continue;
    if (s.modelId) byModel.set(s.modelId, [...(byModel.get(s.modelId) ?? []), s]);
    else byCat.set(`${s.fur}|${normKey(s.cat)}`, s);
  }
  // Средневзвешенная цена шкуры по меху (для «аналога» другого меха): Σ шкур × цена ÷ Σ шкур по категориям.
  const furPrice = new Map<string, [number, number]>();
  for (const s of byCat.values()) { if (!(s.hidePrice > 0) || !(s.hidesPer > 0) || s.fur.includes(" + ")) continue; const h = s.qty * s.hidesPer, a = furPrice.get(s.fur) ?? [0, 0]; a[0] += h * s.hidePrice; a[1] += h; furPrice.set(s.fur, a); }
  const priceOf = (fur: string) => { const a = furPrice.get(fur); return a && a[1] > 0 ? a[0] / a[1] : null; };
  const key2 = (f: string) => f.split(" + ").sort().join(" + ");
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const lines: ForecastLine[] = [];
  for (const e of ent.values()) {
    const left = e.produced + e.inWork + e.notStarted; if (left <= 0) continue;
    const mi = e.modelId ? { id: e.modelId, cat: models.find((m) => m.id === e.modelId)?.category ?? null } : undefined;
    const cat2 = catByArt.get(e.acode) ?? catByModel.get(base(e.model)) ?? MANUAL[base(e.model)] ?? (e.l3 || mi?.cat || "(без категории)");
    const codeFurs = FUR_RE.filter(([re]) => re.test(e.acode.toUpperCase())).map(([, n]) => n);
    const r = e.modelId ? rate.get(e.modelId) : undefined; const wp = r ? r.sum / r.qty : null;
    const head = { acode: e.acode, cls: e.cls, cat2, left, produced: e.produced, inWork: e.inWork, notStarted: e.notStarted, wp } as const;
    const own = (mi ? byModel.get(mi.id) : undefined)?.filter((s) => !codeFurs.length || same(s.fur.split(" + "), codeFurs));
    let st: BudgetStat | undefined, source: ForecastLine["source"] = "ТЗ артикула", note: string | undefined, price: number | null = null;
    const cats = withSyn([mi?.cat, e.l3, cat2, MANUAL[base(e.model)]].filter(Boolean) as string[]);
    if (own?.length) st = own[0];
    else if (codeFurs.length) {
      const fk = [...codeFurs].sort().join(" + ");
      const c = cats.map((k) => byCat.get(`${fk}|${normKey(k)}`)).find((x) => x && x.hidesPer > 0);
      if (c) { st = c; source = "категория"; note = `${c.fur} · ${c.cat}, ${c.qty} изд. в ТЗ`; }
      else {
        // Той же категории, другой мех: расход шкур и подкладки — по самой массовой такой категории; цена шкуры — средняя своего меха.
        const alt = [...byCat.values()].filter((s) => s.hidesPer > 0 && cats.some((k) => normKey(k) === normKey(s.cat))).sort((a, b) => b.qty - a.qty)[0];
        if (alt) { st = alt; source = "аналог"; price = priceOf(fk.split(" + ")[0]); note = `расход как ${alt.fur} · ${alt.cat} (${alt.qty} изд.), цена шкуры — средняя «${fk}»`; }
      }
    }
    const furName = source === "аналог" ? codeFurs.join(" + ") : st ? st.fur : codeFurs.join(" + ") || "–";
    const est = wp === null && st ? estimate(key2(furName), [cat2, ...cats]) : null;
    lines.push(st
      ? { ...head, wp: est ? est.avg : wp, wpEst: est?.note, fur: furName, hp: st.hidesPer, hidePrice: price ?? st.hidePrice, mp: st.metersPer, meterPrice: st.meterPrice, source, sourceNote: note }
      : { ...head, fur: codeFurs.join(" + ") || "–", hp: null, hidePrice: null, mp: null, meterPrice: null, source: "нет данных" });
  }

  // 5. Уже выданное по ТЗ в работе (IN_PROGRESS / PLANNED со списаниями) → по строкам модели пропорционально «в работе».
  const wip = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, status: { in: ["IN_PROGRESS", "PLANNED"] }, materialUsages: { some: {} } },
    select: { productModelId: true, materialUsages: { select: { quantity: true, rawMaterial: { select: { unit: true } } } } },
  });
  const issuedBy = new Map<string, { h: number; m: number }>();
  for (const o of wip) {
    const x = issuedBy.get(o.productModelId) ?? { h: 0, m: 0 };
    for (const u of o.materialUsages) { if (u.rawMaterial.unit === "M") x.m += Number(u.quantity); else x.h += Number(u.quantity); }
    issuedBy.set(o.productModelId, x);
  }
  const modelOf = new Map([...ent.values()].map((e) => [e.acode, e.modelId]));
  const workByModel = new Map<string, number>();
  for (const l of lines) { const m = modelOf.get(l.acode); if (m) workByModel.set(m, (workByModel.get(m) ?? 0) + (l.inWork ?? 0)); }
  for (const l of lines) {
    const m = modelOf.get(l.acode), iss = m ? issuedBy.get(m) : undefined, tot = m ? workByModel.get(m) ?? 0 : 0;
    if (iss && tot > 0) { l.issued = iss.h * ((l.inWork ?? 0) / tot); l.issuedM = iss.m * ((l.inWork ?? 0) / tot); }
  }
  lines.sort((a, b) => a.cat2.localeCompare(b.cat2, "ru") || a.acode.localeCompare(b.acode));
  const stock = dash.rawFurBySource.all.types.map((t) => ({ fur: t.name, stock: t.pair.incl.remQty })).filter((x) => x.stock > 0);
  return { lines, stock, asOf: sizes?.key.slice(-10) ?? null };
}
