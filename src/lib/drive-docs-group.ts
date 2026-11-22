// Единый ключ схлопывания повторов в списках документов (закупка, партия, ТЗ, оплата, аукцион).
// Без обращения к БД: можно импортировать и в клиентских компонентах.

const EXT_RE = /\.(pdf|xlsx?|docx?|jpe?g|png|csv|txt|zip|rar|eml|msg)$/i;

/**
 * Нормализованное название: нижний регистр, без расширения, без «(1)»/«копия»/«copy»,
 * пробелы (в т.ч. неразрывные и двойные) убраны — «Re  дополнительная…» и «Re дополнительная…» совпадают.
 */
export function normDocTitle(title: string): string {
  let s = title.normalize("NFC").toLowerCase().replace(/ё/g, "е");
  s = s.replace(/[\s ]+/g, " ").trim();
  s = s.replace(EXT_RE, "");
  s = s.replace(/\s*[-–—_]?\s*(копия|copy)(\s*\(?\d+\)?)?\s*$/i, "");
  s = s.replace(/\s*\(\d+\)\s*$/g, "");
  s = s.replace(/^(копия|copy)\s+(of|от)?\s*/i, "");
  return s.replace(/[\s_]+/g, "");
}

/** Ключ группы: название + тип + размер (неизвестный размер = «?», тогда группируем по названию и типу). */
export function docGroupKey(title: string, docType: string, size: number | null | undefined): string {
  return `${normDocTitle(title)}|${docType}|${size && size > 0 ? size : "?"}`;
}

/** Собирает группы, сохраняя порядок первого появления. */
export function groupBy<T>(items: T[], keyOf: (x: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const g = map.get(k);
    if (g) g.push(it);
    else map.set(k, [it]);
  }
  return [...map.values()];
}

/** «×N» + склонение «копии». */
export function copiesLabel(n: number): string {
  return `×${n} копии`;
}

/** Заголовок «Документы (N)» после схлопывания: «12 файлов» или «12 файлов · 51 привязка» (один файл мог быть привязан к нескольким закупкам и лотам). */
export function countLabel(groups: number, records: number): string {
  const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
  const files = `${groups} ${plural(groups, "файл", "файла", "файлов")}`;
  return groups === records ? files : `${files} · ${records} ${plural(records, "привязка", "привязки", "привязок")}`;
}

/**
 * Пары «загруженный файл + ссылка Drive» одного файла: название Drive-документа совпадает с именем файла
 * (или названием) после нормализации, а размер — если известен у обоих — равен.
 * Возвращает для каждого файла индексы подходящих Drive-документов; Drive-документ достаётся только первому подходящему файлу.
 */
export function matchDriveToFiles(
  files: { names: string[]; size: number }[],
  drives: { titles: string[]; size?: number | null }[],
): number[][] {
  const used = new Set<number>();
  return files.map((f) => {
    const fk = f.names.filter(Boolean).map(normDocTitle);
    const hit: number[] = [];
    drives.forEach((d, i) => {
      if (used.has(i)) return;
      if (d.size && f.size && d.size !== f.size) return;
      if (d.titles.filter(Boolean).map(normDocTitle).some((t) => fk.includes(t))) {
        used.add(i);
        hit.push(i);
      }
    });
    return hit;
  });
}
