/**
 * Цвета ТЗ: единый способ узнать ВСЕ цвета заказа (чистые функции, без обращения к БД).
 * Составной цвет («Тёмно-синий ×2 (42, 46); Чёрный ×1 (42)») хранится строками ProductionOrderColor;
 * у обычного ТЗ с одним цветом строк нет — цвет берётся из colorRef (справочник), а если ссылки нет — из текста color.
 * Подключается в фильтры по цвету: ТЗ попадает под фильтр, если под него подходит ЛЮБОЙ из его цветов.
 */
export type OrderColorRefLite = { id: string; name: string };

export type OrderColorsInput = {
  color?: string | null;
  colorRef?: OrderColorRefLite | null;
  /** Строки ProductionOrderColor с подгруженным colorRef (include: { colors: { include: { colorRef: true } } }). */
  colors?: Array<{ colorRef: OrderColorRefLite; quantity?: number | null; sizes?: string | null }> | null;
};

export type OrderColorItem = {
  /** Цвет из справочника; null — цвета нет в справочнике, есть только текст (name). */
  color: OrderColorRefLite | null;
  /** Название для показа (из справочника либо исходный текст). */
  name: string;
  quantity?: number;
  sizes?: string;
};

export function orderColors(order: OrderColorsInput): OrderColorItem[] {
  if (order.colors && order.colors.length > 0) {
    return order.colors.map((c) => ({
      color: c.colorRef,
      name: c.colorRef.name,
      ...(c.quantity != null ? { quantity: c.quantity } : {}),
      ...(c.sizes ? { sizes: c.sizes } : {}),
    }));
  }
  if (order.colorRef) return [{ color: order.colorRef, name: order.colorRef.name }];
  const t = (order.color ?? "").trim();
  return t ? [{ color: null, name: t }] : [];
}

/** id цветов справочника, которые есть у ТЗ (для фильтра «цвет ТЗ»). */
export function orderColorIds(order: OrderColorsInput): string[] {
  return orderColors(order).flatMap((c) => (c.color ? [c.color.id] : []));
}

/** Подходит ли ТЗ под фильтр по цвету (id справочника); пустой фильтр — подходит всё. */
export function orderHasColor(order: OrderColorsInput, colorRefId: string | null | undefined): boolean {
  if (!colorRefId) return true;
  return orderColorIds(order).includes(colorRefId);
}

/** Каноническая строка для ProductionOrder.color: «Тёмно-синий ×2 (42, 46); Чёрный ×1 (42)». Один цвет без количества — просто название. */
export function formatOrderColors(items: OrderColorItem[]): string {
  if (items.length === 1 && items[0].quantity == null && !items[0].sizes) return items[0].name;
  return items
    .map((c) => `${c.name}${c.quantity != null ? ` ×${c.quantity}` : ""}${c.sizes ? ` (${c.sizes})` : ""}`)
    .join("; ");
}

/** Prisma include для orderColors(). */
export const ORDER_COLORS_INCLUDE = {
  colorRef: { select: { id: true, name: true } },
  colors: { include: { colorRef: { select: { id: true, name: true } } } },
} as const;
