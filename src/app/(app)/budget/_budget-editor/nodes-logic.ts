import { autoCalc, blankNode, defaultLines, isAccessoryCat, normKey, type BudgetNode, type BudgetParams, type BudgetStat } from "@/lib/budget-calc";
import type { ImportRow } from "../actions";

/** Показ «Все / Одежда / Аксессуары»: только фильтр отображения, сохраняемые узлы не меняются. */
export function scopeNodes(nodes: BudgetNode[], scope: "all" | "cloth" | "acc", catGroups: Record<string, string>): BudgetNode[] {
    if (scope === "all") return nodes;
    const keep = new Set<string>();
    const catKept = (c: BudgetNode) => isAccessoryCat(c, catGroups) === (scope === "acc");
    const byIdAll = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (n.kind === "fur") continue;
      let c: BudgetNode | undefined = n;
      for (let i = 0; i < 6 && c && c.kind !== "cat"; i++) c = c.parentId ? byIdAll.get(c.parentId) : undefined;
      if (c && c.kind === "cat" && catKept(c)) keep.add(n.id);
    }
    for (const n of nodes) if (keep.has(n.id) && n.parentId) { let q = byIdAll.get(n.parentId); for (let i = 0; i < 6 && q; i++) { keep.add(q.id); q = q.parentId ? byIdAll.get(q.parentId) : undefined; } }
    return nodes.filter((n) => keep.has(n.id));
}

/** Узлы после загрузки строк из файла (applyImport редактора): новые типы и категории, значения из файла или по данным системы, «Рысь» под замком. */
export function buildImportedNodes(nodes: BudgetNode[], rows: ImportRow[], stats: BudgetStat[], params: BudgetParams): BudgetNode[] {
    let ns = [...nodes];
    const touched = new Set<string>();
    const lynxDef = defaultLines().filter((l) => l.fur === "Рысь");
    for (const r of rows) {
      let fur = ns.find((n) => n.kind === "fur" && normKey(n.name) === normKey(r.fur));
      if (!fur) { fur = blankNode("fur", null, r.fur); ns.push(fur); }
      const isLynx = normKey(r.fur) === "рысь";
      let cat = ns.find((n) => n.kind === "cat" && n.parentId === fur!.id && normKey(n.name) === normKey(r.cat));
      if (!cat) { cat = blankNode("cat", fur.id, r.cat); ns.push(cat); }
      const given = [r.hides, r.hidePrice, r.meters, r.meterPrice, r.work].some((v) => v != null);
      const patchN: Partial<BudgetNode> = { pcs: r.pcs };
      if (r.statFur) patchN.statFur = r.statFur;
      if (r.statCat) patchN.statCat = r.statCat;
      if (given) Object.assign(patchN, { hides: r.hides ?? 0, hidePrice: r.hidePrice ?? 0, meters: r.meters ?? 0, meterPrice: r.meterPrice ?? 0, work: r.work ?? 0, locked: true, src: "manual" });
      else if (isLynx) {
        const d = lynxDef.find((l) => normKey(l.cat) === normKey(r.cat));
        if (d) Object.assign(patchN, { hides: d.hides, hidePrice: d.hidePrice, meters: d.meters, meterPrice: d.meterPrice, work: d.work, base: d.base, sample: 0, locked: true, src: "manual" });
      } else Object.assign(patchN, { locked: false });
      const id = cat.id;
      ns = ns.map((n) => (n.id === id ? { ...n, ...patchN } : n));
      touched.add(id);
    }
    // Значения по данным системы — только для загруженных строк без своих цифр; остальные строки бюджета не трогаем.
    const calcd = autoCalc(ns, stats, params);
    ns = ns.map((n, i) => (touched.has(n.id) && !n.locked ? calcd[i] : n));
    // После загрузки все строки типа «Рысь» фиксируются замком.
    const lynxIds = new Set(ns.filter((n) => n.kind === "fur" && normKey(n.name) === "рысь").map((n) => n.id));
    ns = ns.map((n) => (lynxIds.has(n.id) || (n.parentId && lynxIds.has(n.parentId)) ? { ...n, locked: true, src: n.kind === "fur" ? n.src : n.src === "none" ? "manual" : n.src } : n));
  return ns;
}
