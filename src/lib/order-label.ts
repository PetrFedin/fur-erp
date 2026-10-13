// Единая подпись ТЗ: «ТЗ 182 · поз. 1/3» (у ТЗ несколько позиций), «ТЗ 182» (одна позиция),
// «Заказ П-2026-0197» (рабочего номера из документа нет). Внутренний номер «П-…» в заголовках и списках не показываем —
// он остаётся в title/подсказке и в поиске. Чистые функции: без базы и React.

export type OrderLabelInput = {
  workOrderNumber?: string | null;
  number: string;
  posIndex?: number | null;
  posCount?: number | null;
};

export type TzPos = { posIndex: number; posCount: number };

const natural = (a: string, b: string) => a.localeCompare(b, "ru", { numeric: true });

/** «поз. 1/3» — только если позиций больше одной; иначе пусто. */
export function posText(posIndex?: number | null, posCount?: number | null): string {
  return posIndex && posCount && posCount > 1 ? `поз. ${posIndex}/${posCount}` : "";
}

/** Единая подпись ТЗ (см. заголовок файла). */
export function orderLabel(o: OrderLabelInput): string {
  const wo = (o.workOrderNumber ?? "").trim();
  if (!wo) return `Заказ ${o.number}`;
  const p = posText(o.posIndex, o.posCount);
  return p ? `ТЗ ${wo} · ${p}` : `ТЗ ${wo}`;
}

/** Подсказка (title) с внутренним номером записи. */
export function orderHint(o: { number: string }): string {
  return `Внутренний номер заказа ${o.number}`;
}

/** Позиции ТЗ по загруженному списку: записи с общим рабочим номером нумеруются по внутреннему номеру (как на карточке ТЗ). */
export function positionsOf(list: readonly { id: string; number: string; workOrderNumber?: string | null }[]): Map<string, TzPos> {
  const groups = new Map<string, { id: string; number: string }[]>();
  for (const o of list) {
    const wo = (o.workOrderNumber ?? "").trim();
    if (!wo) continue;
    const g = groups.get(wo);
    if (g) g.push(o); else groups.set(wo, [o]);
  }
  const out = new Map<string, TzPos>();
  for (const g of groups.values()) {
    g.sort((a, b) => natural(a.number, b.number));
    g.forEach((o, i) => out.set(o.id, { posIndex: i + 1, posCount: g.length }));
  }
  return out;
}
