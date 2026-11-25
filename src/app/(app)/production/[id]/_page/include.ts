import type { Prisma } from "@prisma/client";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";

/** include запроса карточки ТЗ (тот же, что был в page.tsx). */
export const ORDER_CARD_INCLUDE = {
  productModel: { include: { materials: { include: { rawMaterial: true } }, categoryRef: true } },
  rawWarehouse: true,
  // finishedWarehouse не показываем: склад один, его выбор из интерфейса убран (колонка в БД остаётся).
  client: true,
  batch: { select: { id: true, number: true } },
  season: { select: { id: true, code: true } },
  ...ORDER_COLORS_INCLUDE,
  attrs: { select: { attr: { select: { name: true } } } },
  materialUsages: {
    include: { rawMaterial: true, lot: { include: { attrs: { select: { attr: { select: { name: true } } } }, purchase: { select: { id: true, number: true } } } } },
    orderBy: { date: "asc" },
  },
  expenses: { include: { category: true }, orderBy: { date: "asc" } },
} satisfies Prisma.ProductionOrderInclude;

export type CardOrder = Prisma.ProductionOrderGetPayload<{ include: typeof ORDER_CARD_INCLUDE }>;
