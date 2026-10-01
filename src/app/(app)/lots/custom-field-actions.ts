"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { isUniqueViolation } from "@/lib/input";
import {
  CUSTOM_FIELD_ENTITY,
  MAX_CUSTOM_FIELDS,
  isFieldType,
  parseCustomValue,
  validateFieldName,
  type ExtraValue,
} from "@/lib/custom-fields";

// Столбцы и значения — справочная информация к лотам, поэтому правятся и у принятых закупок.
const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;

export type FieldResult = { ok: true; id?: string } | { ok?: false; error: string };

function revalidateAll() {
  revalidatePath("/lots");
  revalidatePath("/purchases/[id]", "page");
}

const idSchema = z.string().min(1).max(100);
const BAD_ARGS = "Некорректные параметры запроса — обновите страницу";

/** Блокировка по организации: создание/перенос/удаление столбцов идут строго по очереди. */
async function lockFields(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"custom-fields:" + organizationId}))) t`;
}

async function txFields(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.customField.findMany({
    where: { organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

const createSchema = z.object({
  name: z.string(),
  type: z.string(),
  beforeId: z.string().max(100).nullish(),
});

/** Новый столбец; beforeId — вставить перед этим столбцом (иначе в конец). */
export async function createCustomField(input: {
  name: string;
  type: string;
  beforeId?: string | null;
}): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsedInput = createSchema.safeParse(input);
  if (!parsedInput.success) return { error: BAD_ARGS };
  const { beforeId } = parsedInput.data;
  const n = validateFieldName(parsedInput.data.name);
  if ("error" in n) return n;
  if (!isFieldType(parsedInput.data.type)) return { error: "Выберите тип столбца: текст, число или да/нет" };
  const type = parsedInput.data.type;
  try {
    const res = await prisma.$transaction(async (tx) => {
      await lockFields(tx, orgId);
      const existing = await txFields(tx, orgId);
      if (existing.length >= MAX_CUSTOM_FIELDS) return { error: `Не больше ${MAX_CUSTOM_FIELDS} своих столбцов` };
      if (existing.some((f) => f.name.toLowerCase() === n.name.toLowerCase()))
        return { error: `Столбец «${n.name}» уже есть` };
      const c = await tx.customField.create({
        data: { organizationId: orgId, entity: CUSTOM_FIELD_ENTITY, name: n.name, type, position: existing.length },
      });
      const order = existing.map((f) => f.id);
      const at = beforeId ? order.indexOf(beforeId) : -1;
      if (at >= 0) order.splice(at, 0, c.id);
      else order.push(c.id);
      for (let i = 0; i < order.length; i++) {
        await tx.customField.updateMany({ where: { id: order[i], organizationId: orgId }, data: { position: i } });
      }
      return { ok: true as const, id: c.id };
    });
    if (!res.ok) return res;
    revalidateAll();
    return { ok: true, id: res.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Столбец «${n.name}» уже есть` };
    throw e;
  }
}

