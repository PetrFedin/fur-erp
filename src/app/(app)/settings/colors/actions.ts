"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { capitalizeColor, colorKey, PROPOSED_MARK, splitColorCode } from "@/lib/color-ref";
import { ensureColorRef } from "@/lib/colors";

const ROLES = ACCESS.colors;
const nameSchema = z.string().trim().min(2, "Укажите название цвета").max(100, "Название слишком длинное");

function back(msg?: string, ok?: string): never {
  const q = msg ? `?error=${encodeURIComponent(msg)}` : ok ? `?ok=${encodeURIComponent(ok)}` : "";
  redirect(`/settings/colors${q}`);
}

function touch() {
  // Цвет показывается в ТЗ, закупках, лотах и аналитике — сбрасываем кэш всех страниц.
  revalidatePath("/", "layout");
}

/** «a, b; c» или по строкам → список без пустых и повторов (по ключу сравнения), без совпадающих с названием. */
function parseAliases(raw: string, name: string): string[] {
  const seen = new Set<string>([colorKey(name)]);
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const a = part.trim().replace(/\s+/g, " ");
    const k = colorKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

async function nameTaken(organizationId: string, name: string, aliases: string[], exceptId?: string): Promise<string | null> {
  const keys = new Set([colorKey(name), ...aliases.map(colorKey)]);
  const others = await prisma.colorRef.findMany({ where: { organizationId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  for (const o of others) {
    for (const v of [o.name, ...o.aliases]) if (keys.has(colorKey(v))) return `«${v}» уже есть у цвета «${o.name}». Если это один цвет — объедините их.`;
  }
  return null;
}

export async function createColor(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = capitalizeColor(p.data);
  const aliases = parseAliases(String(formData.get("aliases") ?? ""), name);
  const taken = await nameTaken(orgId, name, aliases);
  if (taken) back(taken);
  await prisma.colorRef.create({ data: { organizationId: orgId, name, aliases } });
  touch();
  back(undefined, `Цвет «${name}» добавлен`);
}

/** Переименование / синонимы / примечание. Новое название сразу пишется в текстовое поле color всех связанных строк. */
export async function updateColor(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = capitalizeColor(p.data);
  const aliases = parseAliases(String(formData.get("aliases") ?? ""), name);
  const note = String(formData.get("note") ?? "").trim() || null;
  const ref = await prisma.colorRef.findFirst({ where: { id, organizationId: orgId } });
  if (!ref) back("Цвет не найден");
  const taken = await nameTaken(orgId, name, aliases, id);
  if (taken) back(taken);
  await prisma.$transaction(async (tx) => {
    // Прежнее название остаётся синонимом: так старые написания по-прежнему находят этот цвет.
    const keepOld = colorKey(ref.name) !== colorKey(name) && !aliases.some((a) => colorKey(a) === colorKey(ref.name));
    await tx.colorRef.update({ where: { id }, data: { name, aliases: keepOld ? [...aliases, ref.name] : aliases, note } });
    if (ref.name !== name) {
      await tx.productionOrder.updateMany({ where: { organizationId: orgId, colorRefId: id }, data: { color: name } });
      await tx.rawMaterialLot.updateMany({ where: { organizationId: orgId, colorRefId: id }, data: { color: name } });
      await tx.purchaseItem.updateMany({ where: { purchase: { organizationId: orgId }, colorRefId: id }, data: { color: name } });
    }
  });
  touch();
  back(undefined, `Цвет «${name}» сохранён`);
}

/** Убрать пометку «Предложено, ждёт подтверждения»: владелец согласен с названием и синонимами. */
export async function confirmColor(formData: FormData) {
  const session = await requireRole(...ROLES);
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.colorRef.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!ref) back("Цвет не найден");
  const rest = (ref.note ?? "").trim().replace(new RegExp(`^${PROPOSED_MARK}\\.?\\s*`), "");
  await prisma.colorRef.update({ where: { id }, data: { note: rest || null } });
  touch();
  back(undefined, `Цвет «${ref.name}» подтверждён`);
}

/** Объединить: все ссылки и тексты from переезжают в into, название и синонимы from становятся синонимами into. */
export async function mergeColors(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const fromId = String(formData.get("fromId") ?? "");
  const intoId = String(formData.get("intoId") ?? "");
  if (!intoId || fromId === intoId) back("Выберите другой цвет, с которым объединить");
  const [from, into] = await Promise.all([
    prisma.colorRef.findFirst({ where: { id: fromId, organizationId: orgId } }),
    prisma.colorRef.findFirst({ where: { id: intoId, organizationId: orgId } }),
  ]);
  if (!from || !into) back("Цвет не найден");
  await prisma.$transaction(async (tx) => {
    const seen = new Set([colorKey(into.name), ...into.aliases.map(colorKey)]);
    const merged = [...into.aliases];
    for (const a of [from.name, ...from.aliases]) {
      const k = colorKey(a);
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(a);
      }
    }
    await tx.productionOrder.updateMany({ where: { organizationId: orgId, colorRefId: fromId }, data: { colorRefId: intoId, color: into.name } });
    await tx.rawMaterialLot.updateMany({ where: { organizationId: orgId, colorRefId: fromId }, data: { colorRefId: intoId, color: into.name } });
    await tx.purchaseItem.updateMany({ where: { purchase: { organizationId: orgId }, colorRefId: fromId }, data: { colorRefId: intoId, color: into.name } });
    await tx.colorRef.update({ where: { id: intoId }, data: { aliases: merged } });
    await tx.colorRef.delete({ where: { id: fromId } });
  });
  touch();
  back(undefined, `«${from.name}» объединён с «${into.name}»`);
}

export async function deleteColor(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.colorRef.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { orders: true, lots: true, purchaseItems: true } } },
  });
  if (!ref) back("Цвет не найден");
  const n = ref._count.orders + ref._count.lots + ref._count.purchaseItems;
  if (n > 0) back(`«${ref.name}» используется (${n} строк) — удалить нельзя. Объедините с другим цветом.`);
  await prisma.colorRef.delete({ where: { id } });
  touch();
  back(undefined, `Цвет «${ref.name}» удалён`);
}

