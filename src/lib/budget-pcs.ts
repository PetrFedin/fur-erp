/** Budget PCS (файл поставщика MVST): штуки, расход шкур на изделие (AVG) и итог шкур (TTL) по типам меха, категориям и длинам. Без server-only: используется и на странице. */
export type PcsBlock = "RTW" | "Acc";
/** Колонки статистики отчёта MVST по порядку в `st`: Conf / Deliv / NS STD 2026, Deliv / NS 2025 (EUR, PCS), затем «Статистика» 2026, 2025, 2024 (NS AS, PCS). */
export const ST_COLS: { group: string; sub: string; name: string; money: boolean }[] = [
  ...(["2026 Conf", "2026 Deliv", "2026 NS STD", "2025 Deliv", "2025 NS"] as const).flatMap((g) => [{ group: g.slice(0, 4), sub: g.slice(5), name: `${g} EUR`, money: true }, { group: g.slice(0, 4), sub: g.slice(5), name: `${g} PCS`, money: false }]),
  ...(["2026", "2025", "2024"] as const).flatMap((y) => [{ group: "Статистика", sub: y, name: `Стат. ${y} NS AS`, money: true }, { group: "Статистика", sub: y, name: `Стат. ${y} PCS`, money: false }]),
];
export const ST_LEN = ST_COLS.length;
export type PcsRow = { block: PcsBlock; fur: string; cat: string; len: string; pcs: number; avg: number | null; avgText?: string | null; /** Статистика отчёта, ST_COLS. */ st?: number[]; /** Норма шкур на изделие из бюджета (не хранится: подставляется при загрузке). */ avgB?: number | null };
export type PcsDoc = { id: string; name: string; season: string; supplier: string; asOf: { RTW: string; Acc: string }; rows: PcsRow[]; createdAt: string; updatedAt: string; updatedBy: string | null };

export const BLOCK_LABEL: Record<PcsBlock, string> = { RTW: "Одежда (RTW)", Acc: "Аксессуары (Acc)" };
export const FUR_ORDER = ["Соболь", "Каракульча", "Норка", "Рысь", "Лиса", "Норка+Соболь"];
/** Группа категории аксессуаров (KTT Level 03 в файле). */
export const ACC_GROUP: Record<string, string> = {
  "Шарфы": "Шарфы", "Шапка меховая": "Головные уборы", "Повязка меховая": "Головные уборы", Косынка: "Головные уборы", Берет: "Головные уборы", Капюшон: "Головные уборы", Наушники: "Головные уборы",
  "Манжеты, муфты, варежки": "Варежки / Муфты / Манжеты",
};
const LEN_ORDER = ["Short", "Regular", "Long"];
/** Шкур на изделие: из файла, а если там пусто — норма из бюджета. */
export const avgEff = (r: { avg: number | null; avgB?: number | null }) => r.avg ?? r.avgB ?? null;
export const ttlOf = (r: { pcs: number; avg: number | null; avgB?: number | null }) => { const a = avgEff(r); return a != null ? r.pcs * a : null; };
export const stOf = (r: { st?: number[] }) => Array.from({ length: ST_LEN }, (_, i) => r.st?.[i] ?? 0);

export type PcsNode = { key: string; label: string; level: 0 | 1 | 2 | 3 | 4; pcs: number; /** Штуки только тех строк, где задан AVG: знаменатель средневзвешенного AVG. */ pcsA: number; ttl: number; /** Часть шкур, посчитанная по норме бюджета (в файле AVG пуст). */ ttlB: number; hasAvg: boolean; st: number[]; leaf?: PcsRow; rowIndex?: number; children: PcsNode[] };

