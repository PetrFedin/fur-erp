// Бюджет сезона: чистый расчёт (без базы и React) — им пользуются страница /budget и серверные действия.
// Строка бюджета = «мех × категория»: бюджет изделий × (шкур на изделие × цена шкуры + подкладка + работа) + надбавка 4% на мех и подкладку.
// Значения FW (hides, hidePrice, meters, meterPrice, work) редактируются руками; «автоматический расчёт» заполняет их из статистики системы
// (средневзвешенно по ТЗ) с настраиваемыми надбавками, но не трогает строки с замочком.

export type BudgetParams = {
  /** Надбавка к средневзвешенной цене шкуры, %. */
  upFur: number;
  /** Надбавка к цене подкладки, %. */
  upLining: number;
  /** Надбавка к стоимости работы на изделие, %. */
  upWork: number;
  /** Надбавка 4% на мех и подкладку (как в системе), %. */
  c4: number;
};

export const DEFAULT_PARAMS: BudgetParams = { upFur: 10, upLining: 10, upWork: 10, c4: 4 };

/** Текущие (по данным системы) значения на одно изделие — основа для надбавок и колонки «сейчас». */
export type BudgetBase = { hides: number; hidePrice: number; meters: number; meterPrice: number; work: number };

export type BudgetLine = {
  id: string;
  /** Тип меха в бюджете: Соболь, Норка, Норка+Соболь, Лиса, Каракульча, Рысь. */
  fur: string;
  /** Категория в бюджете: Шубы, Жилет меховой, Шарфы… */
  cat: string;
  /** Бюджет изделий, шт. */
  pcs: number;
  /** По какой статистике системы считать (мех и категория ТЗ в системе); пусто — вручную. */
  statFur: string;
  statCat: string;
  /** Замочек: строка не пересчитывается автоматически, значения ручные. */
  locked: boolean;
  /** Значения FW на одно изделие (с надбавками), редактируются. */
  hides: number;
  hidePrice: number;
  meters: number;
  meterPrice: number;
  work: number;
  /** Текущие значения системы (без надбавок); null — нет данных. */
  base: BudgetBase | null;
  /** Изделий в основе статистики. */
  sample: number;
};

/** Статистика системы по паре «мех|категория» (src/lib/budget-stats.ts). */
export type BudgetStat = { key: string; fur: string; cat: string; qty: number; orders: number; hidesPer: number; hidePrice: number; metersPer: number; meterPrice: number; workPer: number };

export type LineCalc = {
  totalHides: number; mex: number; totalMeters: number; lining: number; workSum: number; c4: number; total: number;
  perUnit: number | null; nowPerUnit: number | null; nowTotal: number | null; sampleLabel: "ок" | "малая выборка" | "нет данных" | "вручную";
};

const num = (v: number) => (Number.isFinite(v) ? v : 0);

export function calcLine(l: BudgetLine, p: BudgetParams): LineCalc {
  const totalHides = num(l.pcs * l.hides);
  const mex = totalHides * num(l.hidePrice);
  const totalMeters = num(l.pcs * l.meters);
  const lining = totalMeters * num(l.meterPrice);
  const workSum = num(l.pcs * l.work);
  const c4 = (mex + lining) * (p.c4 / 100);
  const total = mex + lining + workSum + c4;
  let nowPerUnit: number | null = null;
  if (l.base) nowPerUnit = (l.base.hides * l.base.hidePrice + l.base.meters * l.base.meterPrice) * (1 + p.c4 / 100) + l.base.work;
  const sampleLabel: LineCalc["sampleLabel"] = l.locked && !l.base ? "вручную" : l.sample <= 0 ? (l.locked ? "вручную" : "нет данных") : l.sample < 10 ? "малая выборка" : "ок";
  return { totalHides, mex, totalMeters, lining, workSum, c4, total, perUnit: l.pcs > 0 ? total / l.pcs : null, nowPerUnit, nowTotal: nowPerUnit == null ? null : nowPerUnit * l.pcs, sampleLabel };
}

export type Totals = { pcs: number; pcsCalc: number; hides: number; mex: number; meters: number; lining: number; work: number; c4: number; total: number; nowTotal: number; nowPcs: number };

export function sumLines(lines: BudgetLine[], p: BudgetParams): Totals {
  const t: Totals = { pcs: 0, pcsCalc: 0, hides: 0, mex: 0, meters: 0, lining: 0, work: 0, c4: 0, total: 0, nowTotal: 0, nowPcs: 0 };
  for (const l of lines) {
    const c = calcLine(l, p);
    t.pcs += l.pcs;
    if (c.total > 0 || l.locked) t.pcsCalc += l.pcs;
    t.hides += c.totalHides; t.mex += c.mex; t.meters += c.totalMeters; t.lining += c.lining; t.work += c.workSum; t.c4 += c.c4; t.total += c.total;
    if (c.nowTotal != null) { t.nowTotal += c.nowTotal; t.nowPcs += l.pcs; }
  }
  return t;
}

/** Значения FW из базы системы и надбавок. */
export function fromBase(b: BudgetBase, p: BudgetParams): Pick<BudgetLine, "hides" | "hidePrice" | "meters" | "meterPrice" | "work"> {
  return { hides: b.hides, hidePrice: b.hidePrice * (1 + p.upFur / 100), meters: b.meters, meterPrice: b.meterPrice * (1 + p.upLining / 100), work: b.work * (1 + p.upWork / 100) };
}

