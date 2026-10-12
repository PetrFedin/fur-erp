// Единица «ТЗ» = номер ТЗ из документа (workOrderNumber), а не запись в базе.
// Один документ ТЗ может содержать несколько артикулов — это несколько записей (позиций) с общим номером ТЗ
// и разными системными номерами П-2026-xxxx. Счётчики «N ТЗ» везде считаются по уникальным номерам ТЗ,
// «N позиций» — по записям. Суммы, штуки и себестоимость по-прежнему считаются по записям.
// Чистые функции: без базы и React (используются и на сервере, и в клиентских компонентах).

/** Минимум полей, нужных для ключа: номер ТЗ из документа (wo / workOrderNumber) и системный номер записи. */
export type TzRef = { number: string; wo?: string | null; workOrderNumber?: string | null };

/** Номер ТЗ из документа (trim) или null, если не указан. */
export function tzNumber(o: TzRef): string | null {
  const raw = o.wo !== undefined ? o.wo : o.workOrderNumber;
  const t = raw == null ? "" : String(raw).trim();
  return t === "" ? null : t;
}

/** Ключ уникальности ТЗ: номер ТЗ из документа; пусто — системный номер записи (такая запись — отдельное ТЗ). */
export function orderKey(o: TzRef): string {
  const t = tzNumber(o);
  return t != null ? `tz:${t}` : `sys:${o.number}`;
}

/** Подпись ТЗ: номер из документа или системный номер. */
export function tzLabel(o: TzRef): string {
  return tzNumber(o) ?? o.number;
}

/** Число уникальных ТЗ в списке записей. */
export function uniqueOrderCount(list: readonly TzRef[]): number {
  const s = new Set<string>();
  for (const o of list) s.add(orderKey(o));
  return s.size;
}

/** Число уникальных ТЗ среди строк, у которых есть только подпись ТЗ (номер из документа) и уникальный id записи. */
export function uniqueLabelCount(list: readonly { id: string; label?: string | null }[]): number {
  return uniqueOrderCount(list.map((x) => ({ number: x.id, workOrderNumber: x.label })));
}

/** Записи, сгруппированные по ТЗ (порядок — по первому появлению). */
export function groupByTz<T extends TzRef>(list: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const o of list) {
    const k = orderKey(o);
    const g = m.get(k);
    if (g) g.push(o); else m.set(k, [o]);
  }
  return m;
}

const pl = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};
export const positionsWord = (n: number) => pl(n, "позиция", "позиции", "позиций");
export const articlesWord = (n: number) => pl(n, "артикул", "артикула", "артикулов");

/** « · 183 позиции» — только если позиций больше, чем ТЗ; иначе пусто. */
export function itemsSuffix(orders: number, items: number): string {
  return items > orders ? ` · ${items} ${positionsWord(items)}` : "";
}

/** «168 ТЗ» либо «168 ТЗ · 183 позиции» (позиции показываются, только если их больше, чем ТЗ). */
export function tzCountText(orders: number, items: number): string {
  return items > orders ? `${orders} ТЗ · ${items} ${positionsWord(items)}` : `${orders} ТЗ`;
}
