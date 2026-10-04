import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capitalizeColor, colorKey, isProposed, matchColorRef, splitColorCode } from "@/lib/color-ref";

type Db = Prisma.TransactionClient | typeof prisma;

export type ColorOption = { id: string; name: string; aliases: string[]; proposed: boolean };

/** Цвета справочника организации для выпадающего списка (ColorSelect). */
export async function getColorOptions(organizationId: string): Promise<ColorOption[]> {
  const rows = await prisma.colorRef.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, proposed: isProposed(r.note) }));
}

/**
 * Значение цвета из формы → { color (текст для отображения), colorRefId }.
 * Выбран цвет справочника (colorRefId) — текст берётся из его названия. Иначе текст сопоставляется с
 * подтверждённым цветом по названию/синониму; если однозначного соответствия нет — остаётся свободный
 * текст без ссылки (он попадёт в блок «Не сопоставлено» на /settings/colors).
 */
export async function resolveColorInput(
  db: Db,
  organizationId: string,
  input: { color?: string | null; colorRefId?: string | null }
): Promise<{ color: string | null; colorRefId: string | null }> {
  const text = (input.color ?? "").trim();
  if (input.colorRefId) {
    const ref = await db.colorRef.findFirst({ where: { id: input.colorRefId, organizationId } });
    if (ref && (!text || colorKey(text) === colorKey(ref.name) || ref.aliases.some((a) => colorKey(a) === colorKey(text)))) {
      return { color: ref.name, colorRefId: ref.id };
    }
  }
  if (!text) return { color: null, colorRefId: null };
  const refs = await db.colorRef.findMany({ where: { organizationId } });
  const m = matchColorRef(text, refs);
  // Код («BROWN 239341») — не часть названия: если он есть, сохраняем текст как ввели, но ссылку ставим.
  if (m) return { color: splitColorCode(text).code ? text : m.name, colorRefId: m.id };
  return { color: text, colorRefId: null };
}

/** Создать цвет (или вернуть существующий с тем же названием/синонимом). */
export async function ensureColorRef(db: Db, organizationId: string, rawName: string) {
  const name = capitalizeColor(rawName);
  const refs = await db.colorRef.findMany({ where: { organizationId } });
  const key = colorKey(name);
  const same = refs.find((r) => colorKey(r.name) === key || r.aliases.some((a) => colorKey(a) === key));
  if (same) return same;
  return db.colorRef.create({ data: { organizationId, name, aliases: [] } });
}