/** Дерево как в файле: блок → мех → (группа →) категория → длина. Итоги: штуки и шкуры суммируются, AVG = TTL ÷ PCS по строкам с AVG. */
export function buildPcsTree(rows: PcsRow[], blocks: PcsBlock[] = ["RTW", "Acc"]): PcsNode[] {
  const out: PcsNode[] = [];
  for (const block of blocks) {
    const rs = rows.map((r, i) => ({ r, i })).filter((x) => x.r.block === block);
    if (!rs.length) continue;
    const mk = (key: string, label: string, level: PcsNode["level"]): PcsNode => ({ key, label, level, pcs: 0, pcsA: 0, ttl: 0, ttlB: 0, hasAvg: false, st: new Array(ST_LEN).fill(0), children: [] });
    const root = mk(block, block === "RTW" ? "TOTAL - RTW" : "TOTAL - Acc", 0);
    const furs = [...new Set(rs.map((x) => x.r.fur))].sort((a, b) => (FUR_ORDER.indexOf(a) + 1 || 99) - (FUR_ORDER.indexOf(b) + 1 || 99));
    for (const fur of furs) {
      const fn = mk(`${block}|${fur}`, fur, 1); root.children.push(fn);
      const inFur = rs.filter((x) => x.r.fur === fur);
      const holder = (node: PcsNode, lvl: 2 | 3, name: string, key: string) => { let c = node.children.find((x) => x.key === key); if (!c) { c = mk(key, name, lvl); node.children.push(c); } return c; };
      for (const { r, i } of inFur) {
        let parent = fn;
        if (block === "Acc") parent = holder(fn, 2, ACC_GROUP[r.cat] ?? "Прочее", `${fn.key}|g|${ACC_GROUP[r.cat] ?? "Прочее"}`);
        const cn = holder(parent, block === "Acc" ? 3 : 2, CAT_LABEL[r.cat] ?? r.cat, `${parent.key}|${r.cat}`);
        if (r.len) {
          const ln = mk(`${cn.key}|${r.len}`, r.len, 4); ln.leaf = r; ln.rowIndex = i; cn.children.push(ln);
        } else { cn.leaf = r; cn.rowIndex = i; }
      }
      // Группа аксессуаров из одной одноимённой категории («Шарфы» → «Шарфы») показывается одной строкой.
      for (const g of fn.children) if (g.level === 2 && g.children.length === 1 && g.children[0].label === g.label && g.children[0].leaf) { g.leaf = g.children[0].leaf; g.rowIndex = g.children[0].rowIndex; g.children = []; }
      const order = (n: PcsNode) => { n.children.sort((a, b) => LEN_ORDER.indexOf(a.label) - LEN_ORDER.indexOf(b.label) || 0); n.children.forEach(order); };
      order(fn);
    }
    const fill = (n: PcsNode) => {
      if (n.leaf) { n.pcs = n.leaf.pcs; const t = ttlOf(n.leaf); n.ttl = t ?? 0; n.hasAvg = t != null; n.pcsA = t != null ? n.leaf.pcs : 0; n.ttlB = t != null && n.leaf.avg == null ? t : 0; n.st = stOf(n.leaf); return; }
      for (const c of n.children) { fill(c); n.pcs += c.pcs; n.pcsA += c.pcsA; n.ttl += c.ttl; n.ttlB += c.ttlB; n.hasAvg = n.hasAvg || c.hasAvg; c.st.forEach((v, i) => (n.st[i] += v)); }
    };
    fill(root);
    out.push(root);
  }
  return out;
}
/** Средневзвешенный AVG: шкуры ÷ штуки тех строк, где AVG задан. */
export const avgOf = (n: { pcsA: number; ttl: number; hasAvg: boolean }) => (n.hasAvg && n.pcsA > 0 ? n.ttl / n.pcsA : null);

/** Итог по нескольким корням (одежда + аксессуары). */
export function sumRoots(roots: PcsNode[]): { pcs: number; pcsA: number; ttl: number; ttlB: number; hasAvg: boolean; st: number[] } {
  const o = { pcs: 0, pcsA: 0, ttl: 0, ttlB: 0, hasAvg: false, st: new Array(ST_LEN).fill(0) as number[] };
  for (const r of roots) { o.pcs += r.pcs; o.pcsA += r.pcsA; o.ttl += r.ttl; o.ttlB += r.ttlB; o.hasAvg = o.hasAvg || r.hasAvg; r.st.forEach((v, i) => (o.st[i] += v)); }
  return o;
}
/** Названия категорий в отчёте MVST (в данных хранятся имена бюджета). */
export const CAT_LABEL: Record<string, string> = { "Жилет меховой": "Жилеты", "Кардиган меховой": "Кардиганы", "Куртки меховые": "Куртки на молнии", "Шапка меховая": "Шапка", "Повязка меховая": "Повязка", "Манжеты, муфты, варежки": "Варежки / Муфты / Манжеты" };
