// Единый набор показателей для «Изделий» и «Цен»: одни и те же формулы на любом уровне группировки
// (ТЗ, партия, категория, артикул, мех, размер, цвет, год, модель). Чистые функции без обращения к БД.
// Среднее — ТОЛЬКО средневзвешенное (отношение сумм). Вес и знаменатель у каждого показателя свои — см. подсказки COLUMNS.
import type { OrderRow } from "@/lib/analytics-orders";

export type Metrics = {
  orders: number;
  units: number;
  /** Σ себестоимости системы (мех + подкладка + 4% по режиму + расходы) по ТЗ с известной себестоимостью, с НДС / без НДС. */
  unitsCosted: number;
  costIncl: number;
  costExcl: number;
  /** Разброс себестоимости единицы между ТЗ (мин–макс), без работы и с работой. */
  minCostIncl: number | null;
  maxCostIncl: number | null;
  minCostExcl: number | null;
  maxCostExcl: number | null;
  /** Полная себестоимость = система + работа (по тем же ТЗ). */
  fullIncl: number;
  fullExcl: number;
  minFullIncl: number | null;
  maxFullIncl: number | null;
  minFullExcl: number | null;
  maxFullExcl: number | null;
  /** Работа: Σ и единицы в ТЗ с ценой работы. */
  work: number;
  unitsWork: number;
  /** Шкуры: Σ и единицы в ТЗ, где списан мех. */
  skins: number;
  unitsSkins: number;
  /** Стоимость меха (в режиме 4%: вместе с надбавкой на мех) по ТЗ, где списан мех. */
  furIncl: number;
  furExcl: number;
  /** Подкладка, м: Σ и единицы в ТЗ, где списана подкладка. */
  liningM: number;
  unitsLin: number;
  /** Молоток: Σ ₽ по шкурам с данными и сколько это шкур; лоты меха — всего и с молотком. */
  hammerIncl: number;
  hammerExcl: number;
  hammerSkins: number;
  lots: number;
  lotsHammer: number;
  /** Структура полной себестоимости (с НДС) по ТЗ с известной себестоимостью. */
  sFur: number;
  sLining: number;
  sC4: number;
  sExpenses: number;
  sWork: number;
};

const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
const minOf = (a: number[]) => (a.length ? Math.min(...a) : null);
const maxOf = (a: number[]) => (a.length ? Math.max(...a) : null);

export function computeMetrics(rows: OrderRow[]): Metrics {
  const costed = rows.filter((r) => r.costIncl > 0);
  const cq = costed.filter((r) => r.qty > 0);
  const withSkins = rows.filter((r) => r.furQty > 0);
  const withLin = rows.filter((r) => r.liningQty > 0);
  const withWork = rows.filter((r) => r.work > 0);
  const furLotIds = new Set<string>();
  const hamLotIds = new Set<string>();
  for (const r of rows)
    for (const l of r.lines) {
      if (l.isLining) continue;
      furLotIds.add(l.lotId);
      if (l.hammerExcl != null) hamLotIds.add(l.lotId);
    }
  return {
    orders: rows.length,
    units: sum(rows, (r) => r.qty),
    unitsCosted: sum(costed, (r) => r.qty),
    costIncl: sum(costed, (r) => r.costIncl),
    costExcl: sum(costed, (r) => r.costExcl),
    minCostIncl: minOf(cq.map((r) => r.costIncl / r.qty)),
    maxCostIncl: maxOf(cq.map((r) => r.costIncl / r.qty)),
    minCostExcl: minOf(cq.map((r) => r.costExcl / r.qty)),
    maxCostExcl: maxOf(cq.map((r) => r.costExcl / r.qty)),
    fullIncl: sum(costed, (r) => r.costIncl + r.work),
    fullExcl: sum(costed, (r) => r.costExcl + r.work),
    minFullIncl: minOf(cq.map((r) => (r.costIncl + r.work) / r.qty)),
    maxFullIncl: maxOf(cq.map((r) => (r.costIncl + r.work) / r.qty)),
    minFullExcl: minOf(cq.map((r) => (r.costExcl + r.work) / r.qty)),
    maxFullExcl: maxOf(cq.map((r) => (r.costExcl + r.work) / r.qty)),
    work: sum(withWork, (r) => r.work),
    unitsWork: sum(withWork, (r) => r.qty),
    skins: sum(withSkins, (r) => r.furQty),
    unitsSkins: sum(withSkins, (r) => r.qty),
    furIncl: sum(withSkins, (r) => r.furIncl + r.c4FurIncl),
    furExcl: sum(withSkins, (r) => r.furExcl + r.c4FurExcl),
    liningM: sum(withLin, (r) => r.liningQty),
    unitsLin: sum(withLin, (r) => r.qty),
    hammerIncl: sum(rows, (r) => r.hammerIncl),
    hammerExcl: sum(rows, (r) => r.hammerExcl),
    hammerSkins: sum(rows, (r) => r.hammerSkins),
    lots: furLotIds.size,
    lotsHammer: hamLotIds.size,
    sFur: sum(costed, (r) => r.furIncl),
    sLining: sum(costed, (r) => r.liningIncl),
    sC4: sum(costed, (r) => r.c4Incl),
    sExpenses: sum(costed, (r) => r.expenses),
    sWork: sum(costed, (r) => r.work),
  };
}

