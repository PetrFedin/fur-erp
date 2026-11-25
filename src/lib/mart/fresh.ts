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

/**
 * Снимки экранов, которые собирает каждая сборка витрины (не зависят от набора лет). Если новый код читает снимок, которого прежний
 * не собирал, витрина «свежая» по данным, но неполная: при старте ставим пересборку. Список сверяется со сборкой в test-mart-drill-view.
 */
export const SNAPSHOT_REQUIRED_KEYS = [
  "dash:all:on", "dash:all:off", "furlots:fur:all", "furlots:lining:all", "drill:all:on", "drill:all:off",
  "pay:overview", "pay:left", "pay:auctions", "purchases:tree", "furkinds",
] as const;

/** Ключи из SNAPSHOT_REQUIRED_KEYS, которых нет в DmSnapshot организации (пусто — набор полный). */
export async function missingSnapshotKeys(db: Pick<PrismaClient, "$queryRaw">, orgId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ key: string }[]>`SELECT "key" FROM "DmSnapshot" WHERE "organizationId" = ${orgId}`;
  const have = new Set(rows.map((r) => r.key));
  return SNAPSHOT_REQUIRED_KEYS.filter((k) => !have.has(k));
}
