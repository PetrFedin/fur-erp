// Бюджет: чистый расчёт (без базы и React) — им пользуются страницы /budget, серверные действия и сравнение версий.
//
// Бюджет = дерево «тип сырья (fur) → категория (cat) → артикул (art)». Значения вводятся на листе дерева:
// у артикула, а если у категории нет артикулов — у самой категории. Итоги родителей — суммы по листьям.
// Лист: бюджет шт. × (шкур на изделие × цена шкуры + подкладка м × цена за м + работа) + надбавка c4 % на мех и подкладку.
// «Автоматический расчёт» заполняет значения из статистики системы (средневзвешенно по ТЗ) с настраиваемыми надбавками
// и не трогает листья с замком (в том числе под закрытым замком родителя).

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

export type NodeKind = "fur" | "cat" | "art";
/** Откуда взяты значения: ТЗ артикула, статистика «мех × категория», нет данных, вручную. */
export type NodeSrc = "art" | "pair" | "none" | "manual";

export type BudgetNode = {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  /** Название: тип сырья, категория или артикул (код/название либо своё плановое). */
  name: string;
  /** Артикул из каталога (ProductModel.id); null — плановый артикул, существующий только в бюджете. */
  modelId: string | null;
  /** Бюджет, шт. */
  pcs: number;
  /** Замочек: узел не пересчитывается автоматически, значения ручные. */
  locked: boolean;
  /** Значения на одно изделие (с надбавками), редактируются. */
  hides: number;
  hidePrice: number;
  meters: number;
  meterPrice: number;
  work: number;
  /** Привязка к статистике «мех × категория» системы (пусто — берётся из названий узла и родителей). */
  statFur: string;
  statCat: string;
  /** Текущие значения системы (без надбавок); null — нет данных. */
  base: BudgetBase | null;
  /** Изделий в основе статистики. */
  sample: number;
  src: NodeSrc;
};

/** Статистика системы: пара «мех|категория» (key = "мех|категория") или артикул ("m:<id>|мех", есть modelId). */
export type BudgetStat = {
  key: string; fur: string; cat: string; qty: number; orders: number;
  hidesPer: number; hidePrice: number; metersPer: number; meterPrice: number; workPer: number;
  modelId?: string;
};

export type Agg = {
  pcs: number; hides: number; mex: number; meters: number; lining: number; work: number; c4: number; total: number;
  /** «Сейчас»: те же количества по текущим ценам системы — только листья с данными; nowPcs — их изделий; cmpTotal — их бюджет. */
  nowTotal: number; nowPcs: number; cmpTotal: number;
};

const num = (v: number) => (Number.isFinite(v) ? v : 0);
const zero = (): Agg => ({ pcs: 0, hides: 0, mex: 0, meters: 0, lining: 0, work: 0, c4: 0, total: 0, nowTotal: 0, nowPcs: 0, cmpTotal: 0 });

/** Текущая стоимость одного изделия по базе системы (с надбавкой c4), ₽. */
export function nowPerUnitOf(b: BudgetBase | null, p: BudgetParams): number | null {
  return b ? (b.hides * b.hidePrice + b.meters * b.meterPrice) * (1 + p.c4 / 100) + b.work : null;
}

export function leafAgg(n: BudgetNode, p: BudgetParams): Agg {
  const hides = num(n.pcs * n.hides);
  const mex = hides * num(n.hidePrice);
  const meters = num(n.pcs * n.meters);
  const lining = meters * num(n.meterPrice);
  const work = num(n.pcs * n.work);
  const c4 = (mex + lining) * (p.c4 / 100);
  const total = mex + lining + work + c4;
  const now = nowPerUnitOf(n.base, p);
  return { pcs: num(n.pcs), hides, mex, meters, lining, work, c4, total, nowTotal: now == null ? 0 : now * n.pcs, nowPcs: now == null ? 0 : n.pcs, cmpTotal: now == null ? 0 : total };
}

export function addAgg(a: Agg, b: Agg): Agg {
  return {
    pcs: a.pcs + b.pcs, hides: a.hides + b.hides, mex: a.mex + b.mex, meters: a.meters + b.meters, lining: a.lining + b.lining, work: a.work + b.work,
    c4: a.c4 + b.c4, total: a.total + b.total, nowTotal: a.nowTotal + b.nowTotal, nowPcs: a.nowPcs + b.nowPcs, cmpTotal: a.cmpTotal + b.cmpTotal,
  };
}

export function childrenMap(nodes: BudgetNode[]): Map<string | null, BudgetNode[]> {
  const m = new Map<string | null, BudgetNode[]>();
  for (const n of nodes) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
  return m;
}

/** Итоги каждого узла: лист — по своим значениям, родитель — сумма детей. */
export function computeTree(nodes: BudgetNode[], p: BudgetParams): Map<string, Agg> {
  const kids = childrenMap(nodes);
  const out = new Map<string, Agg>();
  const walk = (n: BudgetNode, depth: number): Agg => {
    const ch = kids.get(n.id);
    let a: Agg;
    if (!ch || ch.length === 0 || depth > 6) a = n.kind === "fur" ? zero() : leafAgg(n, p);
    else a = ch.reduce((s, c) => addAgg(s, walk(c, depth + 1)), zero());
    out.set(n.id, a);
    return a;
  };
  for (const n of kids.get(null) ?? []) walk(n, 0);
  return out;
}

