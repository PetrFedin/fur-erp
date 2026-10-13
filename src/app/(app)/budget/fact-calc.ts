// Факт по ТЗ для бюджета: чистые функции без базы (годятся и серверу, и клиенту).
// Источник — те же ТЗ, что на Главной и в разделе «ТЗ» (loadOrdersDrill → DrillOrder): без отменённых, ремонт отдельно, никаких новых формул.
import { normKey, type BudgetNode } from "@/lib/budget-calc";
import { orderCost, type DrillOrder } from "@/lib/dashboard-drill";

/** Сжатая запись факта: ТЗ, сложенные по артикулу, виду меха и категории. Суммы — с НДС, 4% отдельно (как в окне «Стоимость производства»). */
export type FactRow = {
  mid: string; fur: string; cat: string; repair: boolean;
  pcs: number; hides: number; mex: number; lining: number; work: number; c4: number;
  /** Расходы ТЗ + шкуры подрядчика + прочее: входят в себестоимость на Главной, в колонки бюджета (мех, подкладка, работа, 4%) не входят. */
  extra: number;
};
export type FactAgg = { pcs: number; hides: number; mex: number; lining: number; work: number; c4: number; total: number };

export const zeroFact = (): FactAgg => ({ pcs: 0, hides: 0, mex: 0, lining: 0, work: 0, c4: 0, total: 0 });

export function factRows(orders: DrillOrder[]): FactRow[] {
  const m = new Map<string, FactRow>();
  for (const o of orders) {
    const repair = o.cat === "Ремонт";
    const key = `${o.mid}|${o.fur}|${o.cat}`;
    const r = m.get(key) ?? { mid: o.mid, fur: o.fur, cat: o.cat, repair, pcs: 0, hides: 0, mex: 0, lining: 0, work: 0, c4: 0, extra: 0 };
    m.set(key, r);
    r.pcs += o.qty; r.work += o.work;
    let lines = 0;
    for (const l of o.lines) {
      lines += l.i;
      r.c4 += l.ci;
      if (l.k === "l") r.lining += l.i - l.ci; else { r.mex += l.i - l.ci; r.hides += l.q; }
    }
    r.extra += orderCost(o, "incl") - lines;
  }
  return Array.from(m.values());
}

const furKey = (s: string) => { const k = normKey(s); return k === "каракульча" || k === "каракуль" ? "свакара" : k; };

function add(a: FactAgg, r: FactRow): FactAgg {
  a.pcs += r.pcs; a.hides += r.hides; a.mex += r.mex; a.lining += r.lining; a.work += r.work; a.c4 += r.c4;
  a.total = a.mex + a.lining + a.work + a.c4;
  return a;
}

/** Категория ТЗ (справочник категорий) → строка «категория» бюджета (названия по отчёту Budget PCS). Перебор по порядку: берётся первая, которая есть у этого меха в бюджете.
 * Так факт попадает в строку «мех · категория», где ему место, и не остаётся «за бортом». */
const CAT_TARGETS: Record<string, string[]> = {
  "шарф": ["Шарфы"],
  "жилет": ["Жилет меховой"],
  "куртка": ["Куртки меховые"],
  "жакет": ["Куртки меховые", "Шубы"],
  "пальто": ["Пальто меховое", "Шубы"],
  "полупальто": ["Полупальто меховое", "Шубы"],
  "шубаполушубок": ["Шубы"],
  "кейп": ["Шубы"],
  "кардиган": ["Кардиган меховой", "Шубы"],
  "юбка": ["Юбка меховая"],
  "головнойубор": ["Шапка меховая", "Повязка меховая"],
  "варежки": ["Манжеты, муфты, варежки"],
  "манжеты": ["Манжеты, муфты, варежки"],
  "муфта": ["Манжеты, муфты, варежки"],
};
/** Строка бюджета (нормализованное название категории), куда относится категория ТЗ; без совпадения — её собственное название. */
function budgetCat(tzCat: string, have: Set<string>): string {
  const k = normKey(tzCat);
  if (have.has(k)) return k;
  for (const t of CAT_TARGETS[k] ?? []) if (have.has(normKey(t))) return normKey(t);
  return k;
}

/** Факт по каждой строке бюджета. Плановый артикул без артикула в каталоге и строки без ТЗ — null («—»). Правила сопоставления те же, что у автоматического расчёта.
 * lenOf: артикул (ProductModel.id) → длина по справочнику (Short/Regular/Long); артикул без длины в строки-длины не попадает, но входит в факт категории. */
export function factByNode(nodes: BudgetNode[], rows: FactRow[], lenOf: Record<string, string> = {}): Map<string, FactAgg | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const own = rows.filter((r) => !r.repair);
  const out = new Map<string, FactAgg | null>();
  const catsOfFur = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (n.kind !== "cat") continue;
    const f = byId.get(n.parentId ?? "");
    const k = furKey(f?.name || "");
    (catsOfFur.get(k) ?? catsOfFur.set(k, new Set()).get(k)!).add(normKey(n.name));
  }
  const catOf = (r: FactRow) => budgetCat(r.cat, catsOfFur.get(furKey(r.fur)) ?? new Set());
  for (const n of nodes) {
    let cat: BudgetNode | undefined = n.kind === "cat" ? n : undefined;
    for (let c: BudgetNode | undefined = n, i = 0; !cat && c && i < 4; c = byId.get(c.parentId ?? ""), i++) if (c.kind === "cat") cat = c;
    const fur = n.kind === "fur" ? n : cat ? byId.get(cat.parentId ?? "") : undefined;
    // Вид меха факта — только по названию строки «тип сырья»: статистика другого меха (statFur), на которую опирается расчёт цен, на факт не влияет.
    const fk = furKey(fur?.name || "");
    let pick: FactRow[];
    if (n.kind === "fur") pick = own.filter((r) => furKey(r.fur) === fk);
    // Категория — по названию строки (статистика другой категории, на которую опирается расчёт цен, на факт не влияет: иначе факт задвоится).
    else if (n.kind === "cat") pick = own.filter((r) => furKey(r.fur) === fk && catOf(r) === normKey(n.name));
    // Длина — ТЗ той же категории по артикулам этой длины.
    else if (n.kind === "len") pick = cat ? own.filter((r) => furKey(r.fur) === fk && catOf(r) === normKey(cat.name) && normKey(lenOf[r.mid] ?? "") === normKey(n.name)) : [];
    else pick = n.modelId ? own.filter((r) => furKey(r.fur) === fk && r.mid === n.modelId) : [];
    out.set(n.id, pick.length ? pick.reduce(add, zeroFact()) : null);
  }
  return out;
}

export function factTotals(rows: FactRow[]) {
  const all = zeroFact();
  /** Ремонт — отдельно, не выпуск изделий; cost с работой. */
  const rep = { pcs: 0, cost: 0 };
  let extra = 0;
  for (const r of rows) {
    if (r.repair) { rep.pcs += r.pcs; rep.cost += r.mex + r.lining + r.c4 + r.extra + r.work; continue; }
    add(all, r); extra += r.extra;
  }
  return { all, repair: rep, extra };
}

/** Отклонение: факт к бюджету, % ((факт ÷ бюджет − 1) × 100); null — если нечего сравнивать. */
export const factDev = (fact: number | undefined, budget: number) => (fact && fact > 0 && budget > 0 ? (fact / budget - 1) * 100 : null);
