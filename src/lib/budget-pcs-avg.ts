import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PARAMS, childrenMap, computeTree, parseNodes } from "@/lib/budget-calc";
import type { PcsRow } from "@/lib/budget-pcs";

/** Норма шкур на изделие из бюджета FW27 системы: «мех|категория|длина» → шкур на изделие (шкуры ÷ штуки узла). */
export type BudgetAvg = { map: Map<string, number>; pcs: number; hides: number };
export const avgKey = (fur: string, cat: string, len: string) => `${fur}|${cat}|${len}`;

export async function loadBudgetAvg(orgId: string): Promise<BudgetAvg | null> {
  const row = await prisma.budgetScenario.findFirst({ where: { organizationId: orgId, name: "FW27" } });
  if (!row) return null;
  const params = { ...DEFAULT_PARAMS, ...(row.params as object) };
  const nodes = parseNodes(row.lines);
  const calc = computeTree(nodes, params);
  const kids = childrenMap(nodes);
  const map = new Map<string, number>();
  let pcs = 0, hides = 0;
  for (const f of nodes.filter((n) => n.kind === "fur")) {
    const fa = calc.get(f.id); pcs += fa?.pcs ?? 0; hides += fa?.hides ?? 0;
    for (const c of kids.get(f.id) ?? []) {
      const put = (len: string, id: string) => { const a = calc.get(id); if (a && a.pcs > 0 && a.hides > 0) map.set(avgKey(f.name, c.name, len), a.hides / a.pcs); };
      put("", c.id);
      for (const l of (kids.get(c.id) ?? []).filter((x) => x.kind === "len")) put(l.name, l.id);
    }
  }
  return { map, pcs, hides };
}

/** Подставляет норму бюджета в строки: точное совпадение «мех|категория|длина», иначе «мех|категория». */
export function withBudgetAvg(rows: PcsRow[], b: BudgetAvg | null): PcsRow[] {
  if (!b) return rows;
  return rows.map((r) => ({ ...r, avgB: b.map.get(avgKey(r.fur, r.cat, r.len)) ?? b.map.get(avgKey(r.fur, r.cat, "")) ?? null }));
}
