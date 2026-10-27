// «Стоимость производства» Сводки: данные ТЗ для окна-гистограммы и чистый расчёт уровней «проваливания».
// Без базы и React: одни и те же функции считают окно (клиент) и scripts/test-dashboard-numbers.ts (Σ столбцов = итог плитки).
//
// Единица учёта — атом: строка списания лота (мех / подкладка, со своей долей надбавки 4%), расходы ТЗ или «прочее»
// (разница между снимком totalCost ТЗ и суммой строк + расходов). Σ атомов ТЗ = себестоимость ТЗ (как в «ТЗ», «Партиях», аналитике).
// Работа (цена работы × кол-во) в себестоимость НЕ входит: показывается отдельно и в сумму столбцов не входит.

import { orderKey, uniqueOrderCount } from "@/lib/tz-key";

export type VatSel = "incl" | "excl";

export type DrillLine = {
  /** f — мех, l — подкладка. */
  k: "f" | "l";
  /** Материал как в справочнике («Лиса красная»). */
  n: string;
  /** Вид меха (канонический: «Норка», «Соболь»); у подкладки пусто. */
  fu: string;
  lot: string;
  ln: string | null;
  /** Короткое имя партии закупки (аукциона) или «Без аукциона». */
  au: string;
  pid: string | null;
  pn: string | null;
  q: number;
  /** Сумма в выбранном режиме 4% (с НДС / без НДС), включая долю 4%. */
  i: number;
  e: number;
  /** Доля 4% внутри i / e (0 в режиме «Без 4%»). */
  ci: number;
  ce: number;
};

export type DrillOrder = {
  id: string;
  number: string;
  wo: string | null;
  /** Номер партии производства или "none". */
  bk: string;
  bl: string;
  y: number | null;
  st: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  cat: string;
  /** Группа категории: «Одежда», «Аксессуары» или «Без группы». */
  grp: string;
  mid: string;
  ml: string;
  fur: string;
  qty: number;
  /** Заказано (план ТЗ) и произведено (выпуск завершённого) — для переключателя «Заказано / Произведено» в таблицах Главной. */
  qo?: number;
  qd?: number;
  work: number;
  /** Доли сезонов ТЗ (сумма 1) по приходу модели — для переключателя «Сезон» на Главной (src/lib/order-seasons.ts); нет — ТЗ целиком в любом сезоне. */
  sw?: Record<string, number>;
  /** Расходы ТЗ (одинаково с НДС и без). */
  exp: number;
  /** Расходы ТЗ по статьям («Фурнитура», «Прочие расходы»…): Σ a = exp. */
  xs?: { n: string; a: number }[];
  /** Шкуры подрядчика, отнесённые к ТЗ (с НДС / без НДС): оплачены в составе пошива, в ТЗ не списаны. */
  hI: number;
  hE: number;
  /** Прочее: снимок totalCost ТЗ − (строки + расходы), с НДС / без НДС. Обычно 0. */
  resI: number;
  resE: number;
  lines: DrillLine[];
};

export type DrillData = { c4: "on" | "off"; orders: DrillOrder[] };

export type Dim = "batch" | "year" | "grp" | "cat" | "model" | "fur" | "furw" | "auction" | "order";
export type RootMode = "batch" | "year" | "cat" | "fur" | "catfur";
export const ROOT_MODES: { id: RootMode; label: string }[] = [
  { id: "batch", label: "Партии" },
  { id: "year", label: "Годы" },
  { id: "cat", label: "Категории" },
  { id: "fur", label: "Мех" },
  { id: "catfur", label: "Категория + мех" },
];
export const CHAIN: Record<RootMode, Dim[]> = {
  batch: ["batch", "order"],
  year: ["year", "batch", "order"],
  cat: ["grp", "cat", "model", "order"],
  fur: ["fur", "year", "batch", "order"],
  // Категория раскрывается на виды меха (ТЗ целиком, поэтому работа входит в столбцы), затем ТЗ и состав.
  catfur: ["grp", "cat", "furw", "order"],
};
export const DIM_TITLE: Record<Dim, string> = {
  batch: "по партиям производства", year: "по годам", grp: "по группам категорий", cat: "по категориям", model: "по артикулам (моделям)", fur: "по виду меха", furw: "по виду меха в категории",
  auction: "по партиям закупки (аукционам)", order: "по ТЗ",
};

export type PathStep = { dim: Dim | "part" | "lines"; key: string; label: string };

