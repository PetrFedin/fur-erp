// Бюджет FW27: цена шкуры рыси = средняя цена заказанного (как в Excel «Сырьё и бюджет FW27» и Budget PCS) + надбавка на мех (10 %).
// Было вручную 260 000 ₽ (расчёт FW26 243 000 ₽ + 7 %). Решение владельца 02.11.2026. Прежние узлы — docs-inventory/budget-fw27-before-lynx-2026-11-02.json.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-budget-fw27-lynx-price-2026-11-02.ts [--write]
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))!.id;
  const { loadRawBalance } = await import("../src/lib/raw-balance");
  const base = (await loadRawBalance(org)).price["Рысь"];
  if (!(base > 0)) throw new Error("нет цены рыси");
  const row = await prisma.budgetScenario.findFirstOrThrow({ where: { organizationId: org, name: "FW27" } });
  const up = 1 + (((row.params as { upFur?: number } | null)?.upFur ?? 10) / 100);
  const nodes = (row.lines as { id: string; kind: string; name: string; parentId: string | null; hidePrice: number; base?: { hidePrice: number } | null; upFur?: number | null }[]).map((n) => ({ ...n }));
  const lynx = nodes.find((n) => n.kind === "fur" && n.name === "Рысь");
  if (!lynx) throw new Error("нет узла «Рысь»");
  const under = new Set([lynx.id]);
  for (let grew = true; grew;) { grew = false; for (const n of nodes) if (n.parentId && under.has(n.parentId) && !under.has(n.id)) { under.add(n.id); grew = true; } }
  const price = Math.round(base * up * 100) / 100;
  let n = 0;
  for (const x of nodes) {
    if (!under.has(x.id) || x.kind === "fur") continue;
    console.log(`${x.kind} ${x.name}: ${Math.round(x.hidePrice)} → ${Math.round(price)} (без роста ${Math.round(base)})`);
    x.hidePrice = price;
    if (x.base) x.base = { ...x.base, hidePrice: base };
    n++;
  }
  console.log(`узлов рыси: ${n}; цена заказанного ${base.toFixed(2)} × ${up} = ${price}`);
  if (process.argv.includes("--write")) {
    writeFileSync("docs-inventory/budget-fw27-before-lynx-2026-11-02.json", JSON.stringify(row.lines));
    await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: nodes as never } });
    console.log("ЗАПИСАНО");
  }
  process.exit(0);
})();
