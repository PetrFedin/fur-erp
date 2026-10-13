"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { cleanSearch, isUniqueViolation, parseDateInput } from "@/lib/input";
import { cleanSize, rowTotal } from "@/lib/plan-sizes";
import { modelIndex, resolveModelId } from "@/lib/plan-fact";
import { suggestSeasons } from "@/lib/plan-season-rule";
import { normalizeModelCode } from "@/lib/model-code";

const EDIT = ACCESS.planning;
export type PlanFormState = { error?: string; ok?: string };

const rowSchema = z.object({
  articleCode: z.string().trim().min(1, "Укажите артикул").max(100, "Артикул слишком длинный"),
  articleName: z.string().trim().max(200).optional(),
  color: z.string().trim().max(100).optional(),
  furType: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  modelId: z.string().max(40).nullish(),
  sizes: z.record(z.string(), z.number().int("Количество — целое число").min(0, "Количество не может быть отрицательным").max(1_000_000, "Слишком большое количество")),
});
const payloadSchema = z.object({
  seasonId: z.string().max(40).optional(),
  newSeasonCode: z.string().trim().max(30).optional(),
  editId: z.string().max(40).optional(),
  rows: z.array(rowSchema).min(1, "Добавьте хотя бы одну строку").max(300, "Не больше 300 строк за раз"),
});

async function resolveSeason(orgId: string, seasonId: string | undefined, newCode: string | undefined): Promise<{ id: string | null } | { error: string }> {
  if (newCode) {
    const exist = await prisma.season.findFirst({ where: { organizationId: orgId, code: { equals: newCode, mode: "insensitive" } } });
    if (exist) return { id: exist.id };
    const s = await prisma.season.create({ data: { organizationId: orgId, code: newCode } });
    return { id: s.id };
  }
  if (seasonId) {
    const bad = await prisma.season.count({ where: { id: seasonId, organizationId: orgId } });
    if (!bad) return { error: "Сезон не найден" };
    return { id: seasonId };
  }
  return { id: null };
}

export async function savePlan(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Не удалось прочитать форму, обновите страницу" };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте форму" };
  const { rows, editId } = parsed.data;
  if (editId && rows.length !== 1) return { error: "При правке — одна строка" };

  // Размеры: подписи очищаем, одинаковые складываем, пустых не бывает.
  const cleaned: (Omit<z.infer<typeof rowSchema>, "sizes"> & { sizes: Record<string, number> })[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sizes: Record<string, number> = {};
    for (const [label, qty] of Object.entries(r.sizes)) {
      const c = cleanSize(label);
      if (!c) return { error: `Строка ${i + 1}: у размера пустая подпись` };
      sizes[c] = (sizes[c] ?? 0) + qty;
    }
    if (Object.keys(sizes).length > 40) return { error: `Строка ${i + 1}: слишком много размеров (максимум 40)` };
    if (rowTotal(sizes) <= 0) return { error: `Строка ${i + 1} (${r.articleCode}): укажите количество хотя бы в одном размере (больше 0)` };
    cleaned.push({ ...r, sizes });
  }

  const modelIds = [...new Set(cleaned.map((r) => r.modelId).filter((x): x is string => !!x))];
  if (modelIds.length && (await prisma.productModel.count({ where: { id: { in: modelIds }, organizationId: orgId } })) !== modelIds.length) return { error: "Модель изделия не найдена" };
  if (editId) {
    const own = await prisma.productionPlan.count({ where: { id: editId, organizationId: orgId } });
    if (!own) return { error: "Позиция плана не найдена" };
  }
  const season = await resolveSeason(orgId, parsed.data.seasonId || undefined, parsed.data.newSeasonCode || undefined);
  if ("error" in season) return { error: season.error };

  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, sku: true, salesCode: true, aliases: true } });
  const idx = modelIndex(models);
  const modelName = new Map(models.map((m) => [m.id, m.name]));

  await prisma.$transaction(async (tx) => {
    for (const r of cleaned) {
      const modelId = resolveModelId({ modelId: r.modelId || null, articleCode: r.articleCode }, idx);
      const data = {
        seasonId: season.id,
        modelId,
        articleCode: modelId && r.modelId ? (modelName.get(modelId) ?? r.articleCode) : r.articleCode,
        articleName: r.articleName || null,
        color: r.color || null,
        furType: r.furType || null,
        notes: r.notes || null,
      };
      const sizes = Object.entries(r.sizes).map(([size, quantity]) => ({ size, quantity }));
      if (editId) {
        await tx.productionPlan.update({ where: { id: editId }, data });
        await tx.productionPlanSize.deleteMany({ where: { planId: editId } });
        await tx.productionPlanSize.createMany({ data: sizes.map((s) => ({ ...s, planId: editId })) });
      } else {
        await tx.productionPlan.create({ data: { ...data, organizationId: orgId, sizes: { create: sizes } } });
      }
    }
  });
  revalidateAll(session.user.organizationId);
  redirect(`/plan${season.id ? `?season=${season.id}` : ""}`);
}

