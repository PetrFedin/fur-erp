// Строки окна «Цена по видам сырья» по произвольному набору лотов (таблица «Мех / Подкладка» при фильтрах: плитки считаются на клиенте).
// Чистая функция без базы: те же figures/flowOf, что и в dashboard-data.ts (rawTable), но без денег по аукционам.
import { figures, flowOf, type FlowFigures, type FurLot } from "./fur-table";
import type { Cells, CellsPair, RawTableRow } from "./dashboard-data";

const cellsOf = (f: FlowFigures): Cells => ({
  rq: f.recvQty, rv: f.recvValue, ra: f.recvAvg, uq: f.usedQty, uv: f.usedValue, ua: f.usedAvg, mq: f.remQty, mv: f.remValue, ma: f.remAvg,
  uo: f.usedValueOther, uoa: f.usedQty > 0 ? Math.round((f.usedValueOther / f.usedQty) * 100) / 100 : null,
});
const pairOf = (lots: FurLot[]): CellsPair => {
  const fl = flowOf(lots);
  return { incl: cellsOf(figures(fl, { vat: "incl", c4: "off" })), excl: cellsOf(figures(fl, { vat: "excl", c4: "off" })) };
};
const usdOf = (lots: FurLot[]) => {
  const f = figures(flowOf(lots), { vat: "incl", c4: "off" });
  return { bought: f.usdAvg, used: f.usdUsedAvg, rem: f.usdRemAvg };
};

/** Строки «вид меха / ткань» с разбивкой по годам закупки — вход PriceModal (деньги по аукционам не нужны: paid/due = 0). */
export function rawRowsFromLots(lots: FurLot[]): RawTableRow[] {
  const groups = new Map<string, FurLot[]>();
  for (const l of lots) {
    const k = `${l.kind}|${l.item}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const rows: RawTableRow[] = [];
  for (const [key, ls] of groups) {
    rows.push({
      key, label: ls[0].item, kind: ls[0].kind, cells: pairOf(ls), paid: 0, due: 0, usd: usdOf(ls), auctions: [], lots: ls.length,
      years: Array.from(new Set(ls.map((l) => l.year))).sort((a, b) => a - b).map((y) => {
        const yl = ls.filter((l) => l.year === y);
        return { year: y, cells: pairOf(yl), usd: usdOf(yl) };
      }),
    });
  }
  return rows;
}