export type Atom = { o: DrillOrder; k: "f" | "l" | "e" | "r" | "h"; line?: DrillLine; au: string; i: number; e: number; ci: number; ce: number; q: number };

export const EXP_LABEL = "Расходы ТЗ и прочее";
export const NO_AUC = "Без аукциона";
export const HIDES_LABEL = "Шкуры подрядчика";

export function atomsOf(o: DrillOrder): Atom[] {
  const out: Atom[] = o.lines.map((l) => ({ o, k: l.k, line: l, au: l.au, i: l.i, e: l.e, ci: l.ci, ce: l.ce, q: l.q }));
  if (o.hI !== 0) out.push({ o, k: "h", au: HIDES_LABEL, i: o.hI, e: o.hE, ci: 0, ce: 0, q: 0 });
  if (o.exp !== 0) out.push({ o, k: "e", au: EXP_LABEL, i: o.exp, e: o.exp, ci: 0, ce: 0, q: 0 });
  if (Math.abs(o.resI) > 0.005 || Math.abs(o.resE) > 0.005) out.push({ o, k: "r", au: EXP_LABEL, i: o.resI, e: o.resE, ci: 0, ce: 0, q: 0 });
  // ТЗ без списаний сырья и расходов всё равно учитывается (работа по нему входит в итог): нулевой атом.
  if (out.length === 0) out.push({ o, k: "r", au: EXP_LABEL, i: 0, e: 0, ci: 0, ce: 0, q: 0 });
  return out;
}

/** Себестоимость ТЗ = Σ атомов (без работы). */
export function orderCost(o: DrillOrder, vat: VatSel): number {
  return atomsOf(o).reduce((s, a) => s + (vat === "incl" ? a.i : a.e), 0);
}

const val = (a: Atom, vat: VatSel) => (vat === "incl" ? a.i : a.e);
const c4val = (a: Atom, vat: VatSel) => (vat === "incl" ? a.ci : a.ce);

function keyOf(dim: Dim, a: Atom): { key: string; label: string } {
  const o = a.o;
  switch (dim) {
    case "batch": return { key: o.bk, label: o.bl };
    case "year": return { key: o.y == null ? "none" : String(o.y), label: o.y == null ? "Без года" : String(o.y) };
    case "grp": return { key: o.grp, label: o.grp };
    case "cat": return { key: o.cat, label: o.cat };
    case "model": return { key: o.mid, label: o.ml };
    case "fur": return { key: o.fur, label: o.fur };
    case "furw": return { key: o.fur, label: o.fur };
    case "auction": return { key: a.au, label: a.au };
    case "order": return { key: o.id, label: `ТЗ ${o.wo?.trim() || o.number}` };
  }
}

export type Item = {
  key: string;
  label: string;
  value: number;
  share: number;
  /** Подпись количества: «38 изд.», «120 шкур», «6 м». */
  qtyText: string;
  /** Работа внутри столбца (только если столбец состоит из целых ТЗ). */
  work: number | null;
  drillable: boolean;
  href?: string;
  sub?: string;
  /** Состав себестоимости столбца: мех, подкладка, 4%, расходы ТЗ и прочее (Σ = value). */
  parts?: { fur: number; lining: number; c4: number; other: number; work: number; /** Из other: расходы ТЗ (ProductionExpense) — в таблицах показываются в столбце «Работа». */ exp: number };
  /** Использовано по списаниям: шкуры меха, шт. и подкладка, м. */
  furQ?: number;
  liningQ?: number;
  /** Сумма строки стоит в столбце «Работа» (работа, доп. расходы), а в «Себестоимость» — «—»; в итог уровня входит как раньше. */
  asWork?: boolean;
  /** Количество изделий (для строки таблицы). */
  qty?: number;
  /** Ремонт внутри столбца, шт. (не входит в qty и в «В выпуске»). */
  repairQty?: number;
  /** Столбец «Работа» — вне суммы. */
  outside?: boolean;
  tone?: "fur" | "lining" | "c4" | "exp" | "res" | "work";
};

export type Level = {
  kind: "dim" | "composition" | "lines";
  dim?: Dim;
  title: string;
  items: Item[];
  /** Σ столбцов (то, что сходится с плиткой / родительским столбцом). */
  total: number;
  totalWork: number | null;
  orders: number;
  /** Ссылки (для композиции: карточка ТЗ и т. п.). */
  links: { label: string; href: string }[];
};

