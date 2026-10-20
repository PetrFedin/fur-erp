// Виды платежей (аванс / доплата / окончательный расчёт / прочее) — один набор для «Оплат» и окна «Потрачено» в Cashflow.
import { PAY_TYPE_LABEL, type PayType } from "@/lib/cashflow-detail";

export type { PayType };
export const PAY_KINDS = Object.keys(PAY_TYPE_LABEL) as PayType[];
export const KIND_BUTTON_LABEL: Record<PayType, string> = { ADVANCE: "Авансы", PARTIAL: "Доплаты", FINAL: "Окончательный расчёт", OTHER: "Прочее" };
export const parseKind = (v: string | string[] | undefined): PayType | null => (typeof v === "string" && (PAY_KINDS as string[]).includes(v) ? (v as PayType) : null);

/** Сколько платёжек (п/п) в строках: одна п/п может быть разнесена на несколько строк (сырьё + работа, несколько партий или ТЗ); строка без номера — своя платёжка. */
export function countPayslips(rows: { id?: string; code?: string; pp?: string | null }[]): number {
  return new Set(rows.map((r, i) => (r.pp ? `pp${r.pp}` : `row${r.id ?? r.code ?? i}`))).size;
}

const word = (k: number, a: string, b: string, c: string) => (k % 10 === 1 && k % 100 !== 11 ? a : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 10 || k % 100 >= 20) ? b : c);

/** «67 платёжек (88 строк разнесения)»: платёжки и строки — разные числа, пока одна п/п разнесена на несколько строк; иначе одно число. */
export function payslipsCaption({ slips, rows }: { slips: number; rows: number }): string {
  const base = `${slips} ${word(slips, "платёжка", "платёжки", "платёжек")}`;
  return slips === rows ? base : `${base} (${rows} ${word(rows, "строка", "строки", "строк")} разнесения)`;
}
export const payslipsText = (rows: { id?: string; code?: string; pp?: string | null }[]) => payslipsCaption({ slips: countPayslips(rows), rows: rows.length });

/** Число строк, платёжек (п/п) и сумма по видам платежа (неизвестный вид — «Прочее»); Σ видов = Σ всех платежей. */
export function kindTotals<R extends { type: string; amount: number; id?: string; code?: string; pp?: string | null }>(rows: R[]): Record<PayType, { count: number; slips: number; total: number }> {
  const out = Object.fromEntries(PAY_KINDS.map((k) => [k, { count: 0, slips: 0, total: 0 }])) as Record<PayType, { count: number; slips: number; total: number }>;
  const by = Object.fromEntries(PAY_KINDS.map((k) => [k, [] as R[]])) as Record<PayType, R[]>;
  for (const r of rows) {
    const k = (PAY_KINDS as string[]).includes(r.type) ? (r.type as PayType) : "OTHER";
    out[k].count++; out[k].total += r.amount; by[k].push(r);
  }
  for (const k of PAY_KINDS) out[k].slips = countPayslips(by[k]);
  return out;
}
