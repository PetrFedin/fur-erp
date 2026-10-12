// Ставка НДС по дате документа (закупка / УПД): до 01.01.2026 — 20%, с 01.01.2026 — 22%.
// Чистые функции без БД — используются и в формах, и в аудите (scripts/audit-vat-2026.ts).

export const VAT_CUTOFF = new Date("2026-01-01T00:00:00Z");
export const VAT_BEFORE_2026 = 20;
export const VAT_FROM_2026 = 22;

/** Ставка по дате документа; без даты — действующая ставка (22). */
export function vatRateForDate(date: Date | string | null | undefined): number {
  if (!date) return VAT_FROM_2026;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return VAT_FROM_2026;
  return d.getTime() < VAT_CUTOFF.getTime() ? VAT_BEFORE_2026 : VAT_FROM_2026;
}

/** Подпись периода: «куплено до 2026» / «куплено с 2026». */
export function vatPeriodLabel(date: Date | string | null | undefined): string {
  if (!date) return "дата не указана";
  return vatRateForDate(date) === VAT_BEFORE_2026 ? "куплено до 2026" : "куплено с 2026";
}

/**
 * Ставка для НОВОЙ записи материала: явная ставка по умолчанию у материала приоритетнее, иначе по дате.
 * `warning` — материал задан со ставкой, не совпадающей с датой документа.
 */
export function resolveVatRate(
  materialDefault: number | string | null | undefined,
  date: Date | string | null | undefined,
): { rate: number; source: "material" | "date"; byDate: number; warning: string | null } {
  const byDate = vatRateForDate(date);
  const def = materialDefault == null || materialDefault === "" ? null : Number(materialDefault);
  if (def == null || !Number.isFinite(def)) return { rate: byDate, source: "date", byDate, warning: null };
  const warning = def !== byDate && date
    ? `У материала задана ставка ${def}%, а по дате документа (${vatPeriodLabel(date)}) должна быть ${byDate}%`
    : null;
  return { rate: def, source: "material", byDate, warning };
}
