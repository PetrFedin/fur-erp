// Бюджет FW27: штуки по типам меха и категориям — по обновлённым файлам Budget PCS FW27 (RTW от 19.10, Acc от 22.10).
// Цели читаются из JSON (scripts подготовлены из xlsx: fur, cat, len, pcs, avg). Без --write — только расчёт и сравнение.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-budget-fw27-pcs-2026-10-26.ts <fw27_new.json> [--write]
import "./stubs/server-only-shim";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

type T = { fur: string; cat: string; len?: string; pcs: number; avg?: number | null };
const STAT_CAT: Record<string, string> = { "Шапка меховая": "Головной убор", "Повязка меховая": "Головной убор", Косынка: "Головной убор", Берет: "Головной убор", Капюшон: "Головной убор", Наушники: "Головной убор", "Манжеты, муфты, варежки": "Варежки", Шарфы: "Шарф" };

(async () => {
  const prisma = new PrismaClient();
  const bc = await import("../src/lib/budget-calc");
  const { loadBudgetStats } = await import("../src/lib/budget-stats");
  const { DEFAULT_PARAMS, autoCalc, blankNode, collapseUnknownLengths, computeTree, grandTotal, isAccessoryCat, normKey, parseNodes } = bc;
  const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as { rtw: T[]; acc: T[] };
  const row = await prisma.budgetScenario.findFirst({ where: { name: "FW27" } });
  if (!row) throw new Error("нет бюджета FW27");
  const orgId = row.organizationId;
  const params = { ...DEFAULT_PARAMS, ...(row.params as object) };
  const stats = await loadBudgetStats(orgId);
  const catRefs = await prisma.categoryRef.findMany({ where: { organizationId: orgId }, select: { name: true, group: true } });
  const catGroups: Record<string, string | null> = Object.fromEntries(catRefs.map((c) => [normKey(c.name), c.group]));

  const old = parseNodes(row.lines);
  const summarize = (ns: typeof old) => {
    const calc = computeTree(ns, params); const byId = new Map(ns.map((n) => [n.id, n]));
    return ns.filter((n) => n.kind === "cat").map((c) => { const f = byId.get(c.parentId ?? ""); const a = calc.get(c.id); return { fur: f?.name ?? "", cat: c.name, acc: isAccessoryCat(c, catGroups), pcs: a?.pcs ?? 0, hides: a?.hides ?? 0, total: a?.total ?? 0 }; });
  };

  // Цели по категориям (сумма по длинам); длины — только у одежды.
  const cats = new Map<string, { fur: string; cat: string; pcs: number; lens: [string, number][]; avg: Record<string, number | null> }>();
  for (const t of [...data.rtw, ...data.acc]) {
    const k = `${t.fur}|${t.cat}`;
    const c = cats.get(k) ?? { fur: t.fur, cat: t.cat, pcs: 0, lens: [], avg: {} };
    c.pcs += t.pcs; if (t.len) { c.lens.push([t.len, t.pcs]); c.avg[t.len] = t.avg ?? null; } cats.set(k, c);
  }
  let nodes = old.map((n) => ({ ...n }));
  const furNode = (name: string) => nodes.find((n) => n.kind === "fur" && n.name === name);
  // Старые категории, которых нет в новых файлах, переносим: «Пальто меховое» (Каракульча) → «Шубы», «Полупальто меховое» (Норка+Соболь) — в «Шубы» (новый файл ведёт их одной строкой).
  const RENAME: Record<string, string> = { "Каракульча|Пальто меховое": "Шубы" };
  for (const n of nodes) if (n.kind === "cat") { const f = nodes.find((x) => x.id === n.parentId); const r = RENAME[`${f?.name}|${n.name}`]; if (r) n.name = r; }
  const drop = new Set<string>();
  for (const n of nodes) if (n.kind === "cat") { const f = nodes.find((x) => x.id === n.parentId); if (f?.name === "Норка+Соболь" && n.name === "Полупальто меховое") drop.add(n.id); }
  const kidsOf = (id: string): string[] => nodes.filter((x) => x.parentId === id).flatMap((x) => [x.id, ...kidsOf(x.id)]);
  for (const id of [...drop]) for (const k of kidsOf(id)) drop.add(k);
  nodes = nodes.filter((n) => !drop.has(n.id));

  const notes: string[] = [];
  for (const c of cats.values()) {
    const f = furNode(c.fur); if (!f) { notes.push(`нет типа сырья «${c.fur}» в бюджете: ${c.cat} ${c.pcs} шт. пропущено`); continue; }
    let cat = nodes.find((n) => n.kind === "cat" && n.parentId === f.id && n.name === c.cat);
    if (!cat) { cat = blankNode("cat", f.id, c.cat, { statCat: STAT_CAT[c.cat] ?? "" }); nodes.push(cat); notes.push(`добавлена категория: ${c.fur} · ${c.cat} (${c.pcs} шт.)`); }
    cat.pcs = c.pcs;
    // Длины: пересобираем по файлу (одежда); значения длин пересчитает «Автоматический расчёт» (Рысь — вручную из файла).
    const oldLens = nodes.filter((n) => n.kind === "len" && n.parentId === cat!.id);
    if (c.lens.length) {
      for (const l of oldLens) for (const id of [l.id, ...kidsOf(l.id)]) { const i = nodes.findIndex((x) => x.id === id); if (i >= 0) nodes.splice(i, 1); }
      for (const [name, pcs] of c.lens) {
        const manual = c.fur === "Рысь";
        nodes.push({ ...cat, ...blankNode("len", cat.id, name, { pcs, locked: manual, src: manual ? "manual" : "none", statCat: "", statFur: "" }), hides: manual ? (c.avg[name] ?? cat.hides) : cat.hides, hidePrice: cat.hidePrice, meters: cat.meters, meterPrice: cat.meterPrice, work: cat.work });
      }
    }
  }
  let calc = autoCalc(nodes, stats, params);
  const collapsed = collapseUnknownLengths(calc, stats, params);
  calc = collapsed.nodes;

  const before = summarize(old), after = summarize(calc);
  const key = (r: { fur: string; cat: string }) => `${r.fur}|${r.cat}`;
  const bm = new Map(before.map((r) => [key(r), r])), am = new Map(after.map((r) => [key(r), r]));
  const lines: string[] = [];
  for (const k of new Set([...bm.keys(), ...am.keys()])) {
    const b = bm.get(k), a = am.get(k);
    lines.push(`${k.padEnd(44)} ${String(Math.round(b?.pcs ?? 0)).padStart(4)} → ${String(Math.round(a?.pcs ?? 0)).padStart(4)} шт.  шк.: ${Math.round(b?.hides ?? 0)} → ${Math.round(a?.hides ?? 0)}  ₽: ${Math.round((b?.total ?? 0) / 1e6)} → ${Math.round((a?.total ?? 0) / 1e6)} млн${a && a.total === 0 && a.pcs > 0 ? "  (нет данных расчёта)" : ""}`);
  }
  const tb = grandTotal(old, params), ta = grandTotal(calc, params);
  const part = (rs: typeof before, acc: boolean) => rs.filter((r) => r.acc === acc).reduce((s, r) => ({ pcs: s.pcs + r.pcs, total: s.total + r.total }), { pcs: 0, total: 0 });
  console.log(lines.join("\n"));
  console.log("\nДОБАВЛЕНО/ЗАМЕЧАНИЯ:\n" + notes.join("\n"));
  console.log("\nСхлопнуто по правилу длин:", collapsed.collapsed.join("; ") || "—");
  console.log(`\nИТОГО: ${Math.round(tb.pcs)} → ${Math.round(ta.pcs)} шт.; шкур ${Math.round(tb.hides)} → ${Math.round(ta.hides)}; бюджет ${Math.round(tb.total / 1e6)} → ${Math.round(ta.total / 1e6)} млн ₽`);
  console.log("Одежда:", Math.round(part(before, false).pcs), "→", Math.round(part(after, false).pcs), "шт.", Math.round(part(before, false).total / 1e6), "→", Math.round(part(after, false).total / 1e6), "млн");
  console.log("Аксессуары:", Math.round(part(before, true).pcs), "→", Math.round(part(after, true).pcs), "шт.", Math.round(part(before, true).total / 1e6), "→", Math.round(part(after, true).total / 1e6), "млн");
  if (process.argv.includes("--write")) {
    writeFileSync(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "/tmp/budget_fw27_backup.json", JSON.stringify(row.lines));
    await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: calc as never, updatedBy: null } });
    console.log("ЗАПИСАНО");
  }
  process.exit(0);
})();
