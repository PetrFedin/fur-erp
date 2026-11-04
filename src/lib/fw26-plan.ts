// План прихода FW 26/27 по месяцам: общие расчёты для таблицы «Приход по месяцам» (season-receipts.tsx) и для Excel (/sales/fw26-plan).
// Без React и без базы: чистые функции, чтобы цифры в таблице и в файле считались одинаково.
import type { ReportSizeRow } from "@/lib/margin-tree";

export const FC_MONTHS = ["2026-11", "2026-12", "2027-01"] as const;
export type Overrides = Record<string, Record<string, number>>;

/** Артикул в файле и в отчёте пишется по-разному («MH-03 SABLE…» и «MH-03/SABLE…»): сравнение без знаков и пробелов. */
export const artKey = (a: string) => a.toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
export const leafKeyOf = (article: string, color: string | null | undefined) => `${artKey(article)}|${(color ?? "").toUpperCase()}`;

/** Делит целое `total` по весам методом наибольших остатков. */
export function splitInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, x) => a + x, 0);
  const w = sum > 0 ? weights : weights.map(() => 1), ws = sum > 0 ? sum : weights.length;
  const raw = w.map((x) => (total * x) / ws), fl = raw.map(Math.floor);
  let left = total - fl.reduce((a, x) => a + x, 0);
  raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i] += 1; left -= 1; } });
  return fl;
}

/**
 * Взаимозачёт корректировок прихода: минус в месяце гасит ближайшие ПРЕДЫДУЩИЕ плюсовые месяцы того же артикула и цвета (сначала самый поздний).
 * Так «+1 в августе и −1 в октябре» исчезают оба, а итог по артикулу не меняется. Минус без предшествующего прихода (в данных не встречается) остаётся как есть.
 */
export function netMonths(mm: Map<string, number>): Map<string, number> {
  const keys = [...mm.keys()].sort();
  const v = new Map(mm);
  for (const k of keys) {
    const x = v.get(k) ?? 0;
    if (x >= 0) continue;
    let need = -x;
    for (const p of keys.filter((q) => q < k).reverse()) {
      const have = v.get(p) ?? 0;
      if (have <= 0) continue;
      const take = Math.min(have, need);
      v.set(p, have - take); need -= take;
      if (need === 0) break;
    }
    v.set(k, need === 0 ? 0 : -need);
  }
  for (const [k, x] of [...v]) if (x === 0) v.delete(k);
  return v;
}

/**
 * Ноябрь и декабрь по «ждём» артикула: то, что покрыто нашими ТЗ (в том числе сделанные, но не пришедшие), приходит в ноябре;
 * остаток заказа без ТЗ делится пополам между ноябрём и декабрём. Январь по умолчанию 0 (его вносят вручную).
 */
export function baseForecast(aw: number, tzPart: number): { nov: number; dec: number } {
  const t = Math.min(aw, Math.max(0, Math.round(tzPart)));
  const nov = t + Math.round((aw - t) / 2);
  return { nov, dec: aw - nov };
}

/** «Ждём по ТЗ» модели делится между её артикулами-цветами пропорционально их «ждём» (методом наибольших остатков), но не больше «ждём». */
export function tzPartsByModel(items: { model: string; aw: number }[], tzByModel: Map<string, number>): number[] {
  const out = items.map(() => 0);
  const byModel = new Map<string, number[]>();
  items.forEach((it, i) => { const l = byModel.get(it.model) ?? []; l.push(i); byModel.set(it.model, l); });
  for (const [model, idx] of byModel) {
    const tz = Math.round(tzByModel.get(model) ?? 0);
    if (tz <= 0) continue;
    const total = idx.reduce((a, i) => a + items[i].aw, 0);
    const take = Math.min(tz, total);
    const parts = splitInt(take, idx.map((i) => items[i].aw));
    idx.forEach((i, j) => { out[i] = Math.min(items[i].aw, parts[j]); });
  }
  return out;
}