/** Сумма по всему бюджету. */
export function grandTotal(nodes: BudgetNode[], p: BudgetParams): Agg {
  const c = computeTree(nodes, p);
  return nodes.filter((n) => n.parentId === null).reduce((s, n) => addAgg(s, c.get(n.id) ?? zero()), zero());
}

export const perUnit = (a: Agg) => (a.pcs > 0 ? a.total / a.pcs : null);
export const nowPerUnit = (a: Agg) => (a.nowPcs > 0 ? a.nowTotal / a.nowPcs : null);
/** Var: бюджет к текущим ценам системы, % (по изделиям, у которых есть данные системы). */
export const varPct = (a: Agg) => (a.nowTotal > 0 ? (a.cmpTotal / a.nowTotal - 1) * 100 : null);

/** Значения из базы системы и надбавок. */
export function fromBase(b: BudgetBase, p: BudgetParams): Pick<BudgetNode, "hides" | "hidePrice" | "meters" | "meterPrice" | "work"> {
  return { hides: b.hides, hidePrice: b.hidePrice * (1 + p.upFur / 100), meters: b.meters, meterPrice: b.meterPrice * (1 + p.upLining / 100), work: b.work * (1 + p.upWork / 100) };
}

/** Нормализация названий для сопоставления с системой: регистр, «ё», пробелы и знаки не важны. */
export const normKey = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");
const FUR_ALIASES: Record<string, string> = { каракульча: "свакара", каракуль: "свакара" };
const furKey = (s: string) => { const k = normKey(s); return FUR_ALIASES[k] ?? k; };

/** Путь узла от корня: [тип сырья, категория, артикул] (то, что есть). */
function pathOf(n: BudgetNode, byId: Map<string, BudgetNode>): BudgetNode[] {
  const out: BudgetNode[] = [n];
  let cur = n;
  for (let i = 0; i < 4 && cur.parentId; i++) {
    const par = byId.get(cur.parentId);
    if (!par) break;
    out.unshift(par);
    cur = par;
  }
  return out;
}

/** Замок узла или любого его родителя. */
export function effLocked(n: BudgetNode, byId: Map<string, BudgetNode>): boolean {
  return pathOf(n, byId).some((x) => x.locked);
}

function indexStats(stats: BudgetStat[]) {
  const pairs = new Map<string, BudgetStat>();
  const arts = new Map<string, BudgetStat>();
  for (const s of stats) {
    if (s.modelId) arts.set(`${s.modelId}|${furKey(s.fur)}`, s);
    else pairs.set(`${furKey(s.fur)}|${normKey(s.cat)}`, s);
  }
  return { pairs, arts };
}

const toBase = (s: BudgetStat): BudgetBase => ({ hides: s.hidesPer, hidePrice: s.hidePrice, meters: s.metersPer, meterPrice: s.meterPrice, work: s.workPer });

/**
 * Автоматический расчёт по данным системы. scopeId — пересчитать только поддерево (блок/категорию/один узел); без него — весь бюджет.
 * Артикул из каталога: сначала ТЗ этого артикула (в этом типе сырья), иначе статистика «мех × категория», иначе «нет данных».
 * Узлы с замком (и узлы под замком родителя) не меняются.
 */
export function autoCalc(nodes: BudgetNode[], stats: BudgetStat[], p: BudgetParams, scopeId?: string): BudgetNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = childrenMap(nodes);
  const idx = indexStats(stats);
  const inScope = (n: BudgetNode) => !scopeId || pathOf(n, byId).some((x) => x.id === scopeId);
  return nodes.map((n) => {
    if (n.kind === "fur" || (kids.get(n.id)?.length ?? 0) > 0) return n;
    if (!inScope(n) || effLocked(n, byId)) return n;
    const path = pathOf(n, byId);
    const fur = path.find((x) => x.kind === "fur");
    const cat = path.find((x) => x.kind === "cat");
    const furName = cat?.statFur || n.statFur || fur?.statFur || fur?.name || "";
    const catName = n.kind === "cat" ? (n.statCat || n.name) : (n.statCat || cat?.statCat || cat?.name || "");
    const fk = furKey(furName);
    let st: BudgetStat | undefined;
    let src: NodeSrc = "none";
    if (n.kind === "art" && n.modelId) {
      st = idx.arts.get(`${n.modelId}|${fk}`);
      if (st && st.qty > 0) src = "art"; else st = undefined;
    }
    if (!st) {
      st = idx.pairs.get(`${fk}|${normKey(catName)}`);
      if (st && st.qty > 0) src = "pair"; else st = undefined;
    }
    if (!st) return { ...n, base: null, sample: 0, src: "none" as NodeSrc };
    const base = toBase(st);
    return { ...n, base, sample: st.qty, src, ...fromBase(base, p) };
  });
}

