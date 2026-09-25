"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

const modelSchema = z.object({
  name: z.string().trim().min(2, "Укажите название модели"),
  sku: z.string().trim().optional(),
  category: z.string().trim().optional(),
  sellingPrice: z.coerce.number().nonnegative().optional().or(z.nan().transform(() => undefined)),
  description: z.string().trim().optional(),
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

  const model = await prisma.productModel.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });

  revalidatePath("/models");
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

  const result = await prisma.productModel.updateMany({
    where: { id, organizationId: session.user.organizationId },
    data: parsed.data,
  });
  if (result.count === 0) return { error: "Модель не найдена" };

  revalidatePath("/models");
  revalidatePath(`/models/${id}`);
  return {};
}

export async function updateSellingPrice(modelId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = z.coerce.number().nonnegative().safeParse(formData.get("sellingPrice"));
  if (!parsed.success) return;

  await prisma.productModel.updateMany({
    where: { id: modelId, organizationId: session.user.organizationId },
    data: { sellingPrice: parsed.data },
  });
  revalidatePath("/articles");
  revalidatePath("/models");
}

const bomSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите сырьё"),
  quantityPerUnit: z.coerce.number().positive("Норма расхода должна быть больше 0"),
});

export async function addBomLine(productModelId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const model = await prisma.productModel.findFirst({
    where: { id: productModelId, organizationId: session.user.organizationId },
  });
  if (!model) return;

  const parsed = bomSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantityPerUnit: formData.get("quantityPerUnit"),
  });
  if (!parsed.success) return;

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
}

export async function removeBomLine(productModelId: string, lineId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const model = await prisma.productModel.findFirst({
    where: { id: productModelId, organizationId: session.user.organizationId },
  });
  if (!model) return;

  await prisma.productModelMaterial.delete({ where: { id: lineId } });
  revalidatePath(`/models/${productModelId}`);
}