/** Среднее взвешенное = отношение сумм; нет знаменателя — null. */
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export type Pair = { incl: number; excl: number } | null;
const pair = (i: number, e: number, den: number): Pair => (den > 0 ? { incl: i / den, excl: e / den } : null);

/** Средние значения показателей (все — взвешенные). */
export function derived(m: Metrics) {
  const structTotal = m.sFur + m.sLining + m.sC4 + m.sExpenses + m.sWork;
  const sh = (x: number) => (structTotal > 0 ? x / structTotal : null);
  return {
    skinsPerUnit: ratio(m.skins, m.unitsSkins),
    liningPerUnit: ratio(m.liningM, m.unitsLin),
    furPerUnit: pair(m.furIncl, m.furExcl, m.unitsSkins),
    furPerSkin: pair(m.furIncl, m.furExcl, m.skins),
    hammerPerSkin: pair(m.hammerIncl, m.hammerExcl, m.hammerSkins),
    hammerSkinShare: ratio(m.hammerSkins, m.skins),
    hammerLotShare: ratio(m.lotsHammer, m.lots),
    workPerUnit: ratio(m.work, m.unitsWork),
    costPerUnit: pair(m.costIncl, m.costExcl, m.unitsCosted),
    fullPerUnit: pair(m.fullIncl, m.fullExcl, m.unitsCosted),
    shFur: sh(m.sFur),
    shLining: sh(m.sLining),
    shC4: sh(m.sC4),
    shWork: sh(m.sWork),
    shExpenses: sh(m.sExpenses),
  };
}
export type Derived = ReturnType<typeof derived>;

// ───────────────────────────── Колонки ─────────────────────────────

export type ColKey =
  | "orders"
  | "units"
  | "share"
  | "skinsUnit"
  | "skins"
  | "liningUnit"
  | "liningSum"
  | "furUnit"
  | "furSkin"
  | "hammer"
  | "hammerCov"
  | "work"
  | "costUnit"
  | "fullUnit"
  | "costSum"
  | "struct";

export type ColDef = {
  label: string;
  /** Подсказка: что в колонке и по какой формуле (InfoHint). */
  hint: string;
  /** Колонка есть в обычном наборе (без «показать все параметры»). */
  basic: boolean;
  /** Значение для сортировки (всегда «с НДС»; null — в конец списка при любом направлении). */
  sort: (m: Metrics, total: Metrics) => number | null;
};

