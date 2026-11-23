import type { PrismaClient } from "@prisma/client";

/**
 * Свежесть витрины без тяжёлых импортов (чтобы её могли вызывать и загрузчики лотов): витрина свежа, если лоты собраны не раньше
 * последней записи данных (метка data-version ставится в revalidateAll).
 */
export async function martIsFresh(db: Pick<PrismaClient, "$queryRaw">, orgId: string): Promise<boolean> {
  if (process.env.SNAPSHOTS === "0") return false;
  const rows = await db.$queryRaw<{ t: Date | null; v: unknown }[]>`
    SELECT (SELECT max("builtAt") FROM "DmLot" WHERE "organizationId" = ${orgId}) AS t,
           (SELECT value FROM "SystemState" WHERE "organizationId" = ${orgId} AND key = 'data-version') AS v`;
  const t = rows[0]?.t?.getTime();
  const v = typeof rows[0]?.v === "number" ? rows[0].v : Number(rows[0]?.v ?? 0) || 0;
  return t != null && t >= v;
}
