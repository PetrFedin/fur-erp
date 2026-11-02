// Расчёт закупки сырья на план 2027 (Budget PCS FW27) — один для страницы Budget PCS, отчёта «План производства 2027» и Excel «Сырьё и бюджет FW27».
// Чистые функции, без базы и React: на вход строки Budget PCS, склад и потребность FW26 (raw-balance), цены, параметры и правки с экрана.
import { buildPcsView, minkSexOf, pcsMixKey, ttlOf, type MinkSexStock, type PcsBlock, type PcsParams, type PcsRow } from "@/lib/budget-pcs";

/** Пустое поле — значение по умолчанию, иначе число в пределах [min, 100]. */
export const pctOr = (v: string, d: number, min = 0) => { if (v.trim() === "") return d; const x = parseFloat(v.replace(",", ".")); return Number.isFinite(x) ? Math.min(100, Math.max(min, x)) : d; };

/** Правки с экрана — строки, как в полях ввода (пусто — значение из параметров / по умолчанию). */
export type SupplyOverrides = {
  left: Record<string, string>; mix: { mink: string; sable: string }; res: Record<string, string>; rtw: Record<string, string>; buyRes: Record<string, string>;
  /** Рост цены %, запас на оставшиеся FW26 %, годный остаток на аксессуары % (по умолчанию для «в одежду»). */
  u: string; x: string; a: string;
};
const str = (o: Record<string, number> | undefined) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, String(v)]));
/** Правки, равные сохранённым параметрам (для отчётов без экрана правок). */
export function overridesFromParams(p: PcsParams): SupplyOverrides {
  return { left: str(p.left), mix: { mink: p.mix ? String(p.mix.mink) : "", sable: p.mix ? String(p.mix.sable) : "" }, res: str(p.reserve), rtw: str(p.rtw), buyRes: str(p.buyRes),
    u: String(p.upPct ?? 10), x: String(p.fw26Extra ?? 5), a: String(p.accPct ?? 75) };
}

export type SupplyInput = {
  rows: PcsRow[]; blocks: PcsBlock[]; raw: { fur: string; stock: number; need: number; total?: number }[];
  mix: { RTW: number; Acc: number }; price: Record<string, number>; minkStock: MinkSexStock | null; params: PcsParams; ov: SupplyOverrides;
};
export type SupplyBlock = { t: number; left: number; usable: number; used: number };
export type SupplyFurRow = { label: string; ttl: number; mixed: false; t: number; stock: number; need: number; left: number; leftAll: number; calcLeft: number; use: number; np: number;
  res: number; bres: number; buy: number; buyPriced: number; pr: number; money: number; rem26: number; remBuy: number; up: number; by: Partial<Record<PcsBlock, SupplyBlock>> };
export type SupplyMixRow = { label: string; ttl: number; mixed: true; toMink: number; toSable: number; calcMink: number; calcSable: number };
export type SexRow = { code: "M" | "F" | "U"; label: string; stock: number; left: number; use: number; need: number; short: number; extra: number; buy: number };

export const RES_DEFAULT = 30;
export function supplyKnobs(ov: SupplyOverrides) {
  const resOf = (fur: string) => { const v = parseFloat((ov.res[fur] ?? "").replace(",", ".")); return Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : RES_DEFAULT; };
  const rtwDefault = 100 - pctOr(ov.a, 75);
  const rtwOf = (fur: string) => { const v = parseFloat((ov.rtw[fur] ?? "").replace(",", ".")); return (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : rtwDefault) / 100; };
  const buyResOf = (fur: string) => { const v = parseFloat((ov.buyRes[fur] ?? "").replace(",", ".")); return Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : resOf(fur); };
  return { resOf, rtwDefault, rtwOf, buyResOf };
}

/** Доля норки в строке «Норка+Соболь»: решение владельца (mixRows), иначе — по факту ТЗ. */
export const minkShareOf = (r: PcsRow, p: PcsParams, mix: { RTW: number; Acc: number }) => { const v = p.mixRows?.[pcsMixKey(r)]; return v != null ? v / 100 : mix[r.block]; };

