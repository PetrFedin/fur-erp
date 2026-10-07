import "server-only";
// Варианты фильтров «Цвет» и «Размер» для ТЗ строятся ТОЛЬКО по данным ТЗ:
//  - цвет: все цвета ТЗ (orderColors: составной ТЗ попадает под каждый свой цвет), каноническое название справочника;
//  - размер: размеры из текста ТЗ (parseOrderSizes: «44, 46» -> 44 и 46, «единый/NS» -> «Единый размер»), числа по возрастанию.
// Пункты «без цвета» / «размер не указан» возвращаются отдельным числом: страница показывает их, только если такие ТЗ есть.
import { prisma } from "@/lib/prisma";
import { ORDER_COLORS_INCLUDE, orderColors, type OrderColorsInput } from "@/lib/order-colors";
import { collectOrderSizes, parseOrderSizes } from "@/lib/order-sizes";
import type { FilterOption } from "@/lib/filters";

export const NO_COLOR_LABEL = "Цвет не указан в документах";
export const NO_SIZE_LABEL = "Размер не указан в документах";

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export type OrderAttrOptions = { color: FilterOption[]; size: FilterOption[]; noColor: number; noSize: number };

/** Названия цветов ТЗ (канонические); пусто — у ТЗ цвет не указан. */
export function orderColorNames(o: OrderColorsInput): string[] {
  return Array.from(new Set(orderColors(o).map((c) => c.name)));
}

export async function loadOrderAttrOptions(orgId: string): Promise<OrderAttrOptions> {
  const rows = await prisma.productionOrder.findMany({
    where: { organizationId: orgId },
    select: { size: true, color: true, ...ORDER_COLORS_INCLUDE },
  });
  const colorCount = new Map<string, number>();
  const sizeCount = new Map<string, number>();
  let noColor = 0;
  let noSize = 0;
  for (const r of rows) {
    const cs = orderColorNames(r);
    if (cs.length === 0) noColor++;
    for (const c of cs) colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
    const ss = parseOrderSizes(r.size);
    if (ss.length === 0) noSize++;
    for (const s of ss) sizeCount.set(s, (sizeCount.get(s) ?? 0) + 1);
  }
  const color = Array.from(colorCount, ([value, count]) => ({ value, label: value, count })).sort((a, b) => collator.compare(a.label, b.label));
  const size = collectOrderSizes(rows.map((r) => r.size)).map((value) => ({ value, label: value, count: sizeCount.get(value) ?? 0 }));
  return { color, size, noColor, noSize };
}
