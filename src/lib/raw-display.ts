// Показ сырья на Главной в целых рублях, сходящихся по иерархии (правило — src/lib/money-round.ts).
// Чистые функции без React и без базы: их вызывают блоки Главной, а scripts/test-rounding-rule.ts проверяет на реальных данных,
// что сумма показанных частей равна показанному итогу. Данные не меняются — меняется только то, что рисуем.
import { addCells as addMoney, alignFlowSet, alignKindsTop, alignSet, cellOf, subCells, type Cell } from "@/lib/money-round";
import type { FlowFigures } from "@/lib/fur-table";
import type { Cells, CellsPair, RawTableRow, YearRow } from "@/lib/dashboard-data";

type Pair = { incl: FlowFigures; excl: FlowFigures };
export type FurSrcKey = "all" | "auction" | "supplier";
export const FUR_SRC_KEYS_RD: FurSrcKey[] = ["all", "auction", "supplier"];

export type FurSrcData = Record<FurSrcKey, { total: Pair; types: { name: string; pair: Pair }[] }>;
/** Мех, подкладка и мех по источникам/видам — в целых рублях, сходящихся вниз по иерархии. Данные не меняются, только показ. */
export function alignRaw(fur: Pair, lining: Pair, furSrc: FurSrcData, c4: "on" | "off"): { fur: Pair; lining: Pair; furSrc: FurSrcData } {
  const bo = c4 === "on";
  const out = { fur: {} as Pair, lining: {} as Pair, furSrc: { all: { types: [] }, auction: { types: [] }, supplier: { types: [] } } as unknown as FurSrcData };
  for (const k of FUR_SRC_KEYS_RD) out.furSrc[k] = { total: {} as Pair, types: furSrc[k].types.map((t) => ({ name: t.name, pair: {} as Pair })) };
  for (const v of ["incl", "excl"] as const) {
    const top = alignFlowSet(undefined, [fur[v], lining[v]], bo);
    out.fur[v] = top.parts[0];
    out.lining[v] = top.parts[1];
    const two = alignFlowSet(out.fur[v], [furSrc.auction.total[v], furSrc.supplier.total[v]], bo);
    const totals = { all: out.fur[v], auction: two.parts[0], supplier: two.parts[1] };
    for (const k of FUR_SRC_KEYS_RD) {
      const t = alignFlowSet(totals[k], furSrc[k].types.map((x) => x.pair[v]), bo);
      out.furSrc[k].total[v] = t.total;
      t.parts.forEach((p, i) => { out.furSrc[k].types[i].pair[v] = p; });
    }
  }
  return out;
}

/** Точные деньги строки года по виду сырья → Cell (куплено, использовано без 4%, остаток, оплачено, долг). */
export const yearCell = (c: Cells, m: { paid: number; debt: number }): Cell => cellOf({ r: c.rv, u: c.uv, m: c.mv, p: m.paid, d: m.debt });
export const cellsWith = (c: Cells, x: Cell): Cells => ({ ...c, rv: x.r, uv: x.u, mv: x.m });

/**
 * «Динамика по годам» в целых рублях, сходящихся по обеим осям (src/lib/money-round.ts): «Всего» = round(точной суммы);
 * мех и подкладка, а также года выравниваются под него наибольшими остатками. Цифры в данных не меняются — только показ.
 */
export function alignYears(rows: YearRow[]): YearRow[] {
  const all = rows.find((r) => r.key === "all");
  if (!all) return rows;
  const yrs = rows.filter((r) => r.key !== "all");
  const furC = { incl: {} as Cell, excl: {} as Cell }, linC = { incl: {} as Cell, excl: {} as Cell };
  const outFur = new Map<string, CellsPair>(), outLin = new Map<string, CellsPair>();
  const money = new Map<string, YearRow["money"]>();
  const rowTot = new Map<string, { paid: number; debt: number }>();
  let first = true;
  for (const v of ["incl", "excl"] as const) {
    const top = alignKindsTop(yearCell(all.fur[v], all.money.fur), yearCell(all.lining[v], all.money.lining));
    furC[v] = top.fur; linC[v] = top.lin;
    const ex = (r: YearRow, k: "fur" | "lining") => yearCell(r[k][v], r.money[k]);
    const yAll = alignSet(yrs.map((r) => addMoney([ex(r, "fur"), ex(r, "lining")])), top.all); // «Всего» по годам → под «Всего»
    const yFur = alignSet(yrs.map((r) => ex(r, "fur")), top.fur); // мех по годам → под «Мех»
    const put = (m: Map<string, CellsPair>, key: string, base: Cells, x: Cell) => { const cur = m.get(key) ?? ({} as CellsPair); cur[v] = cellsWith(base, x); m.set(key, cur); };
    put(outFur, "all", all.fur[v], top.fur); put(outLin, "all", all.lining[v], top.lin);
    yrs.forEach((r, i) => {
      const lin = subCells(yAll.parts[i], yFur.parts[i]); // подкладка года = «Всего» года − мех года: сумма по годам даёт подкладку
      put(outFur, r.key, r.fur[v], yFur.parts[i]); put(outLin, r.key, r.lining[v], lin);
      if (first) {
        money.set(r.key, { fur: { paid: yFur.parts[i].p, debt: yFur.parts[i].d }, lining: { paid: lin.p, debt: lin.d } });
        rowTot.set(r.key, { paid: yAll.parts[i].p, debt: yAll.parts[i].d });
      }
    });
    if (first) {
      money.set("all", { fur: { paid: top.fur.p, debt: top.fur.d }, lining: { paid: top.lin.p, debt: top.lin.d } });
      rowTot.set("all", { paid: top.all.p, debt: top.all.d });
      first = false;
    }
  }
  return rows.map((r) => ({ ...r, fur: outFur.get(r.key) ?? r.fur, lining: outLin.get(r.key) ?? r.lining, money: money.get(r.key) ?? r.money, paid: rowTot.get(r.key)?.paid ?? r.paid, debt: rowTot.get(r.key)?.debt ?? r.debt }));
}