/** Автоматический расчёт: строки без замочка заполняются из статистики системы; строки с замочком не меняются. */
export function autoCalc(lines: BudgetLine[], stats: BudgetStat[], p: BudgetParams): BudgetLine[] {
  const by = new Map(stats.map((s) => [s.key, s]));
  return lines.map((l) => {
    if (l.locked) return l;
    const s = by.get(`${l.statFur}|${l.statCat}`);
    if (!s) return { ...l, base: null, sample: 0 };
    const base: BudgetBase = { hides: s.hidesPer, hidePrice: s.hidePrice, meters: s.metersPer, meterPrice: s.meterPrice, work: s.workPer };
    return { ...l, base, sample: s.qty, ...fromBase(base, p) };
  });
}

/** Смена надбавок: незаблокированные строки с базой пересчитывают цены из базы без обращения к статистике. */
export function reapplyParams(lines: BudgetLine[], p: BudgetParams): BudgetLine[] {
  return lines.map((l) => (l.locked || !l.base ? l : { ...l, ...fromBase(l.base, p) }));
}

const mk = (id: string, fur: string, cat: string, pcs: number, statFur: string, statCat: string): BudgetLine => ({ id, fur, cat, pcs, statFur, statCat, locked: false, hides: 0, hidePrice: 0, meters: 0, meterPrice: 0, work: 0, base: null, sample: 0 });
const lynx = (id: string, cat: string, pcs: number, statCat: string, v: { hides: number; hidePrice: number; meters: number; meterPrice: number; work: number }, base: BudgetBase): BudgetLine => ({ ...mk(id, "Рысь", cat, pcs, "Рысь", statCat), locked: true, ...v, base, sample: 0 });

/** Бюджет FW27 (Budget PCS, 880 изд.) и соответствие категорий бюджета категориям системы. Рысь — вручную (расчёт LYNX MVST FW26), остальное — по данным системы. */
export function defaultLines(): BudgetLine[] {
  return [
    mk("s1", "Соболь", "Шубы", 86, "Соболь", "Пальто"), mk("s2", "Соболь", "Жилет меховой", 26, "Соболь", "Жилет"), mk("s3", "Соболь", "Куртки меховые", 10, "Соболь", "Куртка"),
    mk("s4", "Соболь", "Кардиган меховой", 8, "Соболь", "Жакет"), mk("s5", "Соболь", "Шарфы", 48, "Соболь", "Шарф"), mk("s6", "Соболь", "Шапка меховая", 34, "Соболь", "Головной убор"),
    mk("s7", "Соболь", "Повязка меховая", 18, "Соболь", "Головной убор"), mk("s8", "Соболь", "Манжеты, муфты, варежки", 20, "Норка + Соболь", "Варежки"),
    mk("n1", "Норка", "Шубы", 110, "Норка", "Пальто"), mk("n2", "Норка", "Жилет меховой", 95, "Норка", "Жилет"), mk("n3", "Норка", "Куртки меховые", 45, "Норка", "Куртка"),
    mk("n4", "Норка", "Шарфы", 55, "Норка", "Шарф"), mk("n5", "Норка", "Шапка меховая", 10, "Норка", "Головной убор"), mk("n6", "Норка", "Повязка меховая", 70, "Норка", "Головной убор"),
    mk("n7", "Норка", "Манжеты, муфты, варежки", 15, "Норка", "Варежки"),
    mk("m1", "Норка+Соболь", "Шубы", 14, "Норка + Соболь", "Полупальто"), mk("m2", "Норка+Соболь", "Полупальто меховое", 16, "Норка + Соболь", "Полупальто"), mk("m3", "Норка+Соболь", "Шапка меховая", 20, "Норка + Соболь", "Головной убор"),
    mk("l1", "Лиса", "Шубы", 70, "Лиса", "Шуба / полушубок"), mk("l2", "Лиса", "Шарфы", 25, "Лиса", "Шарф"),
    mk("k1", "Каракульча", "Куртки меховые", 35, "Свакара", "Куртка"), mk("k2", "Каракульча", "Пальто меховое", 25, "Свакара", "Пальто"),
    lynx("r1", "Шубы", 10, "Шуба", { hides: 54, hidePrice: 260000, meters: 2.7, meterPrice: 4967, work: 550000 }, { hides: 54, hidePrice: 243000, meters: 2.7, meterPrice: 4515, work: 500000 }),
    lynx("r2", "Шарфы", 5, "Шарф", { hides: 3, hidePrice: 260000, meters: 0, meterPrice: 0, work: 65000 }, { hides: 3, hidePrice: 243000, meters: 0, meterPrice: 0, work: 59091 }),
    lynx("r3", "Шапка меховая", 10, "Головной убор", { hides: 1.5, hidePrice: 260000, meters: 0, meterPrice: 0, work: 28000 }, { hides: 1.5, hidePrice: 243000, meters: 0, meterPrice: 0, work: 25455 }),
  ];
}

export const FUR_ORDER = ["Соболь", "Норка", "Норка+Соболь", "Лиса", "Каракульча", "Рысь"];
export const furRank = (f: string) => { const i = FUR_ORDER.indexOf(f); return i < 0 ? 99 : i; };
