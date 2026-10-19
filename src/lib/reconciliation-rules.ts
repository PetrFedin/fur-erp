import { vatRateForDate } from "@/lib/vat-by-date";

/** Правила ввода реестра сверки: чистые функции без БД (используются формами и тестом). */

/** Сегодняшняя календарная дата по Москве, ГГГГ-ММ-ДД. */
export function mskToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** «1 234 567,89» / «1234567.89» → число; пусто → null; мусор → NaN. */
export function parseMoney(v: unknown): number | null {
  const s = String(v ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
}

/** ГГГГ-ММ-ДД (из поля date) либо ДД.ММ.ГГГГ → ГГГГ-ММ-ДД; пусто → null; не дата → "bad". */
export function parseIsoDate(v: unknown): string | null | "bad" {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let iso = s;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "bad";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return "bad";
  return iso;
}

export type InvoiceCheckInput = { no: string | null; date: string | null; amountRub: number | null; vatRate: number | null; vatRub: number | null };

/** Проверка счёта: сумма, дата, НДС. Возвращает текст ошибки либо null. */
export function checkInvoiceFields(i: InvoiceCheckInput, today: string): string | null {
  if (i.amountRub == null || Number.isNaN(i.amountRub)) return "Укажите сумму счёта числом, например 1 234 567,89";
  if (i.amountRub <= 0) return "Сумма счёта должна быть больше нуля";
  if (i.amountRub > 99_999_999_999) return "Сумма счёта слишком большая: проверьте, нет ли лишних цифр";
  if (i.date) {
    if (i.date < "2020-01-01") return "Дата счёта раньше 2020 года: проверьте год";
    if (i.date > today) return "Дата счёта в будущем: проверьте число и месяц";
  }
  if (i.vatRate != null) {
    if (Number.isNaN(i.vatRate)) return "НДС укажите числом: 20, 22 или 0 (без НДС)";
    const want = vatRateForDate(i.date ?? today);
    if (i.vatRate !== 0 && i.vatRate !== want) return `По дате счёта ${i.date ? `(${i.date.split("-").reverse().join(".")}) ` : ""}ставка НДС ${want} %, а указано ${i.vatRate} %. Для счёта без НДС укажите 0`;
    if (i.vatRub != null) {
      if (Number.isNaN(i.vatRub) || i.vatRub < 0) return "Сумма НДС — неотрицательное число";
      const expect = (i.amountRub * i.vatRate) / (100 + i.vatRate);
      if (Math.abs(expect - i.vatRub) > 1) return `Сумма НДС ${i.vatRub.toLocaleString("ru-RU")} ₽ не сходится с суммой счёта: при ставке ${i.vatRate} % она ${expect.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽ (сумма счёта — с НДС)`;
    }
  } else if (i.vatRub != null) {
    return "Сумма НДС указана без ставки: выберите ставку";
  }
  return null;
}

/** Стабильный ключ счёта: «секция:номер:дата» (как у перенесённых счетов); при занятом ключе добавляется -2, -3… */
export function invoiceKey(section: string, no: string | null, date: string | null, year: number | null, taken: Set<string>): string {
  const base = `${section}:${no ?? "без-счёта"}:${date ?? year ?? ""}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export const groupKeyOf = (section: string, title: string) => `${section === "production" ? "W" : "P"}:${title.trim()}`;

export type DupCandidate = { id: string; no: string | null; date: string | null; year: number | null; groupKeys: string[] };

/** Дубль: в той же группе уже есть счёт с тем же номером и той же датой (или годом, если даты нет). */
export function findDuplicateInvoice(existing: DupCandidate[], cand: { id?: string; no: string | null; date: string | null; year: number | null; groupKeys: string[] }): DupCandidate | null {
  if (!cand.no) return null;
  const no = cand.no.trim().toLowerCase();
  return (
    existing.find(
      (e) =>
        e.id !== cand.id &&
        (e.no ?? "").trim().toLowerCase() === no &&
        e.groupKeys.some((g) => cand.groupKeys.includes(g)) &&
        (e.date && cand.date ? e.date === cand.date : e.year === cand.year),
    ) ?? null
  );
}
