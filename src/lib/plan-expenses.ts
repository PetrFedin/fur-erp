// «Расходы» закупки, заложенные в расчёт лотов (PurchaseItem.costPlan): сборы аукциона, выделка, транспорт, таможня, упаковка,
// брокерский, комиссия за транзит. Это не PurchaseExpense: они уже входят в стоимость единицы (unitCostInclVat), поэтому
// отдельной строкой в итог закупки не добавляются — иначе себестоимость удвоилась бы. Здесь они только показываются.
// Чистые функции без базы.
import { CAT_LABEL, COMP_CATS, itemsOfBreakdown, lotComposition } from "@/lib/price-composition";

export type PlanExpenseLine = { key: string; label: string; incl: number };

const RULES: { key: string; label: string; test: (l: string) => boolean }[] = [
  { key: "fee", label: "Сборы аукциона (с НДС)", test: (l) => l.startsWith("аукционный сбор") || (l.startsWith("ндс") && l.includes("на аукционный сбор")) },
  { key: "dressing", label: "Выделка (с НДС)", test: (l) => l.startsWith("выделка") },
  { key: "transport", label: "Транспорт", test: (l) => l.startsWith("транспорт") },
  { key: "customs", label: "Таможня и таможенные платежи", test: (l) => l.startsWith("таможня") },
  { key: "packing", label: "Упаковка и прочее", test: (l) => l.startsWith("упаковка") },
  { key: "broker", label: "Брокерский %", test: (l) => l.startsWith("брокерский") },
  { key: "transit", label: "Комиссия за транзит денег", test: (l) => l.startsWith("комиссия за транзит") },
];

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Расходы всех позиций закупки по статьям, ₽ с НДС за все шкуры. Позиции без расчёта не учитываются. */
export function planExpenseLines(items: { quantity: unknown; vatRate?: unknown; costPlan: unknown }[]): { lines: PlanExpenseLine[]; total: number; planItems: number } {
  const acc = new Map<string, PlanExpenseLine>();
  const add = (key: string, label: string, v: number) => {
    if (Math.abs(v) < 0.005) return;
    const cur = acc.get(key) ?? { key, label, incl: 0 };
    cur.incl += v;
    acc.set(key, cur);
  };
  let planItems = 0;
  for (const it of items) {
    const cp = it.costPlan as { costBreakdown?: unknown; unitCostInclVat?: unknown } | null | undefined;
    if (!cp || typeof cp !== "object") continue;
    const q = n(it.quantity);
    const rows = itemsOfBreakdown(cp.costBreakdown);
    if (rows.length === 0 || q <= 0) continue;
    planItems += 1;
    if (rows.some((r) => r.label === "Итого себестоимость за единицу, ₽")) {
      // расчёт позиции: суммы строк — ₽ за шкуру
      for (const r of rows) {
        const l = r.label.toLowerCase();
        const rule = RULES.find((x) => x.test(l));
        if (rule) add(rule.key, rule.label, r.value * q);
      }
    } else {
      // расчётные листы лотов других видов: по секторам состава цены (кроме «Сырья»)
      const comp = lotComposition({ breakdown: null, plans: [cp], vatRate: n(it.vatRate), qty: q, totalIncl: n(cp.unitCostInclVat) * q });
      if (!comp) continue;
      for (const c of COMP_CATS) if (c.key !== "raw") add(`cat:${c.key}`, CAT_LABEL[c.key], comp.incl[c.key]);
    }
  }
  const lines = [...acc.values()].sort((a, b) => b.incl - a.incl);
  return { lines, total: lines.reduce((s, l) => s + l.incl, 0), planItems };
}