export const monthLabelRu = (k: string) => `${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

// ───────────────────────── Строки для Excel ─────────────────────────
export type PlanInput = {
  sizes: ReportSizeRow[];
  receipts: { article: string; colorId: string | null; iso: string; pcs: number }[];
  /** «Ждём по ТЗ» по моделям (код модели через normCode) — объём наших ТЗ минус получено. */
  tz: { model: string; qty: number }[];
  overrides: Overrides;
  janOn: boolean;
  furRu: (k: string) => string;
};
export type PlanRow = {
  /** 0 — кат. 1, 1 — мех, 2 — кат. 2, 3 — артикул, 4 — цвет, 5 — размер. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  labels: [string, string, string, string, string, string];
  conf: number; deliv: number; aw: number;
  months: Record<string, number>; fc: Record<string, number>;
  /** На размере месяцы прихода не показываются: в файле поступлений размера нет. */
  noMonths: boolean;
};
export type Plan = { months: string[]; fcMonths: string[]; rows: PlanRow[]; total: PlanRow };

export function buildFw26Plan(input: PlanInput): Plan {
  const S = "FW26/27";
  const fcMonths = FC_MONTHS.filter((m) => m !== "2027-01" || input.janOn) as string[];
  // Приход по месяцам из файла поступлений: артикул+цвет → месяц → шт. (только FW 26/27).
  const recv = new Map<string, Map<string, number>>();
  for (const r of input.receipts) {
    if (!r.pcs) continue;
    const k = leafKeyOf(r.article, r.colorId), m = r.iso.slice(0, 7);
    const a = recv.get(k) ?? new Map<string, number>(); recv.set(k, a);
    a.set(m, (a.get(m) ?? 0) + r.pcs);
  }
  type Leaf = { key: string; model: string; article: string; color: string; l1: string; fur: string; l2: string; conf: number; mm: Map<string, number>; sizes: ReportSizeRow[]; deliv: number; aw: number };
  const leaves = new Map<string, Leaf>();
  for (const r of input.sizes) {
    const c = r.seas?.[S]; if (!c) continue;
    const k = leafKeyOf(r.acode, r.color);
    const leaf = leaves.get(k) ?? { key: k, model: r.modelCode ?? "", article: r.acode, color: r.color ?? "", l1: (r.l3 || "(без категории)").trim(), fur: input.furRu(r.fur ?? "Не указан"), l2: (r.l4 || r.l5 || "(без категории)").trim(), conf: 0, mm: netMonths(recv.get(k) ?? new Map()), sizes: [], deliv: 0, aw: 0 };
    leaf.conf += c.conf ?? 0;
    leaf.sizes.push(r);
    leaves.set(k, leaf);
  }
  const list = [...leaves.values()].filter((l) => { l.deliv = [...l.mm.values()].reduce((a, x) => a + x, 0); l.aw = Math.max(0, l.conf - l.deliv); return l.conf || l.deliv; });
  const tzByModel = new Map<string, number>();
  for (const t of input.tz) tzByModel.set(t.model, (tzByModel.get(t.model) ?? 0) + t.qty);
  const tzParts = tzPartsByModel(list.map((l) => ({ model: l.model, aw: l.aw })), tzByModel);

  const blank = (level: PlanRow["level"], labels: PlanRow["labels"], noMonths = false): PlanRow => ({ level, labels, conf: 0, deliv: 0, aw: 0, months: {}, fc: Object.fromEntries(fcMonths.map((m) => [m, 0])), noMonths });
  const add = (n: PlanRow, conf: number, deliv: number, aw: number, months: Map<string, number> | Record<string, number>, fc: Record<string, number>) => {
    n.conf += conf; n.deliv += deliv; n.aw += aw;
    for (const [m, v] of months instanceof Map ? months : Object.entries(months)) n.months[m] = (n.months[m] ?? 0) + v;
    for (const m of fcMonths) n.fc[m] += fc[m] ?? 0;
  };
  // Дерево: кат. 1 → мех → кат. 2 → артикул → цвет → размер.
  type Node = { row: PlanRow; kids: Map<string, Node> };
  const root: Map<string, Node> = new Map();
  const total = blank(0, ["Всего", "", "", "", "", ""]);
  const months = new Set<string>();
  list.forEach((l, i) => {
    const { nov, dec } = baseForecast(l.aw, tzParts[i]);
    const base: Record<string, number> = { "2026-11": nov, "2026-12": dec, "2027-01": 0 };
    const fc: Record<string, number> = {};
    for (const m of FC_MONTHS) fc[m] = input.overrides[l.key]?.[m] ?? base[m];
    for (const m of l.mm.keys()) months.add(m);
    const path: [string, string, string, string, string] = [l.l1, l.fur, l.l2, l.article, l.color || "(без цвета)"];
    let level = root; const labels: string[] = [];
    path.forEach((name, d) => {
      labels.push(name);
      let node = level.get(name);
      if (!node) { node = { row: blank(d as PlanRow["level"], [...labels, ...Array(6 - labels.length).fill("")] as PlanRow["labels"]), kids: new Map() }; level.set(name, node); }
      add(node.row, l.conf, l.deliv, l.aw, l.mm, fc);
      level = node.kids;
    });
    add(total, l.conf, l.deliv, l.aw, l.mm, fc);
    // Размеры: заказ и приход по отчёту; прогноз цвета делится по «ждём» размеров.
    const sz = [...l.sizes].sort((a, b) => (Number(a.size) || 1e6) - (Number(b.size) || 1e6) || String(a.size).localeCompare(String(b.size)));
    const sAw = splitInt(l.aw, sz.map((r) => Math.max(0, (r.seas?.[S]?.conf ?? 0) - (r.seas?.[S]?.deliv ?? 0))));
    const sFc: Record<string, number[]> = {};
    for (const m of fcMonths) sFc[m] = splitInt(fc[m], sAw);
    sz.forEach((r, j) => {
      const row = blank(5, [...labels, r.size || "(без размера)"] as PlanRow["labels"], true);
      row.conf = r.seas?.[S]?.conf ?? 0; row.deliv = r.seas?.[S]?.deliv ?? 0; row.aw = sAw[j];
      for (const m of fcMonths) row.fc[m] = sFc[m][j];
      level.set(`${r.size}|${j}`, { row, kids: new Map() });
    });
  });
  const order = (a: Node, b: Node) => b.row.deliv - a.row.deliv || b.row.conf - a.row.conf || a.row.labels.join("|").localeCompare(b.row.labels.join("|"), "ru");
  const rows: PlanRow[] = [];
  const walk = (m: Map<string, Node>) => {
    const arr = [...m.values()];
    const isSize = arr.length > 0 && arr[0].row.level === 5;
    if (!isSize) arr.sort(order);
    for (const n of arr) { rows.push(n.row); walk(n.kids); }
  };
  walk(root);
  return { months: [...months].sort(), fcMonths, rows, total };
}
