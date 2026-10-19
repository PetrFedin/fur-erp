// Виды платежей (аванс / доплата / окончательный расчёт / прочее) — один набор для «Оплат» и окна «Потрачено» в Cashflow.
import { PAY_TYPE_LABEL, type PayType } from "@/lib/cashflow-detail";

export type { PayType };
export const PAY_KINDS = Object.keys(PAY_TYPE_LABEL) as PayType[];
export const KIND_BUTTON_LABEL: Record<PayType, string> = { ADVANCE: "Авансы", PARTIAL: "Доплаты", FINAL: "Окончательный расчёт", OTHER: "Прочее" };
export const parseKind = (v: string | string[] | undefined): PayType | null => (typeof v === "string" && (PAY_KINDS as string[]).includes(v) ? (v as PayType) : null);

/** Число и сумма платежей по видам (неизвестный вид — «Прочее»); Σ видов = Σ всех платежей. */
export function kindTotals(rows: { type: string; amount: number }[]): Record<PayType, { count: number; total: number }> {
  const out = Object.fromEntries(PAY_KINDS.map((k) => [k, { count: 0, total: 0 }])) as Record<PayType, { count: number; total: number }>;
  for (const r of rows) {
    const k = (PAY_KINDS as string[]).includes(r.type) ? (r.type as PayType) : "OTHER";
    out[k].count++; out[k].total += r.amount;
  }
  return out;
}
