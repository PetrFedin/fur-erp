// Бюджет FW27: нормы «шкур на изделие» по комментариям владельца к листу «5 План 2027» (скриншот 01.11.2026, столбец «заменить» и красные пометки).
// Узлы ставятся вручную (замочек, src manual), чтобы пересчёт по статистике их не затёр. Прежние строки — docs-inventory/budget-fw27-before-2026-11-01.json.
//   node --env-file=.env node_modules/.bin/tsx scripts/apply-budget-fw27-owner-norms-2026-11-01.ts [--write]
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// [мех, категория, длина | "", новое значение, откуда]
const NORMS: [string, string, string, number, string][] = [
  ["Соболь", "Жилет меховой", "Short", 28, "заменить: 28"],
  ["Соболь", "Куртки меховые", "", 40, "заменить: 40"],
  ["Соболь", "Шубы", "Short", 50, "заменить: 50"],
  ["Соболь", "Шубы", "Regular", 65, "заменить: 65"],
  ["Соболь", "Шубы", "Long", 90, "заменить: 90"],
  ["Соболь", "Косынка", "", 8, "заменить: 8"],
  ["Соболь", "Манжеты, муфты, варежки", "", 2, "муфты 7 × 4 + варежки 6 × 2 + манжеты 7 × 0 (обрезки) = 40 шк. на 20 изд."],
  ["Соболь", "Повязка меховая", "", 2, "заменить: 2"],
  ["Соболь", "Шапка меховая", "", 4, "заменить: 4"],
  ["Норка", "Шубы", "Long", 40, "40 самка (лонг); роспуск из самцов (29) не учитывать"],
  ["Норка", "Берет", "", 1.5, "заменить: 1,5"],
  ["Норка", "Капюшон", "", 4.3, "заменить: 4,3"],
  ["Норка", "Косынка", "", 3, "заменить: 3"],
  ["Норка", "Манжеты, муфты, варежки", "", 1.3, "муфты 12 × 2 + варежки 20 × 1 + манжеты 8 × 1 = 52 шк. на 40 изд."],
  ["Норка", "Повязка меховая", "", 0.5, "заменить: 0,5"],
  ["Норка", "Шапка меховая", "", 1.5, "заменить: 1,5"],
  ["Норка", "Шарфы", "", 4, "заменить: 4"],
  ["Норка+Соболь", "Косынка", "", 6, "3 норка + 3 соболь"],
  ["Норка+Соболь", "Манжеты, муфты, варежки", "", 3, "варежки 10 изд.: 1 норка + 2 соболь"],
  ["Норка+Соболь", "Шапка меховая", "", 3, "1 норка + 2 соболь"],
  ["Каракульча", "Шапка меховая", "", 2, "заменить: 2"],
];

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))!.id;
  const row = await prisma.budgetScenario.findFirstOrThrow({ where: { organizationId: org, name: "FW27" } });
  const before = JSON.parse(JSON.stringify(row.lines));
  type Node = { id: string; kind: string; name: string; parentId: string | null; pcs: number; hides: number; src: string; locked: boolean; est?: string };
  const nodes = (row.lines as Node[]).map((n) => ({ ...n }));
  const find = (fur: string, cat: string, len: string) => {
    const f = nodes.find((n) => n.kind === "fur" && n.name === fur);
    const c = nodes.find((n) => n.kind === "cat" && n.name === cat && n.parentId === f?.id);
    if (!len) return c;
    return nodes.find((n) => n.kind === "len" && n.name === len && n.parentId === c?.id);
  };
  const journal: unknown[] = [];
  let bad = 0;
  for (const [fur, cat, len, v, why] of NORMS) {
    const n = find(fur, cat, len);
    const name = `${fur} · ${cat}${len ? ` · ${len}` : ""}`;
    if (!n) { console.log("НЕТ УЗЛА:", name); bad++; continue; }
    const old = Math.round(n.hides * 100) / 100;
    console.log(`${name.padEnd(48)} ${n.pcs} шт.  ${old} → ${v}   (${why})`);
    journal.push({ node: n.id, name, pcs: n.pcs, old: n.hides, new: v, oldSrc: n.src, oldLocked: n.locked, oldEst: n.est ?? null, source: `владелец 01.11.2026: ${why}` });
    Object.assign(n, { hides: v, locked: true, src: "manual" });
    delete n.est;
  }
  if (bad) process.exit(1);
  if (process.argv.includes("--write")) {
    writeFileSync("docs-inventory/budget-fw27-before-2026-11-01.json", JSON.stringify(before));
    writeFileSync("docs-inventory/corrections-journal-budget-fw27-owner-norms-2026-11-01.json", JSON.stringify(journal, null, 1));
    await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: nodes as never } });
    console.log("ЗАПИСАНО");
  }
  process.exit(0);
})();