async function ownPlan(orgId: string, id: string) {
  return prisma.productionPlan.findFirst({ where: { id, organizationId: orgId }, include: { sizes: true } });
}

export async function copyPlan(formData: FormData) {
  const session = await requireRole(...EDIT);
  const src = await ownPlan(session.user.organizationId, cleanSearch(formData.get("id")));
  if (!src) redirect("/plan");
  await prisma.productionPlan.create({
    data: {
      organizationId: src.organizationId,
      seasonId: src.seasonId,
      modelId: src.modelId,
      articleCode: src.articleCode,
      articleName: src.articleName,
      color: src.color,
      furType: src.furType,
      notes: src.notes,
      sizes: { create: src.sizes.map((s) => ({ size: s.size, quantity: s.quantity })) },
    },
  });
  revalidateAll(session.user.organizationId);
  redirect(`/plan${src.seasonId ? `?season=${src.seasonId}` : ""}`);
}

export async function deletePlan(formData: FormData) {
  const session = await requireRole(...EDIT);
  const src = await ownPlan(session.user.organizationId, cleanSearch(formData.get("id")));
  if (src) {
    // События календаря остаются (planId обнулится сам, onDelete: SetNull), удаляется только позиция плана и её размеры.
    await prisma.productionPlan.delete({ where: { id: src.id } });
  }
  revalidateAll(session.user.organizationId);
  redirect(`/plan${src?.seasonId ? `?season=${src.seasonId}` : ""}`);
}

const seasonSchema = z.object({
  code: z.string().trim().min(1, "Укажите код сезона, например FW26/27").max(30, "Код сезона слишком длинный"),
  name: z.string().trim().max(100).optional(),
});

function seasonDates(formData: FormData): { start: Date | null; end: Date | null } | { error: string } {
  const s = String(formData.get("startDate") ?? "");
  const e = String(formData.get("endDate") ?? "");
  const start = s ? parseDateInput(s) : null;
  const end = e ? parseDateInput(e) : null;
  if (s && !start) return { error: "Некорректная дата начала сезона" };
  if (e && !end) return { error: "Некорректная дата конца сезона" };
  if (start && end && start > end) return { error: "Дата начала сезона позже даты конца" };
  return { start, end };
}

export async function createSeason(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const session = await requireRole(...EDIT);
  const p = seasonSchema.safeParse({ code: formData.get("code"), name: formData.get("name") || undefined });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const d = seasonDates(formData);
  if ("error" in d) return { error: d.error };
  const orgId = session.user.organizationId;
  const exist = await prisma.season.count({ where: { organizationId: orgId, code: { equals: p.data.code, mode: "insensitive" } } });
  if (exist) return { error: `Сезон «${p.data.code}» уже есть` };
  try {
    await prisma.season.create({ data: { organizationId: orgId, code: p.data.code, name: p.data.name || null, startDate: d.start, endDate: d.end } });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Сезон «${p.data.code}» уже есть` };
    throw e;
  }
  revalidateAll(session.user.organizationId);
  return { ok: `Сезон «${p.data.code}» создан` };
}

export async function updateSeasonDates(_prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const session = await requireRole(...EDIT);
  const id = cleanSearch(formData.get("id"));
  const own = await prisma.season.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!own) return { error: "Сезон не найден" };
  const d = seasonDates(formData);
  if ("error" in d) return { error: d.error };
  const name = cleanSearch(formData.get("name"), 100);
  // Код сезона можно переименовать: ТЗ, планы и события привязаны по id, не по коду.
  const codeRaw = formData.has("code") ? cleanSearch(formData.get("code"), 30) : own.code;
  if (!codeRaw) return { error: "Код сезона не может быть пустым" };
  if (codeRaw !== own.code) {
    const dup = await prisma.season.count({ where: { organizationId: session.user.organizationId, code: { equals: codeRaw, mode: "insensitive" }, id: { not: id } } });
    if (dup) return { error: `Сезон «${codeRaw}» уже есть` };
  }
  try {
    await prisma.season.update({ where: { id }, data: { code: codeRaw, name: name || null, startDate: d.start, endDate: d.end } });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Сезон «${codeRaw}» уже есть` };
    throw e;
  }
  revalidateAll(session.user.organizationId);
  return { ok: "Сохранено" };
}

