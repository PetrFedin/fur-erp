/**
 * Подчистка текстов из внешних выгрузок (docs-inventory/*.json) перед показом: «MVST» → «THE FUR»,
 * упоминания Диска убираются. Чистая функция, без обращения к БД.
 */
export function cleanText(s: string): string {
  return s
    .replace(/MVST/g, "THE FUR")
    .replace(/Mvst/g, "The Fur")
    .replace(/mvst/g, "the fur")
    .replace(/\s*https?:\/\/(?:drive|docs)\.google\.com\/\S*/g, "")
    .replace(/ в Drive (нет|отсутствует|есть)\b/g, " $1")
    .replace(/по документам Drive/g, "по документам")
    .replace(/документ(ы|ов|ам|ах)? Drive/g, (_m, e) => `документ${e ?? ""}`)
    .replace(/\s*\(?Google Drive\)?/g, "")
    .replace(/\bDrive\b/g, "документы");
}
