import type { ReportSizeRow } from "@/lib/margin-tree";

/** Закупочная цена изделия размера по отчёту «заказ и продажи», €: поступило € ÷ поступило шт. по трём сезонам (с НДС, как SC EUR в правиле маркапа 110). */
export function sizeUnitEur(r: ReportSizeRow): { deliv: number; eur: number; unit: number | null } {
  let deliv = 0, eur = 0;
  for (const c of Object.values(r.seas ?? {})) { deliv += c.deliv ?? 0; eur += c.delivEur ?? 0; }
  return { deliv, eur, unit: deliv > 0 && eur > 0 ? eur / deliv : null };
}
/** Закупочная цена изделия размера в одном сезоне, €. */
export function seasonUnitEur(r: ReportSizeRow, season: string): number | null {
  const c = r.seas?.[season]; const d = c?.deliv ?? 0, e = c?.delivEur ?? 0;
  return d > 0 && e > 0 ? e / d : null;
}
/** Остаток размера (получено по трём сезонам − продано) в штуках и в € по закупочной цене размера. */
export function sizeStockEur(r: ReportSizeRow): { pcs: number; eur: number } {
  const { deliv, unit } = sizeUnitEur(r);
  const pcs = deliv - (r.sold ?? 0);
  return { pcs, eur: unit ? pcs * unit : 0 };
}