/** Создать артикул в справочнике одним кликом (код → ProductModel.name). Если такой уже есть — вернуть его. */
export async function createArticleInline(code: string, title: string): Promise<{ ok: true; id: string; name: string; existed: boolean } | { ok: false; error: string }> {
  const session = await requireRole(...ACCESS.models);
  const orgId = session.user.organizationId;
  const c = cleanSearch(code, 100);
  if (c.length < 2) return { ok: false, error: "Артикул — минимум 2 знака" };
  const models = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, sku: true, salesCode: true, aliases: true } });
  const hit = modelIndex(models).get(normalizeKey(c));
  if (hit) return { ok: true, id: hit, name: models.find((m) => m.id === hit)!.name, existed: true };
  const m = await prisma.productModel.create({ data: { organizationId: orgId, name: c, category: cleanSearch(title, 100) || null } });
  revalidateAll(session.user.organizationId);
  return { ok: true, id: m.id, name: m.name, existed: false };
}

const normalizeKey = (s: string) => normalizeModelCode(s.trim()).toLowerCase();

// ───────────── Сезон у ТЗ ─────────────

export async function assignSeason(formData: FormData) {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const ids = formData.getAll("orderId").map((v) => cleanSearch(v, 40)).filter(Boolean).slice(0, 2000);
  const seasonId = cleanSearch(formData.get("seasonId"), 40);
  if (ids.length === 0) redirect("/plan/seasons?msg=none");
  if (seasonId) {
    const ok = await prisma.season.count({ where: { id: seasonId, organizationId: orgId } });
    if (!ok) redirect("/plan/seasons?msg=noseason");
  }
  const r = await prisma.productionOrder.updateMany({ where: { id: { in: ids }, organizationId: orgId }, data: { seasonId: seasonId || null } });
  revalidateAll(session.user.organizationId);
  redirect(`/plan/seasons?msg=assigned&n=${r.count}`);
}

/** Применить правило «по дате ТЗ»: пересчитывается на сервере, применяются только отмеченные, которым правило и сейчас даёт сезон. */
export async function applySeasonRule(formData: FormData) {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const ids = new Set(formData.getAll("orderId").map((v) => cleanSearch(v, 40)).filter(Boolean));
  if (ids.size === 0) redirect("/plan/seasons?msg=none");
  const [orders, seasons] = await Promise.all([
    prisma.productionOrder.findMany({ where: { organizationId: orgId, seasonId: null, id: { in: [...ids] } }, select: { id: true, seasonId: true, workOrderDate: true, endDate: true, startDate: true } }),
    prisma.season.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, startDate: true, endDate: true } }),
  ]);
  const verdicts = suggestSeasons(orders, seasons);
  const bySeason = new Map<string, string[]>();
  for (const v of verdicts) if (v.kind === "match") bySeason.set(v.seasonId, [...(bySeason.get(v.seasonId) ?? []), v.orderId]);
  let n = 0;
  for (const [sid, oids] of bySeason) {
    const r = await prisma.productionOrder.updateMany({ where: { id: { in: oids }, organizationId: orgId, seasonId: null }, data: { seasonId: sid } });
    n += r.count;
  }
  revalidateAll(session.user.organizationId);
  redirect(`/plan/seasons?msg=assigned&n=${n}`);
}
