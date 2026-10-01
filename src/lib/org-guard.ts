import "server-only";
import { prisma } from "@/lib/prisma";

type Ref = string | null | undefined;

type Refs = {
  supplier?: Ref;
  client?: Ref;
  warehouse?: Ref | Ref[];
  rawMaterial?: Ref | Ref[];
  rawMaterialCategory?: Ref;
  expenseCategory?: Ref;
  productModel?: Ref;
  productionOrder?: Ref | Ref[];
  purchase?: Ref;
  lot?: Ref;
};

const LABELS: Record<keyof Refs, string> = {
  supplier: "Поставщик не найден",
  client: "Заказчик не найден",
  warehouse: "Склад не найден",
  rawMaterial: "Материал не найден",
  rawMaterialCategory: "Категория материала не найдена",
  expenseCategory: "Статья расходов не найдена",
  productModel: "Модель изделия не найдена",
  productionOrder: "ТЗ не найдено",
  purchase: "Закупка не найдена",
  lot: "Лот не найден",
};

async function countOwned(kind: keyof Refs, ids: string[], organizationId: string): Promise<number> {
  const where = { id: { in: ids }, organizationId };
  switch (kind) {
    case "supplier": return prisma.supplier.count({ where });
    case "client": return prisma.client.count({ where });
    case "warehouse": return prisma.warehouse.count({ where });
    case "rawMaterial": return prisma.rawMaterial.count({ where });
    case "rawMaterialCategory": return prisma.rawMaterialCategory.count({ where });
    case "expenseCategory": return prisma.expenseCategory.count({ where });
    case "productModel": return prisma.productModel.count({ where });
    case "productionOrder": return prisma.productionOrder.count({ where });
    case "purchase": return prisma.purchase.count({ where });
    case "lot": return prisma.rawMaterialLot.count({ where });
  }
}

/**
 * Проверяет, что каждый переданный id принадлежит организации.
 * Пустые/отсутствующие значения пропускаются (обязательность проверяет схема).
 * Возвращает русский текст ошибки или null, если всё в порядке.
 *
 *   const bad = await checkOrgRefs(orgId, { supplier: id, warehouse: wid });
 *   if (bad) return { error: bad };
 */
export async function checkOrgRefs(organizationId: string, refs: Refs): Promise<string | null> {
  for (const key of Object.keys(refs) as (keyof Refs)[]) {
    const raw = refs[key];
    const ids = [...new Set((Array.isArray(raw) ? raw : [raw]).filter((x): x is string => !!x))];
    if (ids.length === 0) continue;
    if ((await countOwned(key, ids, organizationId)) !== ids.length) return LABELS[key];
  }
  return null;
}
