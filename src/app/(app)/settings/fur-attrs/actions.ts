"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { attrKey, parseAttrAliases } from "@/lib/fur-attr";
import { invalidateFilterOptions } from "@/lib/filter-options";

const ROLES = ACCESS.furRefs;
const nameSchema = z.string().trim().min(2, "Укажите название признака").max(80, "Название слишком длинное");

function back(msg?: string, ok?: string): never {
  const q = msg ? `?error=${encodeURIComponent(msg)}` : ok ? `?ok=${encodeURIComponent(ok)}` : "";
  redirect(`/settings/fur-attrs${q}`);
}

function touch(orgId: string) {
  // Признак виден в таблицах и фильтрах лотов, сводки, ТЗ и аналитики — сбрасываем кэш вариантов и страниц.
  invalidateFilterOptions(orgId);
  revalidatePath("/", "layout");
}

const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function nameTaken(organizationId: string, name: string, aliases: string[], exceptId?: string): Promise<string | null> {
  const keys = new Set([attrKey(name), ...aliases.map(attrKey)]);
  const others = await prisma.furAttrRef.findMany({ where: { organizationId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  for (const o of others) {
    for (const v of [o.name, ...o.aliases]) if (keys.has(attrKey(v))) return `«${v}» уже есть у признака «${o.name}». Если это один признак — объедините их.`;
  }
  return null;
}

function fields(formData: FormData, name: string) {
  return {
    group: text(formData.get("group"), 60) || null,
    furKind: text(formData.get("furKind"), 60) || null,
    description: text(formData.get("description"), 500) || null,
    aliases: parseAttrAliases(String(formData.get("aliases") ?? ""), name),
    autoDetect: formData.get("autoDetect") === "on",
  };
}

export async function createFurAttr(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = p.data.replace(/\s+/g, " ");
  const f = fields(formData, name);
  const taken = await nameTaken(orgId, name, f.aliases);
  if (taken) back(taken);
  await prisma.furAttrRef.create({ data: { organizationId: orgId, name, ...f, confirmed: true } });
  touch(orgId);
  back(undefined, `Признак «${name}» добавлен`);
}

export async function updateFurAttr(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = p.data.replace(/\s+/g, " ");
  const ref = await prisma.furAttrRef.findFirst({ where: { id, organizationId: orgId } });
  if (!ref) back("Признак не найден");
  const f = fields(formData, name);
  const taken = await nameTaken(orgId, name, f.aliases, id);
  if (taken) back(taken);
  await prisma.furAttrRef.update({ where: { id }, data: { name, ...f } });
  touch(orgId);
  back(undefined, `Признак «${name}» сохранён`);
}

/** Владелец согласен с названием и смыслом признака («Предложено» → «Подтверждено»). */
export async function confirmFurAttr(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.furAttrRef.findFirst({ where: { id, organizationId: orgId } });
  if (!ref) back("Признак не найден");
  await prisma.furAttrRef.update({ where: { id }, data: { confirmed: true } });
  touch(orgId);
  back(undefined, `Признак «${ref.name}» подтверждён`);
}

/** Объединить: лоты и ТЗ from получают into, название и синонимы from становятся синонимами into. Лишнюю запись удаляем. */
export async function mergeFurAttrs(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const fromId = String(formData.get("fromId") ?? "");
  const intoId = String(formData.get("intoId") ?? "");
  if (!intoId || fromId === intoId) back("Выберите другой признак, с которым объединить");
  const [from, into] = await Promise.all([
    prisma.furAttrRef.findFirst({ where: { id: fromId, organizationId: orgId } }),
    prisma.furAttrRef.findFirst({ where: { id: intoId, organizationId: orgId } }),
  ]);
  if (!from || !into) back("Признак не найден");
  await prisma.$transaction(async (tx) => {
    const seen = new Set([attrKey(into.name), ...into.aliases.map(attrKey)]);
    const merged = [...into.aliases];
    for (const a of [from.name, ...from.aliases]) {
      const k = attrKey(a);
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(a);
      }
    }
    // Пары (лот, признак) / (ТЗ, признак) уникальны: у кого уже есть into, пара from просто исчезнет.
    await tx.$executeRaw`INSERT INTO "RawMaterialLotAttr" ("lotId","attrId","source","createdAt") SELECT "lotId", ${intoId}, "source", "createdAt" FROM "RawMaterialLotAttr" WHERE "attrId" = ${fromId} ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`INSERT INTO "ProductionOrderAttr" ("orderId","attrId","source","createdAt") SELECT "orderId", ${intoId}, "source", "createdAt" FROM "ProductionOrderAttr" WHERE "attrId" = ${fromId} ON CONFLICT DO NOTHING`;
    await tx.rawMaterialLotAttr.deleteMany({ where: { attrId: fromId } });
    await tx.productionOrderAttr.deleteMany({ where: { attrId: fromId } });
    await tx.furAttrRef.update({ where: { id: intoId }, data: { aliases: merged } });
    await tx.furAttrRef.delete({ where: { id: fromId } });
  });
  touch(orgId);
  back(undefined, `«${from.name}» объединён с «${into.name}»`);
}

export async function deleteFurAttr(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.furAttrRef.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { lots: true, orders: true } } } });
  if (!ref) back("Признак не найден");
  const n = ref._count.lots + ref._count.orders;
  if (n > 0) back(`«${ref.name}» используется (${n} строк) — удалить нельзя. Объедините с другим признаком.`);
  await prisma.furAttrRef.delete({ where: { id } });
  touch(orgId);
  back(undefined, `Признак «${ref.name}» удалён`);
}
