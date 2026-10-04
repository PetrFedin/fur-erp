import "server-only";
import { prisma } from "@/lib/prisma";
import { buildFurIndex, type FurIndex } from "@/lib/fur-ref";

/**
 * Индекс справочника меха организации для canonicalFur(text, index). Кэш на 30 секунд (справочник правится редко);
 * invalidateFurIndex() сбрасывает его сразу после правок. Пустой справочник — встроенный набор (index = undefined).
 */
const cache = new Map<string, { at: number; index: FurIndex | undefined }>();

export async function getFurIndex(orgId: string): Promise<FurIndex | undefined> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.index;
  const refs = await prisma.furRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, nameEn: true, aliases: true, note: true } });
  const index = refs.length > 0 ? buildFurIndex(refs) : undefined;
  cache.set(orgId, { at: Date.now(), index });
  return index;
}

export function invalidateFurIndex(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}
