import type { VerifyRow } from "@/lib/verification";

/**
 * Повторы в очереди «Подтвердить»: одинаковые суммы с одной датой и одинаковые номера документов.
 * Только подсказка «оставить одну запись» — ничего не считает, не удаляет и не сливает.
 */
export type DupGroup = { id: string; reason: string; rows: VerifyRow[]; keep: VerifyRow };

const supplierOf = (r: VerifyRow) => (r.sub ?? "").split(" · ")[0].trim().toLowerCase();

/** Какую запись оставить: подтверждённая, затем готовая, затем с документом-основанием, затем первая по названию. */
function pickKeep(rows: VerifyRow[]): VerifyRow {
  const score = (r: VerifyRow) => (r.verified ? 4 : 0) + (r.ready ? 2 : 0) + (r.edit?.ref ? 1 : 0);
  return [...rows].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, "ru", { numeric: true }))[0];
}

export function findDuplicates(rows: VerifyRow[]): DupGroup[] {
  const buckets = new Map<string, { reason: string; rows: VerifyRow[] }>();
  const add = (key: string, reason: string, r: VerifyRow) => {
    const b = buckets.get(key) ?? { reason, rows: [] };
    b.rows.push(r);
    buckets.set(key, b);
  };
  for (const r of rows) {
    if (r.kind === "payment" || r.kind === "prodPayment") {
      if (r.edit?.amount && r.edit.date) add(`sum|${r.kind}|${r.edit.amount}|${r.edit.date}`, `одинаковая сумма ${r.amountText ?? r.edit.amount} в один день`, r);
    } else if (r.kind === "purchase") {
      if (r.amountText && r.edit?.date) add(`sum|purchase|${supplierOf(r)}|${r.amountText}|${r.edit.date}`, `один поставщик, сумма ${r.amountText} и дата заказа`, r);
      const num = r.edit?.number?.trim().toLowerCase();
      if (num) add(`doc|purchase|${supplierOf(r)}|${num}`, `один и тот же счёт/УПД № ${r.edit?.number}`, r);
    }
  }
  const out: DupGroup[] = [];
  for (const [id, b] of buckets) {
    if (b.rows.length < 2) continue;
    out.push({ id, reason: b.reason, rows: b.rows, keep: pickKeep(b.rows) });
  }
  return out.sort((a, b) => b.rows.length - a.rows.length || a.reason.localeCompare(b.reason, "ru"));
}
