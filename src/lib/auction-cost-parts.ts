// Разложение полной стоимости лота «из чего складывается» для режима «Аукцион».
// Чистые функции без серверных зависимостей: части лота считаются на сервере, суммы по
// выбранным лотам — в браузере; «Не разложено» всегда = итог − сумма частей, поэтому
// сумма строк блока по построению равна полной стоимости.
import { classifyLabel } from "@/lib/cost-breakdown-groups";

export type PartKey =
  | "goods"
  | "goodsVat"
  | "fees"
  | "feesVat"
  | "processing"
  | "transport"
  | "broker"
  | "transit"
  | "delivery"
  | "commissionOther"
  | "other";

export type Part = { k: PartKey; incl: number; excl: number };

export const PART_META: { key: PartKey; title: string; hint?: string }[] = [
  { key: "goods", title: "Цена шкур (цена лота × курс)" },
  { key: "goodsVat", title: "НДС на шкуры" },
  { key: "fees", title: "Сборы аукциона", hint: "аукционный + маркетинговый + сбор за доставку" },
  { key: "feesVat", title: "НДС на сборы аукциона" },
  { key: "processing", title: "Выделка / обработка", hint: "«С НДС» — с НДС 22%, «Без НДС» — без него" },
  { key: "transport", title: "Транспорт на выделку и обратно" },
  { key: "broker", title: "Брокерские услуги", hint: "брокерский % от стоимости шкур" },
  { key: "transit", title: "Комиссия за транзит денег" },
  { key: "delivery", title: "Доставка и таможня (из расчёта)" },
  { key: "commissionOther", title: "Прочие комиссии" },
  { key: "other", title: "Прочее из расчёта" },
];

/** Подпись строки расчёта -> часть стоимости (null — не составляющая: подытоги, цена и курс). */
export function partOfLabel(label: string): PartKey | "expenses" | null {
  const s = label.toLowerCase().replace(/ё/g, "е").trim();
  if (s.startsWith("расходы закупки")) return "expenses";
  switch (classifyLabel(label)) {
    case "totals":
    case "auction":
      return null;
    case "auctionFees":
      return s.includes("ндс") ? "feesVat" : "fees";
    case "vat":
      return "goodsVat";
    case "processing":
      return s.includes("транспорт") ? "transport" : "processing";
    case "commission":
      if (s.includes("транзит")) return "transit";
      return s.includes("брокер") || s.startsWith("брок.") ? "broker" : "commissionOther";
    case "delivery":
      return "delivery";
    default:
      return "other";
  }
}

const VAT_IN_LABEL = /с\s*ндс\s*(\d+(?:[.,]\d+)?)\s*%/i;

type Item = { label?: unknown; value?: unknown };

/**
 * Части одного лота (всего по лоту, а не за штуку). goods всегда = цена лота × курс.
 * Без разбивки лот отдаёт только «цену шкур»; остальное попадёт в «Не разложено».
 */
export function lineParts(args: {
  items: unknown;
  qty: number;
  base: number;
  priceIncl: number;
  /** Полная стоимость лота с НДС: разбивка принимается, только если сходится с ней. */
  totalIncl: number;
  source: "lot" | "plan" | "price";
}): { parts: Part[]; expIncl: number } {
  const { qty, base } = args;
  const parts: Part[] = [{ k: "goods", incl: base, excl: base }];
  let expIncl = 0;
  // Без надёжной разбивки известно только: цена шкур и НДС на них (по ставке лота); остальное — «Не разложено».
  const fallback = () => {
    const vat = args.priceIncl - base;
    return { parts: vat > 0.005 ? [parts[0], { k: "goodsVat" as const, incl: vat, excl: 0 }] : [parts[0]], expIncl: 0 };
  };
  if (args.source === "price") return fallback();
  const items = Array.isArray(args.items) ? (args.items as Item[]) : [];
  if (items.length === 0) return fallback();
  const acc = new Map<PartKey, Part>();
  acc.set("goods", parts[0]);
  for (const it of items) {
    if (typeof it.label !== "string") continue;
    const v = Number(it.value);
    if (!Number.isFinite(v)) continue;
    const k = partOfLabel(it.label);
    if (k == null) continue;
    const total = v * qty;
    if (k === "expenses") {
      expIncl += total;
      continue;
    }
    if (k === "goods") continue;
    let excl = total;
    if (k === "goodsVat" || k === "feesVat") excl = 0;
    else if (k === "processing") {
      const m = VAT_IN_LABEL.exec(it.label);
      if (m) excl = total / (1 + Number(m[1].replace(",", ".")) / 100);
    }
    const cur = acc.get(k) ?? { k, incl: 0, excl: 0 };
    cur.incl += total;
    cur.excl += excl;
    acc.set(k, cur);
  }
  // Расчёты из импорта бывают в другом формате (итоги по лоту, подпункты): такую разбивку не используем.
  const sum = Array.from(acc.values()).reduce((a, p) => a + p.incl, 0) + expIncl;
  if (Math.abs(sum - args.totalIncl) > Math.max(1, Math.abs(args.totalIncl) * 2e-4)) return fallback();
  return { parts: Array.from(acc.values()), expIncl };
}

