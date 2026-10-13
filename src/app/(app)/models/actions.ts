"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { staleError, MODEL_V } from "@/lib/concurrency";
import { resolveCategoryInput } from "@/lib/categories";
import { parsePrice, zNumOpt, isUniqueViolation, normalizeNumberInput } from "@/lib/input";
import { loadArticleList } from "@/lib/article-ref";
import { articleKey, parseAliases } from "@/lib/article-key";
import { articleConflict } from "@/lib/article-conflict";
import { CATEGORY_GROUPS } from "@/lib/category-groups";
import { hasRole } from "@/lib/access";

const EDIT_ROLES = ACCESS.models;

const modelSchema = z.object({
  name: z.string().trim().min(2, "Укажите название модели").max(200, "Название слишком длинное"),
  sku: z.string().trim().max(100, "Артикул слишком длинный").optional(),
  category: z.string().trim().max(100).optional(),
  sellingPrice: zNumOpt("Цена продажи"),
  description: z.string().trim().max(5000).optional(),
});

export type ModelFormState = { error?: string };

function parse(formData: FormData) {
  return modelSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") || undefined,
    category: formData.get("category") || undefined,
    sellingPrice: formData.get("sellingPrice") || undefined,
    description: formData.get("description") || undefined,
  });
}

export async function createModel(
  _prev: ModelFormState,
  formData: FormData
): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const cat = await resolveCategoryInput(prisma, session.user.organizationId, { category: parsed.data.category, categoryRefId: String(formData.get("categoryRefId") ?? "") || null });
  let model;
  try {
    model = await prisma.productModel.create({
      data: { organizationId: session.user.organizationId, ...parsed.data, category: cat.category, categoryRefId: cat.categoryRefId },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Модель с таким артикулом уже существует" };
    throw e;
  }

  revalidateAll(session.user.organizationId);
  redirect(`/models/${model.id}`);
}

export async function updateModel(
  id: string,
  _prev: ModelFormState,
  formData: FormData
): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const current = await prisma.productModel.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (current) {
    const stale = staleError(formData, current, MODEL_V, current.updatedAt);
    if (stale) return { error: stale };
  }

  const cat = await resolveCategoryInput(prisma, session.user.organizationId, { category: parsed.data.category, categoryRefId: String(formData.get("categoryRefId") ?? "") || null });
  let result;
  try {
    result = await prisma.productModel.updateMany({
      where: { id, organizationId: session.user.organizationId },
      data: { ...parsed.data, category: cat.category, categoryRefId: cat.categoryRefId },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Модель с таким артикулом уже существует" };
    throw e;
  }
  if (result.count === 0) return { error: "Модель не найдена" };

  revalidateAll(session.user.organizationId);
  return {};
}

// Применяется только к незавершённым ТЗ (PLANNED/IN_PROGRESS): у завершённых и отменённых цена не меняется. Розничная цена в самом ТЗ
// правится отдельно (retailPatch в production/actions.ts).
export async function updateSellingPrice(modelId: string, formData: FormData): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  // Пустое поле — цену убрать (модель без розничной цены); иначе число больше 0.
  const rawPrice = String(formData.get("sellingPrice") ?? "").replace(/[\s\u00a0\u202f]/g, "");
  let price: number | null = null;
  if (rawPrice !== "") {
    const parsed = parsePrice(formData.get("sellingPrice"));
    if ("error" in parsed) return { error: parsed.error };
    price = parsed.value;
  }

  const model = await prisma.productModel.findFirst({
    where: { id: modelId, organizationId: session.user.organizationId },
  });
  if (!model) return { error: "Модель не найдена" };

  await prisma.$transaction([
    prisma.productModel.update({ where: { id: modelId }, data: { sellingPrice: price } }),
    prisma.productionOrder.updateMany({
      where: { productModelId: modelId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      data: { retailPrice: price },
    }),
  ]);

  revalidateAll(session.user.organizationId);
  return {};
}

// ───────────────────────── единая форма артикула (новый + правка по месту) ─────────────────────────

export type ArticleSaveState = {
  error?: string;
  /** Ошибки по полям (имя поля формы → сообщение). */
  fields?: Record<string, string>;
  /** Правка сохранена. */
  saved?: { at: number };
  /** Новый артикул заведён (intent=again — остаёмся на форме). */
  created?: { id: string; name: string; at: number };
};

const one = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Сохранение артикула одной формой. id = null — новый артикул (intent «open» ведёт в карточку, «again» оставляет пустую форму).
 * Правка возможна в любом состоянии артикула. Категория — из справочника или своя (если права позволяют, сразу заводится в справочник
 * с выбранной группой). Цена продажи при изменении переносится на ТЗ в плане и в работе (как «Розничная цена» в списке).
 */
export async function saveArticleForm(id: string | null, _prev: ArticleSaveState, formData: FormData): Promise<ArticleSaveState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const fields: Record<string, string> = {};

  const name = one(formData.get("name"), 100);
  const salesCode = one(formData.get("salesCode"), 100);
  const salesName = one(formData.get("salesName"), 500);
  const category = one(formData.get("category"), 100);
  const group = one(formData.get("group"), 40);
  const description = String(formData.get("description") ?? "").trim().slice(0, 5000);
  const aliases = parseAliases(String(formData.get("aliases") ?? "")).filter((a) => articleKey(a) !== articleKey(name));
  const rawPrice = normalizeNumberInput(formData.get("sellingPrice"));
  if (name.length < 2) fields.name = "Укажите код артикула (не короче 2 символов)";
  let price: number | null = null;
  if (rawPrice !== undefined) {
    if (typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice <= 0 || rawPrice > 999_999_999_999) fields.sellingPrice = "Цена продажи: число больше 0 (или оставьте пустой)";
    else price = rawPrice;
  }
  if (Object.keys(fields).length) return { error: Object.values(fields)[0], fields };

  const list = await loadArticleList(orgId);
  if (id && !list.some((a) => a.id === id)) return { error: "Артикул не найден" };
  const bad = articleConflict(list, id, { name, salesCode, aliases });
  if (bad) return { error: bad, fields: { name: bad } };

  // Категория: выбранная из справочника либо своя (текст; сопоставляется со справочником по названию/синониму).
  // Группа (верхний уровень) принадлежит категории: если у выбранной категории группы ещё нет, а в форме она выбрана — записываем её.
  const catInput = await resolveCategoryInput(prisma, orgId, { category, categoryRefId: String(formData.get("categoryRefId") ?? "") || null });
  if (catInput.categoryRefId && (CATEGORY_GROUPS as readonly string[]).includes(group) && hasRole(session.user.role, ACCESS.categories)) {
    await prisma.categoryRef.updateMany({ where: { id: catInput.categoryRefId, organizationId: orgId, group: null }, data: { group } });
  }

  const data = {
    name,
    salesCode: salesCode || null,
    salesName: salesName || null,
    aliases,
    category: catInput.category,
    categoryRefId: catInput.categoryRefId,
    sellingPrice: price,
    description: description || null,
    ...(id ? { isActive: formData.get("isActive") !== "0" } : {}),
  };
  let savedId = id;
  try {
    if (id) {
      const before = await prisma.productModel.findFirst({ where: { id, organizationId: orgId }, select: { sellingPrice: true } });
      const r = await prisma.productModel.updateMany({ where: { id, organizationId: orgId }, data });
      if (r.count === 0) return { error: "Артикул не найден" };
      const was = before?.sellingPrice ? before.sellingPrice.toNumber() : null;
      if (was !== price) {
        await prisma.productionOrder.updateMany({
          where: { productModelId: id, organizationId: orgId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
          data: { retailPrice: price },
        });
      }
    } else {
      const m = await prisma.productModel.create({ data: { organizationId: orgId, ...data } });
      savedId = m.id;
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Артикул с таким кодом уже есть", fields: { name: "Артикул с таким кодом уже есть" } };
    throw e;
  }
  revalidateAll(orgId);
  if (!id) {
    if (formData.get("intent") === "again") return { created: { id: savedId!, name, at: Date.now() } };
    redirect(`/models/${savedId}`);
  }
  return { saved: { at: Date.now() } };
}
