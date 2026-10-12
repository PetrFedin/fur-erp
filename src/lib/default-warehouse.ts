// Склад в интерфейсе не указывается: приход всегда в одно место. Сервер сам берёт
// склад по умолчанию организации (isDefault), иначе первый по названию.
import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "warehouse">;

export async function getDefaultWarehouseId(orgId: string, db: Db = prisma): Promise<string | null> {
  const ws = await db.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true, isDefault: true }, orderBy: { name: "asc" } });
  return ws.find((w) => w.isDefault)?.id ?? ws[0]?.id ?? null;
}
