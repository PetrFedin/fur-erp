"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { isUniqueViolation } from "@/lib/input";
import {
  CUSTOM_FIELD_ENTITY,
  MAX_CUSTOM_FIELDS,
  isFieldType,
  parseCustomValue,
  readExtra,
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

async function orgFields(organizationId: string) {
  return prisma.customField.findMany({
    where: { organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Новый столбец; beforeId — вставить перед этим столбцом (иначе в конец). */
export async function createCustomField(input: {
  name: string;
  type: string;
  beforeId?: string | null;
}): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const n = validateFieldName(input.name);
  if ("error" in n) return n;
  if (!isFieldType(input.type)) return { error: "Выберите тип столбца: текст, число или да/нет" };
  const type = input.type;
  const existing = await orgFields(orgId);
  if (existing.length >= MAX_CUSTOM_FIELDS) return { error: `Не больше ${MAX_CUSTOM_FIELDS} своих столбцов` };
  if (existing.some((f) => f.name.toLowerCase() === n.name.toLowerCase()))
    return { error: `Столбец «${n.name}» уже есть` };
  try {
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.customField.create({
        data: { organizationId: orgId, entity: CUSTOM_FIELD_ENTITY, name: n.name, type, position: existing.length },
      });
      const order = existing.map((f) => f.id);
      const at = input.beforeId ? order.indexOf(input.beforeId) : -1;
      if (at >= 0) order.splice(at, 0, c.id);
      else order.push(c.id);
      for (let i = 0; i < order.length; i++) {
        await tx.customField.updateMany({ where: { id: order[i], organizationId: orgId }, data: { position: i } });
      }
      return c;
    });
    revalidateAll();
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Столбец «${n.name}» уже есть` };
    throw e;
  }
}

export async function renameCustomField(id: string, name: string): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const n = validateFieldName(name);
  if ("error" in n) return n;
  const all = await orgFields(orgId);
  const cur = all.find((f) => f.id === id);
  if (!cur) return { error: "Столбец не найден" };
  if (all.some((f) => f.id !== id && f.name.toLowerCase() === n.name.toLowerCase()))
    return { error: `Столбец «${n.name}» уже есть` };
  try {
    await prisma.customField.updateMany({ where: { id, organizationId: orgId }, data: { name: n.name } });
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
  const all = await orgFields(orgId);
  const i = all.findIndex((f) => f.id === id);
  if (i < 0) return { error: "Столбец не найден" };
  const j = dir === "left" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return { ok: true };
  const order = all.map((f) => f.id);
  [order[i], order[j]] = [order[j], order[i]];
  await prisma.$transaction(
    order.map((fid, pos) => prisma.customField.updateMany({ where: { id: fid, organizationId: orgId }, data: { position: pos } })),
  );
  revalidateAll();
  return { ok: true };
}

/** Удаляет столбец вместе со значениями у всех лотов организации. */
export async function deleteCustomField(id: string): Promise<FieldResult> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const field = await prisma.customField.findFirst({ where: { id, organizationId: orgId } });
  if (!field) return { error: "Столбец не найден" };
  await prisma.$transaction(async (tx) => {
    const items = await tx.purchaseItem.findMany({
      where: { purchase: { organizationId: orgId }, NOT: { extra: { equals: Prisma.DbNull } } },
      select: { id: true, extra: true },
    });
    for (const it of items) {
      const ex = readExtra(it.extra);
      if (!(id in ex)) continue;
      delete ex[id];
      await tx.purchaseItem.update({ where: { id: it.id }, data: { extra: Object.keys(ex).length ? ex : Prisma.DbNull } });
    }
    await tx.customField.deleteMany({ where: { id, organizationId: orgId } });
    const rest = await tx.customField.findMany({
      where: { organizationId: orgId, entity: CUSTOM_FIELD_ENTITY },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    for (let i = 0; i < rest.length; i++) await tx.customField.update({ where: { id: rest[i].id }, data: { position: i } });
  });
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
  const field = await prisma.customField.findFirst({ where: { id: fieldId, organizationId: orgId } });
  if (!field) return { error: "Столбец не найден (возможно, удалён) — обновите страницу" };
  const parsed = parseCustomValue(field.type, raw, field.name);
  if ("error" in parsed) return parsed;
  const item = await prisma.purchaseItem.findFirst({
    where: { id: itemId, purchase: { organizationId: orgId } },
    select: { id: true, purchaseId: true, extra: true },
  });
  if (!item) return { error: "Лот не найден" };
  const ex = readExtra(item.extra);
  if (parsed.value === null) delete ex[fieldId];
  else ex[fieldId] = parsed.value;
  await prisma.purchaseItem.update({ where: { id: item.id }, data: { extra: Object.keys(ex).length ? ex : Prisma.DbNull } });
  // Только значения справочные — страницу не перерисовываем целиком, чтобы не сбивать ввод в соседних ячейках.
  revalidatePath(`/purchases/${item.purchaseId}`);
  return { ok: true, value: parsed.value };
}
