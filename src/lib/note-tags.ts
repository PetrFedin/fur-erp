/**
 * Служебные пометки загрузки данных в примечаниях (метки вида [fix:P07], [open-items:no-stock], [письма backup 2026-10-08],
 * ключи импорта bulk-import-…:row-N, «создано скриптом …») человеку не нужны. Существующие записи переписаны простым языком
 * (scripts/rewrite-notes-plain.ts); эти функции — страховка для новых записей: в тексте для чтения такие пометки вырезаются.
 * В форме редактирования примечание показывается как есть.
 *
 * Признаки, от которых зависит логика («сырьё подрядчика», «ТЗ без партии», подпись в списке закупок), в тексте не хранятся:
 * это поля Purchase.isContractorRaw, Purchase.listLabel, ProductionOrder.batchNotRequired.
 */

/** Метка в квадратных скобках: латинский «код» с двоеточием/дефисом ([fix:P07], [mail-beaver:…]) или с датой ГГГГ-ММ-ДД внутри. */
const TAG_RE = /\s*\[(?:[a-z][\w]*[:\-][^\]]*|[^\]]*\b20\d\d-\d\d-\d\d\b[^\]]*)\]/gi;
/** Ключ импорта целой строкой: bulk-import-registry-2026-09:row-454, import-sp0926:3017. */
const IMPORT_KEY_RE = /^(?:bulk-import|import)[\w-]*:.*$/gim;
/** «Создано скриптом apply-…», «Привязка скриптом link-… (…)». */
const SCRIPT_SENTENCE_RE = /\s*(?:Создан[оа]|Привязка|Привязан[оа]?)\s+скриптом\s+[\w.-]+(?:\s*\([^)]*\))?\.?/gi;
/** Имя скрипта в скобках: (apply-drive-production-corrections), (fix-lining-prices.ts), (scripts/foo.ts). */
const SCRIPT_NAME_RE = /\s*\((?:scripts\/)?(?:apply|fix|link|import|create|consolidate)-[\w.-]+\)/gi;

export function stripServiceTags(s: string): string {
  return s
    .replace(IMPORT_KEY_RE, "")
    .replace(TAG_RE, "")
    .replace(SCRIPT_SENTENCE_RE, "")
    .replace(SCRIPT_NAME_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;·]+|[\s,;·]+$/g, "")
    .trim();
}

/** Заметка для показа: без служебных пометок; пусто → null. */
export function cleanNote(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = stripServiceTags(s);
  return t || null;
}