const nf = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
/** Шкуры и метры подкладки: всегда одна цифра после запятой. */
const nf1 = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function qtyTextOf(atoms: Atom[], dim: Dim): string {
  if (dim === "auction") {
    const f = atoms.filter((a) => a.k === "f").reduce((s, a) => s + a.q, 0);
    const l = atoms.filter((a) => a.k === "l").reduce((s, a) => s + a.q, 0);
    const parts = [f > 0 ? `${nf(f)} шк.` : "", l > 0 ? `${nf(l)} м` : ""].filter(Boolean);
    return parts.join(" · ") || "—";
  }
  if (atoms.length && atoms.every((a) => a.o.cat === "Ремонт")) return `ремонт · ${new Set(atoms.map((a) => a.o.id)).size} ТЗ`;
  const seen = new Set<string>();
  let q = 0, rq = 0;
  for (const a of atoms) if (!seen.has(a.o.id)) { seen.add(a.o.id); if (a.o.cat === "Ремонт") rq += a.o.qty; else q += a.o.qty; }
  // Ремонт — не изделия «в выпуске»: показываем отдельно, чтобы сумма по партиям сходилась с заголовком.
  return rq > 0 ? `${nf(q)} изд. + ремонт ${nf(rq)} шт.` : `${nf(q)} изд.`;
}

/** Атомы узла: ТЗ и атомы, подходящие под выбранные шаги пути. */
export function atomsFor(orders: DrillOrder[], path: PathStep[]): Atom[] {
  let atoms = orders.flatMap(atomsOf);
  for (const s of path) {
    const d = s.dim;
    if (d === "part" || d === "lines") continue;
    atoms = atoms.filter((a) => keyOf(d, a).key === s.key);
  }
  return atoms;
}

const naturalSort = new Intl.Collator("ru", { numeric: true });

