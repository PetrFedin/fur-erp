/** Budget PCS (файл поставщика MVST): штуки, расход шкур на изделие (AVG) и итог шкур (TTL) по типам меха, категориям и длинам. Без server-only: используется и на странице. */
export type PcsBlock = "RTW" | "Acc";
export type PcsRow = { block: PcsBlock; fur: string; cat: string; len: string; pcs: number; avg: number | null; avgText?: string | null };
export type PcsDoc = { id: string; name: string; season: string; supplier: string; asOf: { RTW: string; Acc: string }; rows: PcsRow[]; createdAt: string; updatedAt: string; updatedBy: string | null };

export const BLOCK_LABEL: Record<PcsBlock, string> = { RTW: "Одежда (RTW)", Acc: "Аксессуары (Acc)" };
export const FUR_ORDER = ["Соболь", "Каракульча", "Норка", "Рысь", "Лиса", "Норка+Соболь"];
/** Группа категории аксессуаров (KTT Level 03 в файле). */
export const ACC_GROUP: Record<string, string> = {
  "Шарфы": "Шарфы", "Шапка меховая": "Головные уборы", "Повязка меховая": "Головные уборы", Косынка: "Головные уборы", Берет: "Головные уборы", Капюшон: "Головные уборы", Наушники: "Головные уборы",
  "Манжеты, муфты, варежки": "Варежки / Муфты / Манжеты",
};
const LEN_ORDER = ["Short", "Regular", "Long"];
export const ttlOf = (r: { pcs: number; avg: number | null }) => (r.avg != null ? r.pcs * r.avg : null);

export type PcsNode = { key: string; label: string; level: 0 | 1 | 2 | 3 | 4; pcs: number; /** Штуки только тех строк, где задан AVG: знаменатель средневзвешенного AVG. */ pcsA: number; ttl: number; hasAvg: boolean; leaf?: PcsRow; rowIndex?: number; children: PcsNode[] };

/** Дерево как в файле: блок → мех → (группа →) категория → длина. Итоги: штуки и шкуры суммируются, AVG = TTL ÷ PCS по строкам с AVG. */
export function buildPcsTree(rows: PcsRow[]): PcsNode[] {
  const out: PcsNode[] = [];
  for (const block of ["RTW", "Acc"] as PcsBlock[]) {
    const rs = rows.map((r, i) => ({ r, i })).filter((x) => x.r.block === block);
    if (!rs.length) continue;
    const mk = (key: string, label: string, level: PcsNode["level"]): PcsNode => ({ key, label, level, pcs: 0, pcsA: 0, ttl: 0, hasAvg: false, children: [] });
    const root = mk(block, block === "RTW" ? "TOTAL - RTW" : "TOTAL - Acc", 0);
    const furs = [...new Set(rs.map((x) => x.r.fur))].sort((a, b) => (FUR_ORDER.indexOf(a) + 1 || 99) - (FUR_ORDER.indexOf(b) + 1 || 99));
    for (const fur of furs) {
      const fn = mk(`${block}|${fur}`, fur, 1); root.children.push(fn);
      const inFur = rs.filter((x) => x.r.fur === fur);
      const holder = (node: PcsNode, lvl: 2 | 3, name: string, key: string) => { let c = node.children.find((x) => x.key === key); if (!c) { c = mk(key, name, lvl); node.children.push(c); } return c; };
      for (const { r, i } of inFur) {
        let parent = fn;
        if (block === "Acc") parent = holder(fn, 2, ACC_GROUP[r.cat] ?? "Прочее", `${fn.key}|g|${ACC_GROUP[r.cat] ?? "Прочее"}`);
        const cn = holder(parent, block === "Acc" ? 3 : 2, r.cat, `${parent.key}|${r.cat}`);
        if (r.len) {
          const ln = mk(`${cn.key}|${r.len}`, r.len, 4); ln.leaf = r; ln.rowIndex = i; cn.children.push(ln);
        } else { cn.leaf = r; cn.rowIndex = i; }
      }
      const order = (n: PcsNode) => { n.children.sort((a, b) => LEN_ORDER.indexOf(a.label) - LEN_ORDER.indexOf(b.label) || 0); n.children.forEach(order); };
      order(fn);
    }
    const fill = (n: PcsNode) => {
      if (n.leaf) { n.pcs = n.leaf.pcs; const t = ttlOf(n.leaf); n.ttl = t ?? 0; n.hasAvg = t != null; n.pcsA = t != null ? n.leaf.pcs : 0; return; }
      for (const c of n.children) { fill(c); n.pcs += c.pcs; n.pcsA += c.pcsA; n.ttl += c.ttl; n.hasAvg = n.hasAvg || c.hasAvg; }
    };
    fill(root);
    out.push(root);
  }
  return out;
}
/** Средневзвешенный AVG: шкуры ÷ штуки тех строк, где AVG задан. */
export const avgOf = (n: { pcsA: number; ttl: number; hasAvg: boolean }) => (n.hasAvg && n.pcsA > 0 ? n.ttl / n.pcsA : null);
