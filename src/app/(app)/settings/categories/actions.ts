"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { capitalizeCategory, categoryKey, oneLine } from "@/lib/category-ref";
import { ensureCategoryRef } from "@/lib/categories";
import { CATEGORY_GROUPS } from "@/lib/category-groups";

const ROLES = ACCESS.categories;
const nameSchema = z.string().trim().min(2, "Укажите название категории").max(100, "Название слишком длинное");

/** Группа из формы: только из списка справочника групп, иначе пусто («Без группы»). */
function groupFromForm(fd: FormData): string | null {
  const g = String(fd.get("group") ?? "").trim();
  return (CATEGORY_GROUPS as readonly string[]).includes(g) ? g : null;
}

function back(msg?: string, ok?: string): never {
  const q = msg ? `?error=${encodeURIComponent(msg)}` : ok ? `?ok=${encodeURIComponent(ok)}` : "";
  redirect(`/settings/categories${q}`);
}

function touch() {
  // Категория показывается в моделях, артикулах, ТЗ и аналитике — сбрасываем кэш всех страниц.
  revalidateAll();
}

/** «a, b; c» или по строкам → список без пустых и повторов (по ключу сравнения), без совпадающих с названием. */
function parseAliases(raw: string, name: string): string[] {
  const seen = new Set<string>([categoryKey(name)]);
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const a = oneLine(part);
    const k = categoryKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

async function nameTaken(organizationId: string, name: string, aliases: string[], exceptId?: string): Promise<string | null> {
  const keys = new Set([categoryKey(name), ...aliases.map(categoryKey)]);
  const others = await prisma.categoryRef.findMany({ where: { organizationId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  for (const o of others) {
    for (const v of [o.name, ...o.aliases]) if (keys.has(categoryKey(v))) return `«${v}» уже есть у категории «${o.name}». Если это одна категория — объедините их.`;
  }
  return null;
}

export async function createCategory(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = capitalizeCategory(p.data);
  const aliases = parseAliases(String(formData.get("aliases") ?? ""), name);
  const taken = await nameTaken(orgId, name, aliases);
  if (taken) back(taken);
  const max = (await prisma.categoryRef.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  await prisma.categoryRef.create({ data: { organizationId: orgId, name, aliases, confirmed: true, sortOrder: max + 10, group: groupFromForm(formData) } });
  touch();
  back(undefined, `Категория «${name}» добавлена`);
}

/** Переименование / синонимы / примечание. Новое название сразу пишется в текстовое поле category всех моделей категории. */
export async function updateCategory(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const p = nameSchema.safeParse(formData.get("name"));
  if (!p.success) back(p.error.issues[0].message);
  const name = capitalizeCategory(p.data);
  const aliases = parseAliases(String(formData.get("aliases") ?? ""), name);
  const note = String(formData.get("note") ?? "").trim() || null;
  const group = groupFromForm(formData);
  const ref = await prisma.categoryRef.findFirst({ where: { id, organizationId: orgId } });
  if (!ref) back("Категория не найдена");
  const taken = await nameTaken(orgId, name, aliases, id);
  if (taken) back(taken);
  await prisma.$transaction(async (tx) => {
    // Прежнее название остаётся синонимом: так старые написания по-прежнему находят эту категорию.
    const keepOld = categoryKey(ref.name) !== categoryKey(name) && !aliases.some((a) => categoryKey(a) === categoryKey(ref.name));
    await tx.categoryRef.update({ where: { id }, data: { name, aliases: keepOld ? [...aliases, ref.name] : aliases, note, group } });
    if (ref.name !== name) await tx.productModel.updateMany({ where: { organizationId: orgId, categoryRefId: id }, data: { category: name } });
  });
  touch();
  back(undefined, `Категория «${name}» сохранена`);
}

export async function confirmCategory(formData: FormData) {
  const session = await requireRole(...ROLES);
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.categoryRef.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!ref) back("Категория не найдена");
  const rest = (ref.note ?? "").trim().replace(/^Предложено, ждёт подтверждения\.?\s*/, "");
  await prisma.categoryRef.update({ where: { id }, data: { confirmed: true, note: rest || null } });
  touch();
  back(undefined, `Категория «${ref.name}» подтверждена`);
}

/** Объединить: модели from переезжают в into, название и синонимы from становятся синонимами into. */
export async function mergeCategories(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const fromId = String(formData.get("fromId") ?? "");
  const intoId = String(formData.get("intoId") ?? "");
  if (!intoId || fromId === intoId) back("Выберите другую категорию, с которой объединить");
  const [from, into] = await Promise.all([
    prisma.categoryRef.findFirst({ where: { id: fromId, organizationId: orgId } }),
    prisma.categoryRef.findFirst({ where: { id: intoId, organizationId: orgId } }),
  ]);
  if (!from || !into) back("Категория не найдена");
  await prisma.$transaction(async (tx) => {
    const seen = new Set([categoryKey(into.name), ...into.aliases.map(categoryKey)]);
    const merged = [...into.aliases];
    for (const a of [from.name, ...from.aliases]) {
      const k = categoryKey(a);
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(a);
      }
    }
    await tx.productModel.updateMany({ where: { organizationId: orgId, categoryRefId: fromId }, data: { categoryRefId: intoId, category: into.name } });
    await tx.categoryRef.update({ where: { id: intoId }, data: { aliases: merged } });
    await tx.categoryRef.delete({ where: { id: fromId } });
  });
  touch();
  back(undefined, `«${from.name}» объединена с «${into.name}»`);
}

export async function deleteCategory(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const id = String(formData.get("id") ?? "");
  const ref = await prisma.categoryRef.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { models: true } } } });
  if (!ref) back("Категория не найдена");
  if (ref._count.models > 0) back(`«${ref.name}» используется (моделей: ${ref._count.models}) — удалить нельзя. Объедините с другой категорией.`);
  await prisma.categoryRef.delete({ where: { id } });
  touch();
  back(undefined, `Категория «${ref.name}» удалена`);
}

