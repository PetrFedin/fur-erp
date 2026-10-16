// Сумма счёта Веллмеха («к оплате по счёту») из принятого расчёта аукциона — чистая часть, без базы.
// Нужна статусу оплаты сырья для подрядчика: «Оплачено / Частично / Не оплачено» считается ТОЛЬКО против счёта Веллмеха,
// а не против всей себестоимости закупки. В себестоимость входят и расходы, которые мы платим не Веллмеху (выделка, перевозка,
// брокерские и комиссии третьим лицам): на СП 09-26 это 3 627 050 ₽ сверх счёта № 271 на 60 831 100 ₽.
//
// Откуда берётся сумма счёта (по порядку):
//   1. в расчёте есть столбец «Итого к оплате» — берём его;
//   2. иначе столбцы «К оплате …» (аванс 1, аванс 2…) — берём их сумму (СП 09-26: «К оплате: аванс 1» = 60 831 063,87);
//   3. иначе счёт покрывает весь расчёт («Всего в руб.» — то, что в УПД; SAGA 03-26: 49 388 424,63 при оплатах 49 472 300).
// Суммы считаются по строкам расчёта и раскладываются по счетам аукциона по номеру счёта строки.
import { calcAll, type CalcPayload } from "@/lib/supplier-calc";

/** Нормализация номера счёта («№ 083» = «83»): то же правило, что в supplier-pay-core (здесь свой экземпляр, чтобы модуль был самодостаточным). */
export const dueInvoiceKey = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");

export type DueSource = "TOTAL_COLUMN" | "PAY_COLUMNS" | "CALC_TOTAL";
export type InvoiceDue = {
  /** Сумма счёта Веллмеха по всему расчёту, ₽ с НДС как в расчёте. */
  total: number;
  /** То же по счетам аукциона (ключ — dueInvoiceKey номера счёта строки; пустой номер — ключ ""). */
  byInvoice: Map<string, number>;
  source: DueSource;
  /** Какие столбцы дали сумму (для пояснения и тестов). */
  columns: string[];
  /** Вся себестоимость расчёта (для сравнения «до»: что считалось к оплате раньше). */
  calcTotal: number;
};

const TOTAL_RE = /итого\s+к\s+оплате/i;
const PAY_RE = /к\s+оплате/i;

/** null — расчёт пустой или не считается (нет ни одной годной строки). */
export function calcInvoiceDue(p: CalcPayload): InvoiceDue | null {
  const t = calcAll(p);
  const sh = t.sheet;
  const rows = p.rows.map((_, i) => i).filter((i) => sh.used[i]);
  if (rows.length === 0) return null;
  const cand = sh.cols.filter((c) => !c.text && PAY_RE.test(c.title));
  const totalCols = cand.filter((c) => TOTAL_RE.test(c.title));
  const picked = totalCols.length ? [totalCols[0]] : cand;
  const source: DueSource = totalCols.length ? "TOTAL_COLUMN" : cand.length ? "PAY_COLUMNS" : "CALC_TOTAL";
  const mult = (unit: string | undefined) => ((unit ?? "").includes("$") ? t.rate || 1 : 1);

  const byInvoice = new Map<string, number>();
  let total = 0;
  for (const i of rows) {
    const v = source === "CALC_TOTAL" ? t.calcs[i]?.totalRub ?? 0 : picked.reduce((a, c) => a + (sh.cells[c.id]?.[i]?.v ?? 0) * mult(c.unit), 0);
    if (!Number.isFinite(v)) continue;
    const k = dueInvoiceKey(p.rows[i].invoice);
    byInvoice.set(k, (byInvoice.get(k) ?? 0) + v);
    total += v;
  }
  return { total, byInvoice, source, columns: picked.map((c) => c.title), calcTotal: t.totalRub };
}

/**
 * Раскладка суммы счёта по закупкам (счетам аукциона). purchases — закупки этого расчёта: номер счёта и вес (их прежняя сумма,
 * нужна только если номер строки расчёта не нашёлся). Возвращает сумму к оплате по каждой закупке.
 * Номера нашлись у всех и в расчёте нет «ничьих» строк — берём прямо по номерам. Иначе разность делится пропорционально весу.
 */
export function allocateDue(due: InvoiceDue, purchases: { id: string; invoice: string; weight: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const keyOf = (x: { invoice: string }) => dueInvoiceKey(x.invoice);
  const matched = purchases.filter((p) => keyOf(p) && due.byInvoice.has(keyOf(p)));
  const used = new Set(matched.map(keyOf));
  // два закупки с одним номером счёта делят его сумму пропорционально весу
  for (const p of matched) {
    const same = matched.filter((x) => keyOf(x) === keyOf(p));
    const w = same.reduce((a, x) => a + Math.max(0, x.weight), 0);
    const share = w > 0 ? Math.max(0, p.weight) / w : 1 / same.length;
    out.set(p.id, (due.byInvoice.get(keyOf(p)) ?? 0) * share);
  }
  const leftover = due.total - [...due.byInvoice].filter(([k]) => used.has(k)).reduce((a, [, v]) => a + v, 0);
  const rest = purchases.filter((p) => !out.has(p.id));
  if (rest.length === 0 && Math.abs(leftover) > 0.005 && matched.length) {
    // строки без известного номера счёта: добавляем пропорционально уже разложенному
    const base = matched.reduce((a, p) => a + (out.get(p.id) ?? 0), 0) || 1;
    for (const p of matched) out.set(p.id, (out.get(p.id) ?? 0) + (leftover * (out.get(p.id) ?? 0)) / base);
  } else if (rest.length > 0) {
    const w = rest.reduce((a, p) => a + Math.max(0, p.weight), 0);
    for (const p of rest) out.set(p.id, w > 0 ? (leftover * Math.max(0, p.weight)) / w : leftover / rest.length);
  }
  return out;
}