export const COLUMNS: Record<ColKey, ColDef> = {
  orders: { label: "ТЗ", basic: true, hint: "Сколько ТЗ в строке (отменённые не считаются).", sort: (m) => m.orders },
  units: { label: "Единиц", basic: true, hint: "Σ изделий: выпущено, а если не указано — план по ТЗ.", sort: (m) => m.units },
  share: { label: "Доля", basic: true, hint: "Единицы строки ÷ единицы всех строк таблицы.", sort: (m, t) => ratio(m.units, t.units) },
  skinsUnit: {
    label: "Шкур на ед.",
    basic: true,
    hint: "Σ списанных шкур ÷ Σ единиц — только по ТЗ, где мех списан (средневзвешенно: вес — единицы). Шкура — единица измерения лота меха.",
    sort: (m) => derived(m).skinsPerUnit,
  },
  skins: { label: "Σ шкур", basic: false, hint: "Сколько шкур списано в ТЗ строки.", sort: (m) => m.skins },
  liningUnit: {
    label: "Подкладка, м на ед.",
    basic: false,
    hint: "Σ метров подкладки ÷ Σ единиц по ТЗ, где подкладка списана (средневзвешенно: вес — единицы). ТЗ без подкладки в среднее не входят — на них есть фильтр «только с подкладкой».",
    sort: (m) => derived(m).liningPerUnit,
  },
  liningSum: { label: "Σ подкладки, м", basic: false, hint: "Сколько метров подкладки списано в ТЗ строки.", sort: (m) => m.liningM },
  furUnit: {
    label: "Мех за ед.",
    basic: false,
    hint: "Стоимость меха (по лотам, с учётом выбранного режима 4%) ÷ Σ единиц по ТЗ, где мех списан. Средневзвешенно: вес — единицы.",
    sort: (m) => derived(m).furPerUnit?.incl ?? null,
  },
  furSkin: {
    label: "Мех за шкуру",
    basic: false,
    hint: "Стоимость меха по лотам (полная: молоток + сборы + выделка + НДС + расходы лота; с учётом режима 4%) ÷ Σ шкур. Средневзвешенно: вес — шкуры.",
    sort: (m) => derived(m).furPerSkin?.incl ?? null,
  },
  hammer: {
    label: "Молоток за шкуру",
    basic: true,
    hint: "Цена шкуры на аукционе до сборов, выделки и комиссий (молоток), в ₽ по курсу лота. Σ(молоток × шкуры) ÷ Σ шкур — только по лотам, где молоток записан в расчёте лота; остальные лоты в среднее не входят, в ячейке — доля шкур с данными. 4% на молоток не начисляется.",
    sort: (m) => derived(m).hammerPerSkin?.incl ?? null,
  },
  hammerCov: {
    label: "Молоток: данные",
    basic: false,
    hint: "Какая доля лотов меха (и шкур) имеет молоток в расчёте. Где молотка нет — «нет данных»: такие лоты не считаются в среднее молотка.",
    sort: (m) => derived(m).hammerSkinShare,
  },
  work: {
    label: "Работа за ед.",
    basic: true,
    hint: "Σ (цена работы по ТЗ × количество) ÷ Σ единиц по ТЗ с ценой работы (средневзвешенно: вес — единицы). В себестоимость системы не входит.",
    sort: (m) => derived(m).workPerUnit,
  },
  costUnit: {
    label: "Себестоимость за ед.",
    basic: true,
    hint: "Мех + подкладка + 4% (по режиму) + расходы ТЗ, без работы — как в «Партиях» и «Изделиях». Σ себестоимости ÷ Σ единиц по ТЗ с известной себестоимостью; ниже — разброс между ТЗ (мин–макс).",
    sort: (m) => derived(m).costPerUnit?.incl ?? null,
  },
  fullUnit: {
    label: "Полная себестоимость за ед.",
    basic: true,
    hint: "Производство целиком: мех + подкладка + 4% (по режиму) + расходы + работа. (Σ себестоимости + Σ работы) ÷ Σ единиц по ТЗ с известной себестоимостью; ниже — разброс между ТЗ (мин–макс).",
    sort: (m) => derived(m).fullPerUnit?.incl ?? null,
  },
  costSum: { label: "Σ себестоимости", basic: true, hint: "Сумма себестоимости системы (без работы) по ТЗ с известной себестоимостью.", sort: (m) => (m.costIncl > 0 ? m.costIncl : null) },
  struct: {
    label: "Структура",
    basic: false,
    hint: "Доли в полной себестоимости (с НДС): мех, подкладка, 4%, работа, расходы ТЗ — Σ статьи ÷ Σ всех статей по ТЗ с известной себестоимостью. Сортировка — по доле меха.",
    sort: (m) => derived(m).shFur,
  },
};

export const COL_KEYS = Object.keys(COLUMNS) as ColKey[];
export const BASIC_COLS = COL_KEYS.filter((k) => COLUMNS[k].basic);

/** Выбранные колонки: cols=… (список), иначе all=1 — все, иначе обычный набор. */
export function parseCols(raw: string[], all: boolean): ColKey[] {
  const picked = raw.flatMap((s) => s.split(",")).map((s) => s.trim()).filter((s): s is ColKey => s in COLUMNS);
  const set = new Set(picked);
  if (set.size > 0) return COL_KEYS.filter((k) => set.has(k));
  return all ? COL_KEYS : BASIC_COLS;
}

export type SortDir = "asc" | "desc";

/** Порядок: label — по названию строки; иначе ключ колонки. Пустой sort — порядок по умолчанию. */
export function parseSort(sort: string, dir: string): { sort: ColKey | "label" | ""; dir: SortDir } {
  const s = sort === "label" || sort in COLUMNS ? (sort as ColKey | "label") : "";
  return { sort: s, dir: dir === "asc" ? "asc" : "desc" };
}

/** Стабильная сортировка: пустые значения — всегда в конце. label сортирует по названию (natural, ru). */
export function sortItems<T extends { label: string; m: Metrics }>(items: T[], sort: ColKey | "label" | "", dir: SortDir, total: Metrics): T[] {
  if (!sort) return items;
  const k = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort === "label") return k * a.label.localeCompare(b.label, "ru", { numeric: true });
    const va = COLUMNS[sort].sort(a.m, total);
    const vb = COLUMNS[sort].sort(b.m, total);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return k * (va - vb) || a.label.localeCompare(b.label, "ru", { numeric: true });
  });
}
