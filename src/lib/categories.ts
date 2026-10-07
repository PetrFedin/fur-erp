import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capitalizeCategory, categoryKey, matchCategoryRef } from "@/lib/category-ref";

type Db = Prisma.TransactionClient | typeof prisma;

export type CategoryOption = { id: string; name: string; aliases: string[]; proposed: boolean };

/** Категории справочника организации для выпадающего списка (CategorySelect). */
export async function getCategoryOptions(organizationId: string): Promise<CategoryOption[]> {
  const rows = await prisma.categoryRef.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, proposed: !r.confirmed }));
}

/**
 * Значение категории из формы → { category (текст), categoryRefId }.
 * Выбрана категория справочника — текст берётся из её названия. Иначе текст сопоставляется с подтверждённой
 * категорией по названию/синониму; если однозначного соответствия нет — остаётся свободный текст без ссылки
 * (он попадёт в блок «Не сопоставлено» на /settings/categories).
 */
export async function resolveCategoryInput(
  db: Db,
  organizationId: string,
  input: { category?: string | null; categoryRefId?: string | null }
): Promise<{ category: string | null; categoryRefId: string | null }> {
  const text = (input.category ?? "").trim();
  if (input.categoryRefId) {
    const ref = await db.categoryRef.findFirst({ where: { id: input.categoryRefId, organizationId } });
    if (ref && (!text || categoryKey(text) === categoryKey(ref.name) || ref.aliases.some((a) => categoryKey(a) === categoryKey(text)))) {
      return { category: ref.name, categoryRefId: ref.id };
    }
  }
  if (!text) return { category: null, categoryRefId: null };
  const refs = await db.categoryRef.findMany({ where: { organizationId } });
  const m = matchCategoryRef(text, refs);
  if (m) return { category: m.name, categoryRefId: m.id };
  return { category: text, categoryRefId: null };
}

/** Создать категорию (или вернуть существующую с тем же названием/синонимом). Новая — подтверждена (её завёл пользователь). */
export async function ensureCategoryRef(db: Db, organizationId: string, rawName: string) {
  const name = capitalizeCategory(rawName);
  const refs = await db.categoryRef.findMany({ where: { organizationId } });
  const key = categoryKey(name);
  const same = refs.find((r) => categoryKey(r.name) === key || r.aliases.some((a) => categoryKey(a) === key));
  if (same) return same;
  const max = refs.reduce((m, r) => Math.max(m, r.sortOrder), 0);
  return db.categoryRef.create({ data: { organizationId, name, aliases: [], confirmed: true, sortOrder: max + 10 } });
}