/** Следующий уровень для пути (path — только шаги измерений, без «состав» и «лоты»). */
export function levelFor(orders: DrillOrder[], mode: RootMode, path: PathStep[], vat: VatSel): Level {
  const chain = CHAIN[mode];
  const dimSteps = path.filter((s) => s.dim !== "part" && s.dim !== "lines");
  const part = path.find((s) => s.dim === "part");
  const atoms = atomsFor(orders, dimSteps);
  // Мех — срез части ТЗ: работу целого ТЗ к нему не относим (как и к аукциону).
  const auctionLocked = dimSteps.some((s) => s.dim === "auction" || s.dim === "fur");

  // Состав выбранного ТЗ / «лоты» выбранной части состава
  if (dimSteps.length >= chain.length) {
    const orderCount = new Set(atoms.map((a) => orderKey(a.o))).size; // уникальные ТЗ (по номеру из документа)
    const o = atoms[0]?.o;
    const mk = (key: string, label: string, tone: Item["tone"], v: number, drill: boolean, sub?: string): Item => ({
      key, label, value: v, share: 0, qtyText: "", work: null, drillable: drill, tone, sub,
    });
    if (part) {
      const sel = part.key as "fur" | "lining" | "c4";
      const lines = atoms.filter((a) => (sel === "c4" ? a.line && c4val(a, vat) !== 0 : a.k === (sel === "fur" ? "f" : "l") && a.line));
      const byLot = new Map<string, { a: Atom[]; v: number; q: number }>();
      for (const a of lines) {
        const id = a.line!.lot;
        const cur = byLot.get(id) ?? { a: [], v: 0, q: 0 };
        cur.a.push(a);
        cur.v += sel === "c4" ? c4val(a, vat) : val(a, vat) - c4val(a, vat);
        cur.q += a.q;
        byLot.set(id, cur);
      }
      const items = Array.from(byLot, ([lotId, g]): Item => {
        const l = g.a[0].line!;
        return {
          key: lotId,
          label: `${l.n} · лот ${l.ln ?? "без номера"}`,
          sub: `${l.au}${l.pn ? ` · закупка ${l.pn}` : ""} · ${nf(g.q)} ${l.k === "l" ? "м" : "шк."}`,
          value: g.v, share: 0, qtyText: `${nf(g.q)} ${l.k === "l" ? "м" : "шк."}`, work: null, drillable: false,
          furQ: sel === "fur" ? g.q : undefined, liningQ: sel === "lining" ? g.q : undefined,
          href: `/analytics/raw/lot/${lotId}`, tone: sel === "c4" ? "c4" : sel,
        };
      }).sort((x, y) => y.value - x.value);
      const total = items.reduce((s, i) => s + i.value, 0);
      items.forEach((i) => (i.share = total ? i.value / total : 0));
      const purchases = Array.from(new Map(lines.filter((a) => a.line!.pid).map((a) => [a.line!.pid!, a.line!.pn ?? "закупка"])).entries());
      return {
        kind: "lines", title: `${part.label}: по лотам`, items, total, totalWork: null, orders: orderCount,
        links: purchases.map(([pid, pn]) => ({ label: `Закупка ${pn}`, href: `/purchases/${pid}` })),
      };
    }
    const sum = (f: (a: Atom) => number, pred: (a: Atom) => boolean) => atoms.filter(pred).reduce((s, a) => s + f(a), 0);
    const furV = sum((a) => val(a, vat) - c4val(a, vat), (a) => a.k === "f");
    const linV = sum((a) => val(a, vat) - c4val(a, vat), (a) => a.k === "l");
    const c4V = sum((a) => c4val(a, vat), (a) => a.k === "f" || a.k === "l");
    const expV = sum((a) => val(a, vat), (a) => a.k === "e");
    const resV = sum((a) => val(a, vat), (a) => a.k === "r");
    const hidesV = sum((a) => val(a, vat), (a) => a.k === "h");
    const furQ = sum((a) => a.q, (a) => a.k === "f");
    const linQ = sum((a) => a.q, (a) => a.k === "l");
    const items: Item[] = [
      { ...mk("fur", "Мех", "fur", furV, true, "по лотам"), furQ, qtyText: furQ ? `${nf1(furQ)} шк.` : "" },
      { ...mk("lining", "Подкладка", "lining", linV, true, "по лотам"), liningQ: linQ, qtyText: linQ ? `${nf1(linQ)} м` : "" },
      mk("hides", HIDES_LABEL, "fur", hidesV, false, "оплачены в составе пошива, в ТЗ не списаны"),
      mk("c4", "Надбавка 4%", "c4", c4V, c4V !== 0, c4V !== 0 ? "по лотам" : "режим «Без 4%» или не применяется"),
      mk("res", "Прочее (снимок ТЗ ≠ строки)", "res", resV, false, "разница между итогом ТЗ и суммой строк"),
    ].filter((i) => i.value !== 0 || i.key === "fur");
    // Доп. расходы ТЗ — отдельными строками по статьям; как и работа, стоят в столбце «Работа» («Себестоимость» у строки «—»).
    if (expV !== 0) {
      const xs = (o?.xs ?? []).filter((x) => Math.abs(x.a) > 0.005);
      const rest = expV - xs.reduce((q, x) => q + x.a, 0);
      xs.forEach((x, i) => items.push({ ...mk(`exp${i}`, `Доп. расходы · ${x.n}`, "exp", x.a, false, "без НДС и без 4%"), asWork: true }));
      if (Math.abs(rest) > 0.005 || xs.length === 0) items.push({ ...mk("exp", "Доп. расходы", "exp", rest, false, "без НДС и без 4%"), asWork: true });
    }
    const work = auctionLocked || !o ? null : o.work;
    if (work != null && work !== 0) items.push({ key: "work", label: "Работа", value: work, share: 0, qtyText: "", work: null, drillable: false, tone: "work", sub: "цена работы × кол-во", asWork: true });
    const total = items.reduce((s, i) => s + i.value, 0);
    items.forEach((i) => (i.share = total ? i.value / total : 0));
    const workCol = (work ?? 0) + expV;
    return {
      kind: "composition", title: o ? `Состав себестоимости ТЗ ${o.wo?.trim() || o.number} (с работой)` : "Состав", items, total, totalWork: work != null || expV !== 0 ? workCol : null, orders: orderCount,
      links: o ? [{ label: `Открыть ТЗ ${o.wo?.trim() || o.number}`, href: `/production/${o.id}` }] : [],
    };
  }

  const dim = chain[dimSteps.length];
  const groups = new Map<string, { label: string; atoms: Atom[] }>();
  for (const a of atoms) {
    const k = keyOf(dim, a);
    const g = groups.get(k.key) ?? { label: k.label, atoms: [] };
    g.atoms.push(a);
    groups.set(k.key, g);
  }
  const lastOrder = dim === "order";
  const items: Item[] = Array.from(groups, ([key, g]) => {
    const whole = !(auctionLocked || dim === "auction" || dim === "fur");
    const seen = new Set<string>();
    let work = 0;
    for (const a of g.atoms) if (!seen.has(a.o.id)) { seen.add(a.o.id); work += a.o.work; }
    // Себестоимость столбца — вместе с работой (когда столбец состоит из целых ТЗ).
    const v = g.atoms.reduce((s, a) => s + val(a, vat), 0) + (whole ? work : 0);
    const part = (pred: (a: Atom) => boolean, f: (a: Atom) => number) => g.atoms.filter(pred).reduce((x, a) => x + f(a), 0);
    const qtyOrders = new Map<string, number>();
    const repOrders = new Map<string, number>();
    for (const a of g.atoms) if (a.o.cat === "Ремонт") repOrders.set(a.o.id, a.o.qty);
    for (const a of g.atoms) if (a.o.cat !== "Ремонт") qtyOrders.set(a.o.id, a.o.qty);
    return {
      parts: {
        fur: part((a) => a.k === "f" || a.k === "h", (a) => val(a, vat) - c4val(a, vat)),
        lining: part((a) => a.k === "l", (a) => val(a, vat) - c4val(a, vat)),
        c4: part((a) => a.k === "f" || a.k === "l", (a) => c4val(a, vat)),
        other: part((a) => a.k === "e" || a.k === "r", (a) => val(a, vat)),
        work: whole ? work : 0,
        exp: part((a) => a.k === "e", (a) => val(a, vat)),
      },
      repairQty: dim === "fur" || dim === "auction" ? undefined : Array.from(repOrders.values()).reduce((x, y) => x + y, 0),
      furQ: part((a) => a.k === "f", (a) => a.q), liningQ: part((a) => a.k === "l", (a) => a.q),
      // Ремонт — не изделия: количество и «1 изд.» не показываем.
      qty: dim === "fur" || dim === "auction" || g.atoms.every((x) => x.o.cat === "Ремонт") ? undefined : Array.from(qtyOrders.values()).reduce((x, y) => x + y, 0),
      key, label: g.label, value: v, share: 0, qtyText: qtyTextOf(g.atoms, dim), work: whole ? work : null, drillable: true,
      sub: lastOrder ? [g.atoms[0].o.ml, g.atoms[0].o.fur].filter(Boolean).join(" · ") : undefined,
      tone: dim === "auction" && key === EXP_LABEL ? "exp" : undefined,
    };
  });
  if (dim === "batch" || dim === "year") {
    items.sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return naturalSort.compare(a.key, b.key);
    });
  } else if (dim === "order") items.sort((a, b) => naturalSort.compare(a.label, b.label));
  else items.sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0);
  items.forEach((i) => (i.share = total ? i.value / total : 0));
  const seenO = new Set(atoms.map((a) => a.o.id));
  const totalWork = auctionLocked || dim === "auction" || dim === "fur" ? null : Array.from(seenO).reduce((s, id) => s + (atoms.find((a) => a.o.id === id)?.o.work ?? 0), 0);
  void totalWork;
  return { kind: "dim", dim, title: DIM_TITLE[dim], items, total, totalWork, orders: new Set(atoms.map((a) => orderKey(a.o))).size, links: [] };
}

/** Итог по всем ТЗ окна — то, что должна показывать плитка. */
export function drillTotals(orders: DrillOrder[], vat: VatSel) {
  return {
    cost: orders.reduce((s, o) => s + orderCost(o, vat) + o.work, 0),
    work: orders.reduce((s, o) => s + o.work, 0),
    qty: orders.reduce((s, o) => s + o.qty, 0),
    orders: uniqueOrderCount(orders),
  };
}

/** Объём таблиц Главной по выбору: «Заказано» — все ТЗ по плановому количеству; «Произведено» — только завершённые по фактическому выпуску. Деньги — по тем же ТЗ. */
export type VolumeMode = "ordered" | "produced";
export function withVolume(data: DrillData | null, mode: VolumeMode): DrillData | null {
  if (!data) return data;
  const orders = mode === "ordered"
    ? data.orders.map((o) => (o.qo != null ? { ...o, qty: o.qo } : o))
    : data.orders.filter((o) => o.st === "COMPLETED").map((o) => ({ ...o, qty: o.qd ?? o.qty }));
  return { ...data, orders };
}