export type RawTableMoneyIn = { paid: number; due: number; unreceived: { paid: number; due: number; names: string[]; byFur: { label: string; names: string[]; paid: number; due: number }[] } };
/**
 * «Динамика по сырью» в целых рублях: «Всего» → мех / подкладка / не получено и прочее → виды → аукционы (наибольшие остатки на каждом шаге).
 * Итог каждого уровня — round(точной суммы); уровни ниже складываются в показанное значение уровня выше.
 */
export function alignRawTable(a: { rows: RawTableRow[]; vat: "incl" | "excl"; sel: FurSrcKey; money: RawTableMoneyIn; total: CellsPair }) {
  const { rows, vat, sel, money, total } = a;
  const addC = (list: Cells[]): Cells => {
    const s = list.reduce((x, c) => ({ rq: x.rq + c.rq, rv: x.rv + c.rv, uq: x.uq + c.uq, uv: x.uv + c.uv, mq: x.mq + c.mq, mv: x.mv + c.mv, uo: x.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
    const r = (v: number, q: number) => (q > 0 ? v / q : null);
    return { ...s, ra: r(s.rv, s.rq), ua: r(s.uv, s.uq), ma: r(s.mv, s.mq), uoa: r(s.uo, s.uq) };
  };
  const furEx = rows.filter((r) => r.kind === "fur");
  const linEx = rows.filter((r) => r.kind === "lining");
  const furSubEx = addC(furEx.map((r) => r.cells[vat]));
  const linSubEx = addC(linEx.map((r) => r.cells[vat]));
  const TEx = sel === "all" ? total[vat] : addC([furSubEx, linSubEx]);
  const tPaidEx = sel === "all" ? money.paid : rows.reduce((a, r) => a + r.paid, 0);
  const tDueEx = sel === "all" ? money.due : rows.reduce((a, r) => a + r.due, 0);
  // Все суммы — целые рубли, сходящиеся по иерархии «Всего → мех / подкладка / не получено → виды → аукционы» (src/lib/money-round.ts).
  const AL = (() => {
    const cellOfRow = (cells: Cells, paid: number, due: number): Cell => cellOf({ r: cells.rv, u: cells.uv, m: cells.mv, p: paid, d: due });
    const rowCell = (r: RawTableRow) => cellOfRow(r.cells[vat], r.paid, r.due);
    const sub = (list: RawTableRow[]) => addMoney(list.map(rowCell));
    // Деньги по закупкам без лотов (мех не получен) и прочее: только paid / due.
    const extrasEx: Cell[] = [];
    if (sel === "all") {
      const u = money.unreceived;
      u.byFur.forEach((g) => extrasEx.push(cellOf({ p: g.paid, d: g.due })));
      extrasEx.push(cellOf({ p: u.paid - u.byFur.reduce((a, g) => a + g.paid, 0), d: u.due - u.byFur.reduce((a, g) => a + g.due, 0) }));
      extrasEx.push(cellOf({ p: money.paid - rows.reduce((a, r) => a + r.paid, 0) - u.paid, d: money.due - rows.reduce((a, r) => a + r.due, 0) - u.due }));
    }
    const totalEx = cellOfRow(TEx, tPaidEx, tDueEx);
    const top = alignSet([sub(furEx), sub(linEx), ...extrasEx], totalEx);
    const furA = top.parts[0], linA = top.parts[1];
    const byKey = new Map<string, Cell>();
    const byAuc = new Map<string, Cell>();
    for (const [list, tot] of [[furEx, furA], [linEx, linA]] as const) {
      const a = alignSet(list.map(rowCell), tot);
      list.forEach((r, i) => {
        byKey.set(r.key, a.parts[i]);
        if (r.auctions.length === 0) return;
        const k = alignSet(r.auctions.map((x) => cellOfRow(x.cells[vat], x.paid, x.due)), a.parts[i]);
        r.auctions.forEach((x, j) => byAuc.set(r.key + "|" + x.key, k.parts[j]));
      });
    }
    return { total: top.total, fur: furA, lin: linA, extras: top.parts.slice(2), byKey, byAuc };
  })();
  return { furEx, linEx, furSubEx, linSubEx, TEx, AL };
}
