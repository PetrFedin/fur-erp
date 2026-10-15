// Таблица «Объёмы по группам меха и категориям» (Главная): деньги в целых рублях, сходящиеся по дереву. Правило — src/lib/money-round.ts.
// Чистые функции без React: их вызывает ProductionTable, а scripts/test-rounding-rule.ts проверяет на реальных данных.
import { alignColumn, lrAllocate, roundRub } from "@/lib/money-round";

/** Узел дерева таблицы: деньги колонок и дочерние узлы (структурно совместим с Agg из production-table.tsx). */
export type MoneyNode = { fur: number; lining: number; c4: number; other: number; work: number; orders: Map<string, unknown>; children: Map<string, MoneyNode> };
const nodeCost = (g: MoneyNode) => g.fur + g.lining + g.c4 + g.other + g.work;

/** Денежные колонки таблицы: мех, подкладка, работа, 4%, расходы и прочее. «Сумма производства» = их сумма. */
export type Money5 = { fur: number; lining: number; work: number; c4: number; other: number };
const MCOLS = ["fur", "lining", "work", "c4", "other"] as const;
export const money5 = (g: Money5): Money5 => ({ fur: g.fur, lining: g.lining, work: g.work, c4: g.c4, other: g.other });
export const sum5 = (m: Money5) => m.fur + m.lining + m.work + m.c4 + m.other;
/**
 * Целые рубли, сходящиеся по дереву (src/lib/money-round.ts): итог = round(точной суммы), колонки итога делят его наибольшими остатками,
 * строки каждого уровня складываются в показанные колонки родителя; «Сумма производства» строки = сумма её показанных колонок.
 */
export function alignTree(top: MoneyNode[], total: MoneyNode, repair: MoneyNode | null, all: MoneyNode, out: Map<MoneyNode, Money5>) {
  const split = (g: MoneyNode): Money5 => {
    const v = lrAllocate(MCOLS.map((c) => g[c]), roundRub(nodeCost(g)));
    return { fur: v[0], lining: v[1], work: v[2], c4: v[3], other: v[4] };
  };
  const under = (parent: Money5, nodes: MoneyNode[]) => {
    const cols = MCOLS.map((c) => alignColumn(nodes.map((n) => n[c]), parent[c]).values);
    nodes.forEach((n, i) => {
      const m: Money5 = { fur: cols[0][i], lining: cols[1][i], work: cols[2][i], c4: cols[3][i], other: cols[4][i] };
      out.set(n, m);
      if (n.children.size > 0) under(m, Array.from(n.children.values()));
    });
  };
  if (repair && repair.orders.size > 0) {
    const a = split(all);
    out.set(all, a);
    const cols = MCOLS.map((c) => alignColumn([total[c], repair[c]], a[c]).values);
    const t: Money5 = { fur: cols[0][0], lining: cols[1][0], work: cols[2][0], c4: cols[3][0], other: cols[4][0] };
    out.set(total, t);
    out.set(repair, { fur: cols[0][1], lining: cols[1][1], work: cols[2][1], c4: cols[3][1], other: cols[4][1] });
    under(t, top);
  } else {
    const t = split(total);
    out.set(total, t); out.set(all, t);
    under(t, top);
  }
}
