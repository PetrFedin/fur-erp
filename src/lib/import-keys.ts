// Версии загруженных данных в SystemState: <префикс><дата> (например retail-prices:2026-10-19) и указатель <префикс>current → { key }.
// Код читает данные через указатель; нет указателя (или он битый) — берётся версия с самой поздней датой в ключе.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const RETAIL_PREFIX = "retail-prices:";
export const SIZES_PREFIX = "sales-report-sizes:";
export const JOURNAL_PREFIX = "import-journal:";

type Db = Pick<PrismaClient, "systemState">;
const DATED = /^\d{4}-\d{2}-\d{2}$/;

export const versionKey = (prefix: string, asOf: string) => prefix + asOf;
export const pointerKey = (prefix: string) => prefix + "current";

/** Текущая версия данных: по указателю, иначе последняя по дате. Нет данных — null. */
export async function resolveVersioned(db: Db, orgId: string, prefix: string): Promise<{ key: string; value: unknown } | null> {
  const ptr = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: pointerKey(prefix) } }, select: { value: true } });
  const target = (ptr?.value as { key?: unknown } | null)?.key;
  if (typeof target === "string" && target.startsWith(prefix) && DATED.test(target.slice(prefix.length))) {
    const st = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: target } }, select: { value: true } });
    if (st) return { key: target, value: st.value };
  }
  const all = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: prefix } }, select: { key: true } });
  const last = all.map((x) => x.key).filter((k) => DATED.test(k.slice(prefix.length))).sort().pop();
  if (!last) return null;
  const st = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: last } }, select: { value: true } });
  return st ? { key: last, value: st.value } : null;
}

/** Прайс розницы (текущая версия): { asOf, rows: RetailRow[] … } или null. */
export async function loadRetailPricesState(orgId: string, db: Db = prisma): Promise<{ key: string; value: unknown } | null> {
  return resolveVersioned(db, orgId, RETAIL_PREFIX);
}

/** Размеры из отчёта о товарах (текущая версия). */
export async function loadReportSizesState(orgId: string, db: Db = prisma): Promise<{ key: string; value: unknown } | null> {
  return resolveVersioned(db, orgId, SIZES_PREFIX);
}
