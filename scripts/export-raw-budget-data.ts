// Данные для Excel «Сырьё и бюджет»: прогноз по артикулам остатка FW26, склад по типам меха, цены шкур, доля норки в «Норка+Соболь»,
// бюджет FW27 (листья дерева: тип меха → категория → длина) и строки Budget PCS с AVG — теми же функциями, что страницы приложения. Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-raw-budget-data.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

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
      budget.push({ fur, group, cat: c.name, len: l.kind === "len" ? l.name : "", pcs: l.pcs, hides: l.hides, hidePrice: l.hidePrice, meters: l.meters, meterPrice: l.meterPrice, work: l.work, est: (l as { est?: string }).est ?? (c as { est?: string }).est ?? null, src: l.src });
    }
  }
  const pcsDoc = (await listPcs(org)).find((d) => d.id === "fw27-mvst") ?? (await listPcs(org))[0];
  const avg = await loadBudgetAvg(org);
  const pcsRows = withBudgetAvg(pcsDoc.rows, avg).filter((r) => r.pcs > 0).map((r) => ({ block: r.block === "Acc" ? "Аксессуары" : "Одежда", fur: r.fur, cat: r.cat, len: r.len, pcs: r.pcs, avg: r.avg ?? (r as { avgB?: number | null }).avgB ?? null }));

  const out = {
    asOf: new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date()),
    forecastName: doc?.name ?? null,
    forecast, stock: bal.rows, price: bal.price, mix: bal.mix,
    budgetParams: { ...DEFAULT_PARAMS, ...(sc.params as object) }, budget,
    pcsParams: pcsDoc.params ?? null, pcsRows,
  };
  writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(`прогноз: ${forecast.length} строк, остаток ${forecast.reduce((s, l) => s + l.left, 0)} шт.; бюджет: ${budget.length} строк, ${budget.reduce((s: number, b: any) => s + b.pcs, 0)} шт.; PCS: ${pcsRows.length} строк, ${pcsRows.reduce((s, r) => s + r.pcs, 0)} шт.`);
  process.exit(0);
})();
