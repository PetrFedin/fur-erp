// Правило длин (22.10): в черновике бюджета убираем деление на Short / Regular / Long там, где по какой-то длине нет данных в системе.
// Перед записью — копия строк бюджета в файл (аргумент 1). Без второго аргумента «--write» только показывает, что изменится.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-budget-length-rule-2026-10-22.ts <backup.json> [--write]
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst())!.id;
  const sc = await prisma.budgetScenario.findFirst({ where: { organizationId: org }, orderBy: { updatedAt: "desc" } });
  if (!sc) throw new Error("нет бюджета");
  const { parseNodes, collapseUnknownLengths, DEFAULT_PARAMS, grandTotal } = await import("../src/lib/budget-calc");
  const { loadBudgetStats } = await import("../src/lib/budget-stats");
  const params = { ...DEFAULT_PARAMS, ...(sc.params as object) };
  const nodes = parseNodes(sc.lines);
  const stats = await loadBudgetStats(org);
  const { nodes: next, collapsed } = collapseUnknownLengths(nodes, stats, params);
  const name = (id: string, ns: typeof nodes) => { const n = ns.find((x) => x.id === id)!; const f = ns.find((x) => x.id === n.parentId); return `${f?.name} › ${n.name}`; };
  console.log("свёрнуто категорий:", collapsed.map((id) => name(id, nodes)).join("; ") || "нет");
  for (const id of collapsed) { const n = next.find((x) => x.id === id)!; console.log(" ", name(id, next), "→", n.pcs, "шт., шкур", n.hides.toFixed(1), "м", n.meters.toFixed(2), "работа", Math.round(n.work), "src", n.src, "выборка", n.sample); }
  console.log("итого до:", Math.round(grandTotal(nodes, params as never).total), "после:", Math.round(grandTotal(next, params as never).total), "изд.", grandTotal(next, params as never).pcs);
  if (process.argv.includes("--write")) {
    writeFileSync(process.argv[2], JSON.stringify({ id: sc.id, lines: sc.lines }, null, 1));
    await prisma.budgetScenario.update({ where: { id: sc.id }, data: { lines: next as never, updatedBy: "правило длин 22.10" } });
    console.log("записано; копия:", process.argv[2]);
  }
  await prisma.$disconnect();
})();
