import type { VerifyRow } from "@/lib/verification";

/**
 * Повторы в очереди «Подтвердить»: одинаковые суммы с одной датой и одинаковые номера документов.
 * Только подсказка «оставить одну запись» — ничего не считает, не удаляет и не сливает.
 */
export type DupGroup = { id: string; reason: string; rows: VerifyRow[]; keep: VerifyRow; note?: string; verifiedCase?: boolean };

/**
 * Подтверждённые случаи «одна поставка на несколько закупок» (проверено по письмам и документам).
 * Единственное место со списком: в очереди нет списка файлов закупки, поэтому по данным их не определить.
 */
const SPLIT_DELIVERIES: { doc: string; purchases: string[]; text: string }[] = [
  { doc: "100", purchases: ["З-2026-0032", "З-2026-0060"], text: "одна поставка на две закупки (проверено): счёт/УПД № 100 / № 109, 680,3 м на 1 455 842 ₽, письма от 01.07.2025" },
  { doc: "109", purchases: ["З-2026-0032", "З-2026-0060"], text: "одна поставка на две закупки (проверено): счёт/УПД № 100 / № 109, 680,3 м на 1 455 842 ₽, письма от 01.07.2025" },
];
const HINT_SPLIT = "возможно, одна поставка на несколько закупок: если у закупок один и тот же набор документов и их примечания ссылаются друг на друга или суммы позиций дополняют друг друга, это не повтор";

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
    const g: DupGroup = { id, reason: b.reason, rows: b.rows, keep: pickKeep(b.rows) };
    if (id.startsWith("doc|purchase|")) {
      const doc = id.split("|")[3];
      const known = SPLIT_DELIVERIES.find((k) => k.doc === doc && k.purchases.every((n) => b.rows.some((r) => r.title.includes(n))));
      if (known) { g.note = known.text; g.verifiedCase = true; } else g.note = HINT_SPLIT;
    }
    out.push(g);
  }
  return out.sort((a, b) => b.rows.length - a.rows.length || a.reason.localeCompare(b.reason, "ru"));
}
