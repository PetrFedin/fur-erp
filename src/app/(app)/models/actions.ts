"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { checkOrgRefs } from "@/lib/org-guard";
import { parsePrice, zNum, zNumOpt, MAX_QTY, isUniqueViolation } from "@/lib/input";

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

  let model;
  try {
    model = await prisma.productModel.create({
      data: { organizationId: session.user.organizationId, ...parsed.data },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Модель с таким артикулом уже существует" };
    throw e;
  }

  revalidatePath("/articles");
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

  let result;
  try {
    result = await prisma.productModel.updateMany({
      where: { id, organizationId: session.user.organizationId },
      data: parsed.data,
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Модель с таким артикулом уже существует" };
    throw e;
  }
  if (result.count === 0) return { error: "Модель не найдена" };

  revalidatePath("/articles");
  revalidatePath(`/models/${id}`);
  return {};
}

// Применяется только к незавершённым ТЗ (PLANNED/IN_PROGRESS): у завершённых и отменённых цена не меняется. See the matching note on
// production/actions.ts's updateRetailPrice.
export async function updateSellingPrice(modelId: string, formData: FormData): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parsePrice(formData.get("sellingPrice"));
  if ("error" in parsed) return { error: parsed.error };
  const price = parsed.value;

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

  revalidatePath("/articles");
  revalidatePath("/production");
  return {};
}

const bomSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите материал"),
  quantityPerUnit: zNum("Норма расхода", { positive: true, max: MAX_QTY }),
});

export async function addBomLine(productModelId: string, formData: FormData): Promise<ModelFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const model = await prisma.productModel.findFirst({
    where: { id: productModelId, organizationId: orgId },
  });
  if (!model) return { error: "Модель не найдена" };

  const parsed = bomSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantityPerUnit: formData.get("quantityPerUnit"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const badRef = await checkOrgRefs(orgId, { rawMaterial: parsed.data.rawMaterialId });
  if (badRef) return { error: badRef };

  await prisma.productModelMaterial.upsert({
    where: {
      productModelId_rawMaterialId: {
        productModelId,
        rawMaterialId: parsed.data.rawMaterialId,
      },
    },
    create: { productModelId, ...parsed.data },
    update: { quantityPerUnit: parsed.data.quantityPerUnit },
  });

  revalidatePath(`/models/${productModelId}`);
  return {};
}

export async function removeBomLine(productModelId: string, lineId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const model = await prisma.productModel.findFirst({
    where: { id: productModelId, organizationId: session.user.organizationId },
  });
  if (!model) return;

  // Строка удаляется только если она принадлежит этой (своей) модели.
  await prisma.productModelMaterial.deleteMany({ where: { id: lineId, productModelId: model.id } });
  revalidatePath(`/models/${productModelId}`);
}
