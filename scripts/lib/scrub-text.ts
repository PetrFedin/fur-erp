/**
 * Правила очистки текстов от упоминаний Google Диска и «MVST» (решения владельца от 16.10.2026):
 *   А. «MVST» → «THE FUR» (регистр: MVST → THE FUR, mvst → the fur, Mvst → The Fur);
 *   Б. ссылки и упоминания Диска убираем; «в Drive нет» → «не прикреплён/нет»;
 *   В. фразы про внешние реестры/файлы («единый реестр «…MVST…», лист …, строка N») вырезаем целиком.
 * Общая логика для scripts/scrub-drive-and-mvst-2026-10-16.ts (БД) и scripts/scrub-data-json-2026-10-16.ts (src/data/*.json).
 */
import { createHash } from "node:crypto";

/** Устойчивый внутренний ключ файла вместо идентификатора Диска: «doc-» + первые 24 hex SHA-256. */
export function internalFileKey(externalId: string): string {
  return "doc-" + createHash("sha256").update(externalId).digest("hex").slice(0, 24);
}

/** Шаг очистки: регулярное выражение → замена. */
type Rule = [RegExp, string | ((...m: string[]) => string)];

/** Вырезаемые фразы (правило В) и конкретные обороты про Диск (правило Б) — до общих замен. */
const PHRASES: Rule[] = [
  // --- ссылки
  [/\s*https?:\/\/(?:drive|docs)\.google\.com\/\S*/g, ""],
  // --- внешние реестры (В)
  [/единый реестр «[^»]*»,\s*лист «[^»]*»,\s*строка \d+ \([^)]*\):\s*/g, ""],
  [/создано по строке единого реестра Drive \([^)]*\):\s*/g, ""],
  [/\s*\(итого по реестру\)/g, ""],
  [/Работа по реестру: /g, "Работа: "],
  [/; реестр 218 860,00/g, ""],
  [/(^|\n)Единый реестр: (\S)/g, (_m, a, b) => a + b.toUpperCase()],
  [/единый реестр — /g, ""],
  [/ — «Единый реестр»(?= \()/g, ""],
  [/, «Единый реестр»; дата и п\/п — реестр \(/g, "; дата и п/п ("],
  [/ — «Единый реестр» и УПД/g, " — УПД"],
  [/«Единый реестр» и УПД/g, "УПД"],
  [/;?\s*реестр «[^»]*» \(единый реестр, Drive [A-Za-z0-9_-]+\)/g, ""],
  [/ \(единый реестр, Drive [A-Za-z0-9_-]+\)/g, ""],
  [/, единый реестр Drive/g, ""],
  // --- файл баланса на Диске (Payment/ProductionPayment.notes)
  [/\s*\(файл «[^»]*», папка «мех» на Drive, (договор подряда №\d+)\)/g, " ($1)"],
  [/\s*\(файл «[^»]*», папка «мех» на Drive\)/g, ""],
  // --- движения склада
  [/ТЗ-документу Drive/g, "приложению к ТЗ"],
  [/, Drive \d{4}\/[^:)]*(?=[:)])/g, ""],
  [/ по документу Drive «ПРИЛОЖЕНИЕ/g, " по приложению к ТЗ «ПРИЛОЖЕНИЕ"],
  // --- «нет в Drive» → «не прикреплён»
  [/Новый документ после систематизации Drive (\d\d\.\d\d\.\d{4})\./g, "Новый документ, добавлен $1."],
  [/\(оплаты в Drive нет\)/g, "(платёжка не прикреплена)"],
  [/Платёжки в Drive нет/g, "Платёжка не прикреплена"],
  [/п\/п в Drive нет/g, "п/п не прикреплено"],
  [/Файла счёта Веллмех на эту сумму в Drive нет/g, "Файл счёта Веллмех на эту сумму не прикреплён"],
  [/(Отдельный файл счёта №\d+ на [\d ]+) в Drive —/g, "$1 —"],
  [/УПД на рысь в Drive нет/g, "УПД на рысь не прикреплён"],
  [/УПД \(приход\) в Drive отсутствует/g, "УПД (приход) не прикреплён"],
  [/Документов в Drive нет/g, "Документов нет"],
  [/Счёта и письма в Drive нет/g, "Счёта и письма нет"],
  [/ в Drive нечитаем/g, " нечитаем"],
  [/Приложения ТЗ №(\d+) в Drive нет/g, "Приложение ТЗ №$1 не прикреплено"],
  [/Файл Drive: «/g, "Файл: «"],
  [/ \(Google Drive\)/g, ""],
  [/по документам Drive это /g, "это "],
  [/ по документам и датам файлов Drive:/g, " по документам и датам файлов:"],
  [/(Создана )?([Пп]о) документам Drive:/g, (_m, a, b) => (a ? "Создана по документам:" : b === "По" ? "По документам:" : "по документам:")],
  [/ в Drive (нет|отсутствует|есть)\b/g, " $1"],
];

const MVST: Rule[] = [
  [/MVST/g, "THE FUR"],
  [/Mvst/g, "The Fur"],
  [/mvst/g, "the fur"],
];

function run(s: string, rules: Rule[]): string {
  let out = s;
  for (const [re, to] of rules) out = typeof to === "string" ? out.replace(re, to) : out.replace(re, to as (...m: string[]) => string);
  return out;
}

/** Остаточные упоминания: то, что правила не покрыли (латинское слово Drive/Google, ссылки Google, «Диск»). */
export const RESIDUAL_RE = /Drive|drive\.google|docs\.google|Google|Диск|googleusercontent/;
export const residual = (s: string): string | null => {
  const m = RESIDUAL_RE.exec(s);
  return m ? s.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, " ") : null;
};

/** Заметка/описание/комментарий: вырезать фразы про Диск и внешние реестры, MVST → THE FUR. */
export function scrubNote(s: string): string {
  return run(run(s, PHRASES), MVST);
}

/** Название документа/файла: только MVST → THE FUR (название остаётся названием). */
export function scrubTitle(s: string): string {
  return run(s, MVST);
}

/** Рекурсивно по JSON: очищает все строковые значения как заметки. Возвращает новую структуру. */
export function scrubJson<T>(v: T): T {
  if (typeof v === "string") return scrubNote(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => scrubJson(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scrubJson(x);
    return out as T;
  }
  return v;
}
