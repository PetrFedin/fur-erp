"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { isUniqueViolation } from "@/lib/input";
import { buildFurIndex, furKey } from "@/lib/fur-ref";
import { invalidateFurIndex } from "@/lib/fur-ref-server";
import { loadFurUsage } from "@/lib/fur-usage";
import { parseAliases } from "@/lib/article-key";

const ROLES = ACCESS.furRefs;
export type FurInput = { name: string; nameEn: string; aliases: string; note: string };
export type Res = { error?: string; ok?: true };

const t = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function done(orgId: string) {
  invalidateFurIndex(orgId);
  revalidatePath("/settings/furs");
  revalidatePath("/analytics/raw");
  revalidatePath("/analytics/products");
  revalidatePath("/lots");
}

/** Какой другой вид меха уже владеет этим написанием (чтобы одно написание не вело в два вида). */
function owner(refs: Array<{ id: string; name: string; nameEn: string | null; aliases: string[] }>, exceptId: string | null, text: string) {
  const k = furKey(text);
  if (!k) return null;
  for (const r of refs) {
    if (r.id === exceptId) continue;
    const keys = [r.name, r.nameEn ?? "", ...r.aliases].map(furKey);
    if (keys.includes(k)) return r;
  }
  return null;
}

export async function saveFur(id: string | null, input: FurInput): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const name = t(input.name, 100);
  if (name.length < 2) return { error: "Укажите русское название" };
  const nameEn = t(input.nameEn, 100) || null;
  const refs = await prisma.furRef.findMany({ where: { organizationId: orgId } });
  const cur = id ? refs.find((r) => r.id === id) : null;
  if (id && !cur) return { error: "Вид меха не найден" };
  let aliases = parseAliases(input.aliases).filter((a) => furKey(a) !== furKey(name));
  // Переименование: прежнее название остаётся синонимом, чтобы старые записи продолжали находиться.
  if (cur && furKey(cur.name) !== furKey(name) && !aliases.some((a) => furKey(a) === furKey(cur.name))) aliases.push(cur.name);
  aliases = aliases.filter((a) => !nameEn || furKey(a) !== furKey(nameEn));
  for (const x of [name, ...(nameEn ? [nameEn] : []), ...aliases]) {
    const o = owner(refs, id, x);
    if (o) return { error: `Написание «${x}» уже записано у вида «${o.name}»` };
  }
  try {
    if (id) await prisma.furRef.updateMany({ where: { id, organizationId: orgId }, data: { name, nameEn, aliases, note: t(input.note, 500) || null } });
    else await prisma.furRef.create({ data: { organizationId: orgId, name, nameEn, aliases, note: t(input.note, 500) || null } });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Вид меха с таким названием уже есть" };
    throw e;
  }
  done(orgId);
  return { ok: true };
}

/** Объединение: название, английское название и синонимы «лишнего» вида переходят в основной; запись «лишнего» удаляется. */
export async function mergeFurs(sourceId: string, targetId: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  if (!sourceId || !targetId || sourceId === targetId) return { error: "Выберите два разных вида меха" };
  const res = await prisma.$transaction(async (tx) => {
    const [src, dst] = await Promise.all([
      tx.furRef.findFirst({ where: { id: sourceId, organizationId: orgId } }),
      tx.furRef.findFirst({ where: { id: targetId, organizationId: orgId } }),
    ]);
    if (!src || !dst) return "Вид меха не найден";
    const seen = new Map<string, string>();
    for (const a of [...dst.aliases, src.name, src.nameEn ?? "", ...src.aliases]) {
      const k = furKey(a);
      if (k && k !== furKey(dst.name) && k !== furKey(dst.nameEn) && !seen.has(k)) seen.set(k, a);
    }
    await tx.furRef.delete({ where: { id: src.id } });
    await tx.furRef.update({ where: { id: dst.id }, data: { aliases: Array.from(seen.values()), nameEn: dst.nameEn ?? src.nameEn, note: dst.note ?? src.note } });
    return null;
  });
  if (res) return { error: res };
  done(orgId);
  return { ok: true };
}

/** Удаление — только пустого вида: ни лотов, ни позиций закупок, ни ТЗ по справочнику. */
export async function deleteFur(id: string): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const refs = await prisma.furRef.findMany({ where: { organizationId: orgId } });
  const ref = refs.find((r) => r.id === id);
  if (!ref) return { error: "Вид меха не найден" };
  const usage = await loadFurUsage(orgId, refs, buildFurIndex(refs));
  const u = usage.byRef.get(id);
  if (u && (u.lots > 0 || u.items > 0 || u.orders > 0)) return { error: `Нельзя удалить: используется (лотов ${u.lots}, позиций ${u.items}, ТЗ ${u.orders}). Лучше объедините с другим видом.` };
  await prisma.furRef.deleteMany({ where: { id, organizationId: orgId } });
  done(orgId);
  return { ok: true };
}
