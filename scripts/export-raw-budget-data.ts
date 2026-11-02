// Данные для Excel «Сырьё и бюджет»: прогноз по артикулам остатка FW26, склад по типам меха, цены шкур, доля норки в «Норка+Соболь»,
// бюджет FW27 (листья дерева: тип меха → категория → длина) и строки Budget PCS с AVG — теми же функциями, что страницы приложения. Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-raw-budget-data.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { orderLabel } from "../src/lib/order-label";

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))!.id;
  const { loadRawForecast } = await import("../src/lib/raw-forecast");
  const { loadRawBalance } = await import("../src/lib/raw-balance");
  const { listForecasts } = await import("../src/lib/forecast-store");
  const { parseNodes, childrenMap, isAccessoryCat, normKey, DEFAULT_PARAMS } = await import("../src/lib/budget-calc");
  const { listPcs } = await import("../src/lib/budget-pcs-store");
  const { loadBudgetAvg, withBudgetAvg } = await import("../src/lib/budget-pcs-avg");

  const [fc, bal, docs] = await Promise.all([loadRawForecast(org), loadRawBalance(org), listForecasts(org)]);
  const doc = docs[0];
  const off = new Set(doc?.off ?? []);
  const num = (s: string | undefined, d: number | null) => { const v = parseFloat(String(s ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) ? v : d; };
  const forecast = fc.lines.filter((l) => !off.has(l.acode)).map((l) => {
    const e = doc?.edits[l.acode] ?? {};
    return { acode: l.acode, cls: l.cls === "acc" ? "Аксессуары" : "Одежда", cat2: l.cat2, fur: l.fur, left: l.left, hp: num(e.hp, l.hp), hidePrice: num(e.hidePrice, l.hidePrice),
      mp: num(e.mp, l.mp), meterPrice: num(e.meterPrice, l.meterPrice), wp: num(e.wp, l.wp), extra: num(e.extra, 0), source: l.source, wpEst: l.wpEst ?? null, issued: l.issued ?? 0, issuedM: l.issuedM ?? 0, produced: l.produced ?? 0, inWork: l.inWork ?? 0, notStarted: l.notStarted ?? 0, sourceNote: l.sourceNote ?? null };
  });

  const sc = await prisma.budgetScenario.findFirstOrThrow({ where: { organizationId: org, name: "FW27" } });
  const nodes = parseNodes(sc.lines);
  const kids = childrenMap(nodes);
  const catRefs = await prisma.categoryRef.findMany({ where: { organizationId: org }, select: { name: true, group: true } });
  const catGroups: Record<string, string | null> = Object.fromEntries(catRefs.map((c) => [normKey(c.name), c.group]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const budget: unknown[] = [];
  for (const c of nodes.filter((n) => n.kind === "cat")) {
    const fur = byId.get(c.parentId ?? "")?.name ?? "";
    const group = isAccessoryCat(c, catGroups) ? "Аксессуары" : "Одежда";
    const lens = (kids.get(c.id) ?? []).filter((x) => x.kind === "len");
    const leaves = lens.length ? lens : [c];
    for (const l of leaves) {
      if (!(l.pcs > 0)) continue;
      // Цена шкуры без роста: base системы (у длины — своя, иначе категории); нет base — цена бюджета ÷ (1 + надбавка): в цене бюджета уже заложен рост.
      const up = 1 + ((l.upFur ?? c.upFur ?? (sc.params as { upFur?: number } | null)?.upFur ?? 10) / 100);
      const basePrice = l.base?.hidePrice || c.base?.hidePrice || l.hidePrice / up;
      budget.push({ fur, group, cat: c.name, len: l.kind === "len" ? l.name : "", pcs: l.pcs, hides: l.hides, hidePrice: l.hidePrice, basePrice, statHides: l.base?.hides ?? null,
        meters: l.meters, meterPrice: l.meterPrice, work: l.work, est: (l as { est?: string }).est ?? (c as { est?: string }).est ?? null, src: l.src, sample: l.sample, locked: l.locked });
    }
  }
  const pcsDoc = (await listPcs(org)).find((d) => d.id === "fw27-mvst") ?? (await listPcs(org))[0];
  const avg = await loadBudgetAvg(org);
  const pcsRows = withBudgetAvg(pcsDoc.rows, avg).filter((r) => r.pcs > 0).map((r) => ({ block: r.block === "Acc" ? "Аксессуары" : "Одежда", fur: r.fur, cat: r.cat, len: r.len, pcs: r.pcs, avg: r.avg ?? (r as { avgB?: number | null }).avgB ?? null }));

  // План производства 2027 — тот же расчёт, что отчёт «План производства 2027» (src/lib/fw27-plan.ts) с сохранёнными правками.
  const { computeSupply, overridesFromParams } = await import("../src/lib/fw27-supply");
  const { buildPlan, planRows, planInputFromSupply } = await import("../src/lib/fw27-plan");
  const { loadPlanData } = await import("../src/lib/fw27-plan-data");
  const pd = await loadPlanData(org);
  const sup = computeSupply({ rows: pd.rows, blocks: ["RTW", "Acc"], raw: pd.raw, mix: pd.mix, price: pd.price, minkStock: pd.minkStock, params: pd.params, ov: overridesFromParams(pd.params) });
  const supRows = sup.rows.filter((r) => !r.mixed) as import("../src/lib/fw27-supply").SupplyFurRow[];
  const prows = planRows(pd.rows, pd.params, pd.mix), pin = planInputFromSupply(supRows);
  const planRes = buildPlan({ prows, ...pin, state: pd.state });
  const plan = { prows, lpool: pin.lpool, buy: pin.buy, state: pd.state, ...planRes,
    supply: supRows.map((r) => ({ fur: r.label, leftAll: r.leftAll, use: r.use, np: r.np, buy: r.buy, money: r.money, rem26: r.rem26, remBuy: r.remBuy })), supplyTotal: sup.total };

  // Непроизведённые изделия FW26 по ТЗ (src/lib/fw26-remaining — та же раскладка, что в приложении): по ТЗ со списанием расход точно как в ТЗ
  // (actual — шкуры по мехам, уже списаны), без списания и без ТЗ — по норме (norm), это и возьмём со склада.
  const { loadOrderRows } = await import("../src/lib/analytics-orders");
  const { remainingByTz, actualTotal } = await import("../src/lib/fw26-remaining");
  const orderRows = await loadOrderRows(org, "all", "off");
  const fw26 = remainingByTz(forecast.map((l) => ({ ...l, hp: l.hp, sourceNote: l.sourceNote ?? undefined })), orderRows, orderLabel)
    .map((r) => ({ ...r, cls: r.cls, done: actualTotal(r), toGo: actualTotal(r) > 0 ? 0 : r.norm }));

  const out = {
    asOf: new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date()),
    forecastName: doc?.name ?? null,
    forecast, stock: bal.rows, price: bal.price, mix: bal.mix,
    budgetParams: { ...DEFAULT_PARAMS, ...(sc.params as object) }, budget,
    pcsParams: pcsDoc.params ?? null, pcsRows, fw26, plan,
  };
  writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(`прогноз: ${forecast.length} строк, остаток ${forecast.reduce((s, l) => s + l.left, 0)} шт.; бюджет: ${budget.length} строк, ${budget.reduce((s: number, b: any) => s + b.pcs, 0)} шт.; PCS: ${pcsRows.length} строк, ${pcsRows.reduce((s, r) => s + r.pcs, 0)} шт.`);
  process.exit(0);
})();