export async function renameCustomField(id: string, name: string): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!idSchema.safeParse(id).success || typeof name !== "string") return { error: BAD_ARGS };
  const n = validateFieldName(name);
  if ("error" in n) return n;
  try {
    const res = await prisma.$transaction(async (tx) => {
      await lockFields(tx, orgId);
      const all = await txFields(tx, orgId);
      if (!all.some((f) => f.id === id)) return { error: "Столбец не найден" };
      if (all.some((f) => f.id !== id && f.name.toLowerCase() === n.name.toLowerCase()))
        return { error: `Столбец «${n.name}» уже есть` };
      await tx.customField.updateMany({ where: { id, organizationId: orgId }, data: { name: n.name } });
      return null;
    });
    if (res) return res;
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Столбец «${n.name}» уже есть` };
    throw e;
  }
  revalidateAll();
  return { ok: true };
}

export async function moveCustomField(id: string, dir: "left" | "right"): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!idSchema.safeParse(id).success || (dir !== "left" && dir !== "right")) return { error: BAD_ARGS };
  const res = await prisma.$transaction(async (tx) => {
    await lockFields(tx, orgId);
    const all = await txFields(tx, orgId);
    const i = all.findIndex((f) => f.id === id);
    if (i < 0) return { error: "Столбец не найден" };
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return null;
    const order = all.map((f) => f.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (let pos = 0; pos < order.length; pos++) {
      await tx.customField.updateMany({ where: { id: order[pos], organizationId: orgId }, data: { position: pos } });
    }
    return null;
  });
  if (res) return res;
  revalidateAll();
  return { ok: true };
}

/** Удаляет столбец вместе со значениями у всех лотов организации. */
export async function deleteCustomField(id: string): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!idSchema.safeParse(id).success) return { error: BAD_ARGS };
  const res = await prisma.$transaction(async (tx) => {
    await lockFields(tx, orgId);
    // Блокируем строку столбца: параллельная запись значения (FOR SHARE) подождёт и увидит, что столбца нет.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CustomField" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
    if (locked.length === 0) return { error: "Столбец не найден" };
    await tx.$executeRaw`
      UPDATE "PurchaseItem" SET "extra" = NULLIF("extra" - ${id}::text, '{}'::jsonb)
      WHERE "extra" ? ${id}::text
        AND "purchaseId" IN (SELECT "id" FROM "Purchase" WHERE "organizationId" = ${orgId})`;
    await tx.customField.deleteMany({ where: { id, organizationId: orgId } });
    const rest = await txFields(tx, orgId);
    for (let i = 0; i < rest.length; i++) await tx.customField.update({ where: { id: rest[i].id }, data: { position: i } });
    return null;
  });
  if (res) return res;
  revalidateAll();
  return { ok: true };
}

/** Значение ячейки лота. Пустое значение очищает ячейку. */
export async function setCustomValue(
  itemId: string,
  fieldId: string,
  raw: string | boolean | null,
): Promise<{ ok: true; value: ExtraValue | null } | { ok?: false; error: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  if (!idSchema.safeParse(itemId).success || !idSchema.safeParse(fieldId).success) return { error: BAD_ARGS };
  if (raw === undefined) return { error: BAD_ARGS };
  const field = await prisma.customField.findFirst({ where: { id: fieldId, organizationId: orgId } });
  if (!field) return { error: "Столбец не найден (возможно, удалён) — обновите страницу" };
  const parsed = parseCustomValue(field.type, raw, field.name);
  if ("error" in parsed) return parsed;
  const item = await prisma.purchaseItem.findFirst({
    where: { id: itemId, purchase: { organizationId: orgId } },
    select: { id: true, purchaseId: true },
  });
  if (!item) return { error: "Лот не найден" };
  const value = parsed.value;
  const outcome = await prisma.$transaction(async (tx) => {
    // FOR SHARE: удаление столбца (FOR UPDATE) и запись значения не пересекаются.
    const still = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CustomField" WHERE "id" = ${fieldId} AND "organizationId" = ${orgId} FOR SHARE`;
    if (still.length === 0) return "no-field" as const;
    // Одна атомарная запись одного ключа: правки соседних столбцов того же лота не теряются.
    const n =
      value === null
        ? await tx.$executeRaw`
            UPDATE "PurchaseItem" SET "extra" = NULLIF(COALESCE("extra", '{}'::jsonb) - ${fieldId}::text, '{}'::jsonb)
            WHERE "id" = ${item.id}`
        : await tx.$executeRaw`
            UPDATE "PurchaseItem"
            SET "extra" = jsonb_set(COALESCE("extra", '{}'::jsonb), ARRAY[${fieldId}::text], ${JSON.stringify(value)}::jsonb, true)
            WHERE "id" = ${item.id}`;
    return n === 0 ? ("no-item" as const) : ("ok" as const);
  });
  if (outcome === "no-field") return { error: "Столбец не найден (возможно, удалён) — обновите страницу" };
  if (outcome === "no-item") return { error: "Лот не найден" };
  // Только значения справочные — страницу не перерисовываем целиком, чтобы не сбивать ввод в соседних ячейках.
  revalidatePath(`/purchases/${item.purchaseId}`);
  return { ok: true, value };
}
