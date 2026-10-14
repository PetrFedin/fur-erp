import type { PrismaClient } from "@prisma/client";

/**
 * Артикулы, которые завёл внешний поставщик (Веллмех): определяем по журналу изменений (AuditLog: создание ProductModel
 * от пользователя с ролью SUPPLIER) — без отдельного поля в артикуле, поэтому ничего не нужно «доставлять» миграцией.
 * Возвращает id артикула → когда внесён.
 */
export async function loadSupplierArticleIds(db: PrismaClient, organizationId: string): Promise<Map<string, Date>> {
  const logs = await db.auditLog.findMany({
    where: { organizationId, model: "ProductModel", action: "create", actorRole: "SUPPLIER" },
    select: { recordId: true, at: true },
    orderBy: { at: "asc" },
  });
  return new Map(logs.map((l) => [l.recordId, l.at]));
}