/**
 * «Привязать»: все строки с этим точным написанием (ТЗ, позиции закупок, лоты) получают ссылку на цвет и его
 * каноническое название. Написание добавляется синонимом, код (239264) уходит в примечание ТЗ. Привязка к
 * «предложенному» цвету подтверждает его.
 */
export async function bindColorText(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const text = String(formData.get("text") ?? "");
  const refId = String(formData.get("refId") ?? "");
  const createNew = formData.get("createNew") === "1";
  if (!text.trim()) back("Пустое значение");
  const base = splitColorCode(text);
  let ref;
  if (createNew) {
    if (!base.base) back("В значении нет названия цвета, только код");
    ref = await ensureColorRef(prisma, orgId, base.base);
  } else {
    if (!refId) back("Выберите цвет, к которому привязать");
    ref = await prisma.colorRef.findFirst({ where: { id: refId, organizationId: orgId } });
    if (!ref) back("Цвет не найден");
  }
  const target = ref;
  const n = await prisma.$transaction(async (tx) => {
    const orders = await tx.productionOrder.findMany({ where: { organizationId: orgId, color: text, colorRefId: null }, select: { id: true, notes: true } });
    for (const o of orders) {
      const add = base.code && !(o.notes ?? "").includes(`Код цвета: ${base.code}`) ? `Код цвета: ${base.code} (было записано «${text.trim()}»)` : null;
      await tx.productionOrder.update({ where: { id: o.id }, data: { colorRefId: target.id, color: target.name, ...(add ? { notes: o.notes ? `${o.notes}\n${add}` : add } : {}) } });
    }
    const lots = await tx.rawMaterialLot.updateMany({ where: { organizationId: orgId, color: text, colorRefId: null }, data: { colorRefId: target.id, color: target.name } });
    const items = await tx.purchaseItem.updateMany({ where: { purchase: { organizationId: orgId }, color: text, colorRefId: null }, data: { colorRefId: target.id, color: target.name } });
    const k = colorKey(base.base);
    const known = [target.name, ...target.aliases].some((a) => colorKey(a) === k);
    const rest = (target.note ?? "").replace(new RegExp(`^${PROPOSED_MARK}\\.?\\s*`), "").trim() || null;
    await tx.colorRef.update({ where: { id: target.id }, data: { ...(known || !k ? {} : { aliases: [...target.aliases, base.base] }), note: rest } });
    return orders.length + lots.count + items.count;
  });
  touch();
  back(undefined, `«${text.trim()}» → «${target.name}»: обновлено строк ${n}`);
}

/** Для ColorSelect: добавить цвет прямо из формы ТЗ/закупки. Возвращает запись справочника. */
export async function createColorInline(rawName: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const session = await requireRole(...ROLES);
  const p = nameSchema.safeParse(splitColorCode(rawName).base || rawName);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const ref = await ensureColorRef(prisma, session.user.organizationId, p.data);
  revalidatePath("/settings/colors");
  return { ok: true, id: ref.id, name: ref.name };
}