/** Смена надбавок: листья без замка пересчитывают цены из своей базы без обращения к статистике. */
export function reapplyParams(nodes: BudgetNode[], p: BudgetParams): BudgetNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasKids = new Set(nodes.map((n) => n.parentId));
  return nodes.map((n) => (n.kind === "fur" || hasKids.has(n.id) || !n.base || effLocked(n, byId) ? n : { ...n, ...fromBase(n.base, p) }));
}

/** Бейдж качества данных для листа. */
export function srcInfo(n: BudgetNode): { label: string; tone: "ok" | "warn" | "bad" | "manual" } {
  if (n.src === "manual" || (n.locked && n.sample <= 0)) return { label: "вручную", tone: "manual" };
  if (n.src === "none" || n.sample <= 0) return { label: "нет данных", tone: "bad" };
  const small = n.src === "art" ? n.sample < 5 : n.sample < 10;
  const where = n.src === "art" ? "ТЗ артикула" : "по категории";
  return { label: `${where} · ${n.sample} изд.`, tone: small ? "warn" : "ok" };
}

export const newId = () => "n" + Math.random().toString(36).slice(2, 10);

export const blankNode = (kind: NodeKind, parentId: string | null, name: string, extra: Partial<BudgetNode> = {}): BudgetNode => ({
  id: newId(), kind, parentId, name, modelId: null, pcs: 0, locked: false, hides: 0, hidePrice: 0, meters: 0, meterPrice: 0, work: 0,
  statFur: "", statCat: "", base: null, sample: 0, src: "none", ...extra,
});

/** Порядок типов сырья по умолчанию (для шаблона). */
export const FUR_ORDER = ["Соболь", "Норка", "Норка+Соболь", "Лиса", "Каракульча", "Рысь"];
export function furRank(f: string): number { const i = FUR_ORDER.indexOf(f); return i < 0 ? 99 : i; }

// ---------------------------------------------------------------------------------------------------------------------
// Шаблон «по Budget PCS FW27» и перенос старого формата (плоские строки «мех × категория») в дерево.

/** Старый формат строки (до версий бюджета). */
export type LegacyLine = {
  id: string; fur: string; cat: string; pcs: number; statFur: string; statCat: string; locked: boolean;
  hides: number; hidePrice: number; meters: number; meterPrice: number; work: number; base: BudgetBase | null; sample: number;
};

export function isLegacyLines(v: unknown): v is LegacyLine[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && "fur" in (v[0] as object) && !("kind" in (v[0] as object));
}

/** Плоские строки → дерево: узел «тип сырья» на каждый мех, категории — листья. Записанные значения не теряются. */
export function legacyToNodes(lines: LegacyLine[]): BudgetNode[] {
  const out: BudgetNode[] = [];
  const furId = new Map<string, string>();
  for (const l of lines) {
    if (!furId.has(l.fur)) {
      const id = "f-" + normKey(l.fur);
      furId.set(l.fur, id);
      out.push(blankNode("fur", null, l.fur, { id }));
    }
  }
  out.sort((a, b) => furRank(a.name) - furRank(b.name));
  for (const l of lines) {
    out.push(blankNode("cat", furId.get(l.fur)!, l.cat, {
      id: l.id, pcs: l.pcs, locked: !!l.locked, hides: l.hides, hidePrice: l.hidePrice, meters: l.meters, meterPrice: l.meterPrice, work: l.work,
      statFur: l.statFur, statCat: l.statCat, base: l.base, sample: l.sample,
      src: l.locked && l.sample <= 0 ? "manual" : l.sample > 0 ? "pair" : "none",
    }));
  }
  return out;
}

const mk = (id: string, fur: string, cat: string, pcs: number, statFur: string, statCat: string): LegacyLine => ({ id, fur, cat, pcs, statFur, statCat, locked: false, hides: 0, hidePrice: 0, meters: 0, meterPrice: 0, work: 0, base: null, sample: 0 });
const lynx = (id: string, cat: string, pcs: number, statCat: string, v: Pick<LegacyLine, "hides" | "hidePrice" | "meters" | "meterPrice" | "work">, base: BudgetBase): LegacyLine => ({ ...mk(id, "Рысь", cat, pcs, "Рысь", statCat), locked: true, ...v, base, sample: 0 });

/** Бюджет FW27 (Budget PCS, 880 изд.) и соответствие категорий бюджета категориям системы. Рысь — вручную (расчёт LYNX MVST FW26), остальное — по данным системы. */
export function defaultLines(): LegacyLine[] {
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

/** Шаблон «по Budget PCS FW27» как дерево; Рысь остаётся вручную (замок закрыт, значения из расчёта LYNX MVST FW26). */
export function templateNodes(): BudgetNode[] {
  return legacyToNodes(defaultLines());
}

/** Разбор сохранённого JSON (старый плоский или новый формат) в дерево. */
export function parseNodes(raw: unknown): BudgetNode[] {
  if (isLegacyLines(raw)) return legacyToNodes(raw);
  return Array.isArray(raw) ? (raw as BudgetNode[]) : [];
}