export type ExpenseCat = { name: string; incl: number; excl: number };

export type PartsRow = { totalIncl: number; totalExcl: number; parts: Part[]; expIncl: number; purchaseId: string };
export type PartsPurchase = {
  id: string;
  unallocated: boolean;
  expIncl: number;
  expExcl: number;
  expenses: ExpenseCat[];
  lineCount: number;
};

export type BreakdownLine = { key: string; title: string; hint?: string; incl: number; excl: number; kind: "part" | "expense" | "unresolved" };
export type CostBreakdownResult = {
  lines: BreakdownLine[];
  totalIncl: number;
  totalExcl: number;
  /** Расходы закупок-черновиков, добавленные к итогу (только если выбраны все лоты закупки). */
  unallocatedIncl: number;
  unallocatedExcl: number;
  skippedUnallocated: boolean;
};

/** Сводная стоимость по набору лотов: части, расходы закупок по категориям, «Не разложено». */
export function aggregateCostParts(rows: PartsRow[], purchases: Map<string, PartsPurchase>): CostBreakdownResult {
  const sums = new Map<PartKey, { incl: number; excl: number }>();
  const byPurchase = new Map<string, PartsRow[]>();
  let totalIncl = 0;
  let totalExcl = 0;
  for (const r of rows) {
    totalIncl += r.totalIncl;
    totalExcl += r.totalExcl;
    for (const p of r.parts) {
      const s = sums.get(p.k) ?? { incl: 0, excl: 0 };
      s.incl += p.incl;
      s.excl += p.excl;
      sums.set(p.k, s);
    }
    const a = byPurchase.get(r.purchaseId) ?? [];
    a.push(r);
    byPurchase.set(r.purchaseId, a);
  }

  const expLines = new Map<string, { incl: number; excl: number }>();
  let unallocatedIncl = 0;
  let unallocatedExcl = 0;
  let skippedUnallocated = false;
  for (const [pid, prs] of byPurchase) {
    const meta = purchases.get(pid);
    if (!meta) continue;
    const add = (name: string, incl: number, excl: number) => {
      const c = expLines.get(name) ?? { incl: 0, excl: 0 };
      c.incl += incl;
      c.excl += excl;
      expLines.set(name, c);
    };
    if (meta.unallocated) {
      if (prs.length === meta.lineCount && meta.lineCount > 0) {
        for (const c of meta.expenses) add(c.name, c.incl, c.excl);
        unallocatedIncl += meta.expIncl;
        unallocatedExcl += meta.expExcl;
      } else if (meta.expenses.length > 0) skippedUnallocated = true;
    } else {
      const lineExp = prs.reduce((s, r) => s + r.expIncl, 0);
      if (lineExp > 0 && meta.expIncl > 0) {
        const lineExpExcl = lineExp * (meta.expExcl / meta.expIncl);
        for (const c of meta.expenses) {
          add(c.name, meta.expIncl > 0 ? (c.incl / meta.expIncl) * lineExp : 0, meta.expExcl > 0 ? (c.excl / meta.expExcl) * lineExpExcl : 0);
        }
      }
    }
  }
  totalIncl += unallocatedIncl;
  totalExcl += unallocatedExcl;

  const lines: BreakdownLine[] = [];
  let sumIncl = 0;
  let sumExcl = 0;
  for (const m of PART_META) {
    const s = sums.get(m.key);
    if (!s) continue;
    lines.push({ key: m.key, title: m.title, hint: m.hint, incl: s.incl, excl: s.excl, kind: "part" });
    sumIncl += s.incl;
    sumExcl += s.excl;
  }
  for (const [name, c] of expLines) {
    lines.push({ key: `exp:${name}`, title: `Расходы закупки: ${name}`, incl: c.incl, excl: c.excl, kind: "expense" });
    sumIncl += c.incl;
    sumExcl += c.excl;
  }
  lines.push({
    key: "unresolved",
    title: "Не разложено",
    hint: "нет детализации (старые лоты без разбивки) — остаток до полной стоимости",
    incl: totalIncl - sumIncl,
    excl: totalExcl - sumExcl,
    kind: "unresolved",
  });
  return { lines, totalIncl, totalExcl, unallocatedIncl, unallocatedExcl, skippedUnallocated };
}