/**
 * «Привязать»: модели из списка (ids) без категории справочника получают ссылку на категорию и её каноническое название.
 * Прежний текст добавляется синонимом (если он есть). Привязка к «предложенной» категории подтверждает её.
 * Список моделей берётся из скрытого поля: так можно привязать группу с одинаковым текстом или одну модель без текста.
 */
export async function bindCategoryModels(formData: FormData) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const ids = String(formData.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const refId = String(formData.get("refId") ?? "");
  const createText = String(formData.get("createNew") ?? "") === "1" ? oneLine(String(formData.get("text") ?? "")) : "";
  if (ids.length === 0) back("Нет моделей для привязки");
  let ref;
  if (createText) {
    const p = nameSchema.safeParse(createText);
    if (!p.success) back(p.error.issues[0].message);
    ref = await ensureCategoryRef(prisma, orgId, p.data);
  } else {
    if (!refId) back("Выберите категорию, к которой привязать");
    ref = await prisma.categoryRef.findFirst({ where: { id: refId, organizationId: orgId } });
    if (!ref) back("Категория не найдена");
  }
  const target = ref;
  const n = await prisma.$transaction(async (tx) => {
    const models = await tx.productModel.findMany({ where: { organizationId: orgId, id: { in: ids }, categoryRefId: null }, select: { id: true, category: true } });
    const known = new Set([target.name, ...target.aliases].map(categoryKey));
    const add: string[] = [];
    for (const m of models) {
      const t = oneLine(m.category);
      if (t && !known.has(categoryKey(t))) {
        known.add(categoryKey(t));
        add.push(t);
      }
    }
    await tx.productModel.updateMany({ where: { id: { in: models.map((m) => m.id) } }, data: { categoryRefId: target.id, category: target.name } });
    const rest = (target.note ?? "").replace(/^Предложено, ждёт подтверждения\.?\s*/, "").trim() || null;
    await tx.categoryRef.update({ where: { id: target.id }, data: { aliases: [...target.aliases, ...add], confirmed: true, note: rest } });
    return models.length;
  });
  touch();
  back(undefined, `Привязано моделей: ${n} → «${target.name}»`);
}

/** Для CategorySelect: добавить категорию прямо из формы модели/артикула. */
export async function createCategoryInline(rawName: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const session = await requireRole(...ROLES);
  const p = nameSchema.safeParse(rawName);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const ref = await ensureCategoryRef(prisma, session.user.organizationId, p.data);
  revalidateAll(session.user.organizationId);
  return { ok: true, id: ref.id, name: ref.name };
}
