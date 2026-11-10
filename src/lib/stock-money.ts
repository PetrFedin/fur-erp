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

/** Закупка остатка по листу отчёта (Excel «Отчёт: продажи», столбцы Stock EUR): по артикулу+цвету — остаток × закупочная цена изделия.
 * FW26: остаток = получено − продано товара FW26 в свой сезон, цена = поступило € ÷ шт. (нет прихода — заказ € ÷ шт.);
 * всего: остаток = получено по трём сезонам − продано, цена = заказ всего € ÷ шт. (закрытые сезоны: заказано = получено). */
export function leafStockEur(rows: ReportSizeRow[]): { fw: number; all: number } {
  const groups = new Map<string, ReportSizeRow[]>();
  for (const r of rows) { const k = `${r.acode}|${r.color}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  let fw = 0, all = 0;
  for (const g of groups.values()) {
    let dFw = 0, eFw = 0, cFw = 0, ceFw = 0, ssn = 0, dAll = 0, sold = 0, tc = 0, te = 0;
    for (const r of g) {
      sold += r.sold ?? 0;
      for (const [s, c] of Object.entries(r.seas ?? {})) {
        dAll += c.deliv ?? 0;
        const open = s === "FW26/27";
        tc += open ? c.conf ?? 0 : c.conf ?? c.deliv ?? 0;
        te += open ? c.confEur ?? 0 : c.confEur ?? c.delivEur ?? 0;
        if (open) { dFw += c.deliv ?? 0; eFw += c.delivEur ?? 0; cFw += c.conf ?? 0; ceFw += c.confEur ?? 0; ssn += c.soldSsn ?? 0; }
      }
    }
    const uFw = dFw > 0 && eFw > 0 ? eFw / dFw : cFw > 0 && ceFw > 0 ? ceFw / cFw : 0;
    const uAll = tc > 0 && te > 0 ? te / tc : uFw;
    fw += (dFw - ssn) * uFw;
    all += (dAll - sold) * uAll;
  }
  return { fw, all };
}
