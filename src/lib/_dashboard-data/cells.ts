// Чистые помощники ячеек и НДС Сводки (вынесены из dashboard-data.ts без изменений).
import { countsAsBought } from "@/domain/purchased";
import { figures, flowOf, type C4Kind, type FlowFigures, type FurLot } from "@/lib/fur-table";
import type { Cells, CellsPair, Ordered, VatByRate } from "./types";

export const cellsOf = (f: FlowFigures): Cells => ({ rq: f.recvQty, rv: f.recvValue, ra: f.recvAvg, uq: f.usedQty, uv: f.usedValue, ua: f.usedAvg, mq: f.remQty, mv: f.remValue, ma: f.remAvg, uo: f.usedValueOther, uoa: f.usedQty > 0 ? Math.round((f.usedValueOther / f.usedQty) * 100) / 100 : null });
/** Заказанное, но ещё не полученное считаем купленным и лежащим в остатке (использовано — 0): прибавляем к «Куплено» и «Остаток». */
export const bumpCells = (c: Cells, q: number, v: number): Cells => {
  const rq = c.rq + q, rv = c.rv + v, mq = c.mq + q, mv = c.mv + v;
  return { ...c, rq, rv, ra: rq > 0 ? Math.round((rv / rq) * 100) / 100 : null, mq, mv, ma: mq > 0 ? Math.round((mv / mq) * 100) / 100 : null };
};
/** Шкуры подрядчика (оплачены в составе пошива, лотов нет): купленное и сразу израсходованное, остаток 0. */
export const withHides = (p: CellsPair, v: { incl: number; excl: number } | undefined): CellsPair => {
  if (!v) return p;
  const f = (c: Cells, x: number): Cells => ({ ...c, rv: c.rv + x, uv: c.uv + x, uo: c.uo + x, ra: c.rq > 0 ? Math.round(((c.rv + x) / c.rq) * 100) / 100 : null, ua: c.uq > 0 ? Math.round(((c.uv + x) / c.uq) * 100) / 100 : null });
  return { incl: f(p.incl, v.incl), excl: f(p.excl, v.excl) };
};
// Решение владельца 21.10.2026 (отменяет исключение от 20.10): заказанное, но не принятое (черновики FH 06.26, СП 09.26) снова входит в «Куплено» и «Остаток»
// (использовано 0), чтобы «Куплено» по меху сходилось с «общей стоимостью меха» из оплат (оплачено + долг). Поле ordered хранит эту сумму отдельно.
// Правило одно на всё приложение — src/domain/purchased.ts: заказанное, но не принятое, входит в «Куплено».
export const BOUGHT_ORDERED = { has: (_fur: string) => countsAsBought("ordered") };
export const withOrdered = (p: CellsPair, o?: Ordered): CellsPair => (o && (o.qty > 0 || o.incl > 0) ? { incl: bumpCells(p.incl, o.qty, o.incl), excl: bumpCells(p.excl, o.qty, o.excl) } : p);
export const bumpFigures = (f: FlowFigures, q: number, v: number): FlowFigures => {
  const recvQty = f.recvQty + q, recvValue = f.recvValue + v, remQty = f.remQty + q, remValue = f.remValue + v;
  return { ...f, recvQty, recvValue, recvAvg: recvQty > 0 ? Math.round((recvValue / recvQty) * 100) / 100 : null, remQty, remValue, remAvg: remQty > 0 ? Math.round((remValue / remQty) * 100) / 100 : null };
};
// Таблицы «Динамика по годам» и «по сырью» показывают «Использовано» всегда без 4% (4% — отдельно, в виджетах и себестоимости).
export const cellsPair = (lots: FurLot[], _c4: C4Kind): CellsPair => {
  const fl = flowOf(lots);
  return { incl: cellsOf(figures(fl, { vat: "incl", c4: "off" })), excl: cellsOf(figures(fl, { vat: "excl", c4: "off" })) };
};
export const addVat = (m: VatByRate, rate: number | string, v: number) => { if (Number.isFinite(v) && Math.abs(v) > 0.000001) m[String(rate)] = (m[String(rate)] ?? 0) + v; };
// «Итого» = сумма строк по каждой аддитивной колонке (куплено, использовано, остаток, произведено, оплачено, долг).
// Средневзвешенные цены в итоговой строке считаются от сумм, а не складываются.
export const sumCells = (list: Cells[]): Cells => {
  const t = list.reduce((a, c) => ({ rq: a.rq + c.rq, rv: a.rv + c.rv, uq: a.uq + c.uq, uv: a.uv + c.uv, mq: a.mq + c.mq, mv: a.mv + c.mv, uo: a.uo + c.uo }), { rq: 0, rv: 0, uq: 0, uv: 0, mq: 0, mv: 0, uo: 0 });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const avg = (v: number, q: number) => (q > 0 ? r2(v / q) : null);
  return { rq: r3(t.rq), rv: r2(t.rv), ra: avg(t.rv, t.rq), uq: r3(t.uq), uv: r2(t.uv), ua: avg(t.uv, t.uq), mq: r3(t.mq), mv: r2(t.mv), ma: avg(t.mv, t.mq), uo: r2(t.uo), uoa: avg(t.uo, t.uq) };
};
export const sumPair = (list: CellsPair[]): CellsPair => ({ incl: sumCells(list.map((c) => c.incl)), excl: sumCells(list.map((c) => c.excl)) });
export const addHidesFig = (f: FlowFigures, v: number): FlowFigures => ({ ...f, recvValue: f.recvValue + v, recvAvg: f.recvQty > 0 ? Math.round(((f.recvValue + v) / f.recvQty) * 100) / 100 : null, usedValue: f.usedValue + v, usedValueOther: f.usedValueOther + v, usedAvg: f.usedQty > 0 ? Math.round(((f.usedValue + v) / f.usedQty) * 100) / 100 : null });
export const lotVat = (ls: FurLot[], k: "recv" | "used" | "rem"): VatByRate => {
  const m: VatByRate = {};
  for (const l of ls) addVat(m, l.vatRate, k === "recv" ? l.recvIncl - l.recvExcl : k === "used" ? l.usedIncl - l.usedExcl : l.remIncl - l.remExcl);
  return m;
};
export const mergeVat = (...list: VatByRate[]): VatByRate => { const m: VatByRate = {}; for (const x of list) for (const [r, v] of Object.entries(x)) addVat(m, r, v); return m; };