export function computeSupply(inp: SupplyInput) {
  const { rows: cur, blocks, mix, price, minkStock, params: p0, ov } = inp;
  const { resOf, rtwOf, buyResOf } = supplyKnobs(ov);
  const rawBy = new Map(inp.raw.map((r) => [r.fur, r]));
  // Сводка по типам меха (как таблица страницы): сумма по выбранным блокам.
  const tree = buildPcsView(cur, blocks);
  const fm = new Map<string, { pcs: number; pcsA: number; ttl: number; hasAvg: boolean }>();
  for (const root of tree) for (const f of root.children) { const o = fm.get(f.label) ?? { pcs: 0, pcsA: 0, ttl: 0, hasAvg: false }; o.pcs += f.pcs; o.pcsA += f.pcsA; o.ttl += f.ttl; o.hasAvg = o.hasAvg || f.hasAvg; fm.set(f.label, o); }
  const furs = [...fm.entries()].map(([label, v]) => ({ label, ...v })).filter((f) => f.pcs > 0 || f.hasAvg).sort((a, b) => b.pcs - a.pcs);

  const own = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(parseFloat(v.replace(",", "."))) ? d : Math.max(0, parseFloat(v.replace(",", "."))));
  const up = pctOr(ov.u, 10); // пустое поле — 10 %, «0» — без роста
  // Шкуры по типу меха и блоку. «Норка+Соболь» делим на норку и соболь по доле норки строки (решение владельца), без неё — по факту ТЗ.
  const minkShare = (r: PcsRow) => minkShareOf(r, p0, mix);
  const ttl = new Map<string, Record<PcsBlock, number>>();
  const add = (fur: string, b: PcsBlock, v: number) => { const o = ttl.get(fur) ?? { RTW: 0, Acc: 0 }; o[b] += v; ttl.set(fur, o); };
  const mM = { RTW: 0, Acc: 0 }, mS = { RTW: 0, Acc: 0 };
  for (const r of cur) {
    if (!blocks.includes(r.block)) continue;
    const t = ttlOf(r) ?? 0;
    if (r.fur === "Норка+Соболь") { const s = minkShare(r); mM[r.block] += t * s; mS[r.block] += t * (1 - s); } else add(r.fur, r.block, t);
  }
  const calcMink = mM.RTW + mM.Acc, calcSable = mS.RTW + mS.Acc;
  const toMink = own(ov.mix.mink, calcMink), toSable = own(ov.mix.sable, calcSable);
  // Свои шкуры из смеси делим по блокам в той же пропорции, что и расчётные.
  const kM = calcMink > 0 ? toMink / calcMink : 0, kS = calcSable > 0 ? toSable / calcSable : 0;
  for (const b of blocks) { add("Норка", b, mM[b] * kM); add("Соболь", b, mS[b] * kS); }
  if (calcMink === 0 && toMink > 0) add("Норка", blocks[0], toMink);
  if (calcSable === 0 && toSable > 0) add("Соболь", blocks[0], toSable);
  // Остаток делится между блоками: в одежду — свой % вида меха (лучшая часть), остальное — в аксессуары;
  // каждый блок берёт только своё годное: старое сырьё из доли аксессуаров в одежду не идёт, сверх нужного — остаётся на складе (владелец 02.11).
  const share = (fur: string, b: PcsBlock) => (b === "RTW" ? rtwOf(fur) : 1 - rtwOf(fur));
  const rows: (SupplyFurRow | SupplyMixRow)[] = furs.map((f) => {
    if (f.label === "Норка+Соболь") return { label: f.label, ttl: f.ttl, mixed: true as const, toMink, toSable, calcMink, calcSable };
    // Возьмём со склада на оставшиеся изделия FW26 = части без списания по ТЗ, по норме, + запас % к ним; по ТЗ со списанием расход точный и уже списан —
    // второй раз не вычитаем (владелец 02.11 вечер; как Excel, лист 4).
    const extra = pctOr(ov.x, 5) / 100;
    const r = rawBy.get(f.label), stock = r?.stock ?? 0, need = (r?.need ?? 0) * (1 + extra);
    const calcLeft = Math.max(0, stock - need), leftAll = own(ov.left[f.label] ?? "", calcLeft);
    const res = resOf(f.label), bres = buyResOf(f.label);
    // Годный остаток = остаток × (1 − невостребованное); блок использует меньшее из «нужно» и «своё годное»;
    // закупить = нужно из покупки ÷ (1 − «останется купленного, %»).
    let t = 0, left = 0, use = 0, np = 0, used = 0;
    const by: Partial<Record<PcsBlock, SupplyBlock>> = {};
    for (const b of blocks) {
      const sh = share(f.label, b), tb = ttl.get(f.label)?.[b] ?? 0, lb = leftAll * sh, ub = lb * (1 - res / 100), ud = Math.min(tb, ub);
      // Нехватка на уже запланированное (склад меньше «нужно»): тоже покупаем, по доле блока.
      t += tb; left += lb; use += ub; used += ud; np += tb - ud + Math.max(0, need - stock) * sh;
      by[b] = { t: tb, left: lb, usable: ub, used: ud };
    }
    const buy = np / (1 - bres / 100);
    const pr = price[f.label] ?? 0, money = buy * pr * (1 + up / 100);
    // Останется после заказа 2027: от остатка 2026 (невостребованное + годное сверх нужного блокам) и купленного (запас).
    return { label: f.label, ttl: f.ttl, mixed: false as const, t, stock, need, left, leftAll, calcLeft, use, np, res, bres, buy, buyPriced: pr > 0 ? buy : 0, pr, money, rem26: left - used, remBuy: buy - np, up, by };
  });
  const furRows = rows.filter((r): r is SupplyFurRow => !r.mixed);
  // Норка по полу (только «Вместе»): Short — самцы, Regular и Long — самки (minkSex); остальным пол не важен.
  let sex: null | { rows: SexRow[]; buy: number } = null;
  const mink = furRows.find((x) => x.label === "Норка");
  if (minkStock && blocks.length === 2 && mink) {
    const needBy = { M: 0, F: 0, U: 0 };
    for (const r of cur) {
      if (r.fur !== "Норка" && r.fur !== "Норка+Соболь") continue;
      const t = (ttlOf(r) ?? 0) * (r.fur === "Норка" ? 1 : minkShare(r) * (kM || 1));
      needBy[minkSexOf(r, p0.minkSex) ?? "U"] += t;
    }
    const st = minkStock, all = st.M + st.F + st.U;
    const base = (code: "M" | "F" | "U", label: string): SexRow => {
      const left = all > 0 ? mink.leftAll * (st[code] / all) : 0, use = left * (1 - mink.res / 100);
      return { code, label, stock: st[code], left, use, need: needBy[code], short: 0, extra: 0, buy: 0 };
    };
    const M = base("M", "Самцы (M)"), F = base("F", "Самки (F)"), U = base("U", "Пол не указан / не важен");
    for (const x of [M, F]) { x.short = Math.max(0, x.need - x.use); x.extra = Math.max(0, x.use - x.need); }
    const avail = U.use + M.extra + F.extra;
    U.short = Math.max(0, U.need - avail); U.extra = Math.max(0, avail - U.need);
    // Закупить по полу = не хватает ÷ (1 − X); закупка норки = большее из «по блокам» и «по полу» (как Excel, лист 7).
    for (const x of [M, F, U]) x.buy = x.short / (1 - mink.bres / 100);
    sex = { rows: [M, F, U], buy: M.buy + F.buy + U.buy };
    if (sex.buy > mink.buy) { const k = sex.buy / mink.buy; mink.buy = sex.buy; mink.buyPriced = mink.pr > 0 ? sex.buy : 0; mink.money *= k; mink.remBuy = mink.buy - mink.np; }
  }
  const sum = (k: "stock" | "need" | "left" | "use" | "np" | "buy" | "buyPriced" | "money" | "rem26" | "remBuy") => furRows.reduce((a, r) => a + r[k], 0);
  return { furs, rows, sex, kM, total: { stock: sum("stock"), need: sum("need"), left: sum("left"), use: sum("use"), np: sum("np"), buy: sum("buy"), buyPriced: sum("buyPriced"), money: sum("money"), rem26: sum("rem26"), remBuy: sum("remBuy") } };
}
