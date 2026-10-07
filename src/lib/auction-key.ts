// Ключ сравнения названий аукционов: без регистра, ё=е, пробелы и разделители даты ( - – — . / ) считаются одним знаком.
// «СП 03.25», «сп 03-25» и «СП  03.25» — один ключ. Чистая функция, годится и для клиента, и для скриптов.

/** Первая строка Purchase.auctionSession (у группы закупок так хранится название аукциона). */
export function firstLine(text: string | null | undefined): string {
  return (text ?? "").split(/\r?\n/)[0].trim();
}

export function auctionKey(text: string | null | undefined): string {
  return firstLine(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s\-–—./_]+/g, " ")
    .trim();
}

/** Приставки служебных заглушек импорта (как в auction-names.ts). */
const SERVICE_KEY_PREFIXES = ["нет информации", "не в реестре остатков", "подкладочные материалы", "доп закупк", "без аукциона"];
export function isServiceKey(key: string): boolean {
  return SERVICE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** Заменить первую строку названия (остальные строки сохраняются). */
export function replaceFirstLine(text: string, name: string): string {
  const i = text.search(/\r?\n/);
  return i < 0 ? name : name + text.slice(i);
}
