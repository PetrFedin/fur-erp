"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNumOpt, MAX_QTY, isUniqueViolation } from "@/lib/input";

const EDIT_ROLES = ACCESS.materials;

const materialSchema = z.object({
  name: z.string().trim().min(2, "Укажите название материала").max(200, "Название слишком длинное"),
  sku: z.string().trim().max(100, "Артикул слишком длинный").optional(),
  unit: z.enum(["PIECE", "KG", "M2", "M", "SET"]),
  categoryId: z.string().trim().optional(),
  minStockLevel: zNumOpt("Минимальный остаток", { max: MAX_QTY }),
  description: z.string().trim().max(5000).optional(),
});

export type MaterialFormState = { error?: string };

function parse(formData: FormData) {
  return materialSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") || undefined,
    unit: formData.get("unit"),
    categoryId: formData.get("categoryId") || undefined,
    minStockLevel: formData.get("minStockLevel") || undefined,
    description: formData.get("description") || undefined,
  });
}

export async function createMaterial(
  _prev: MaterialFormState,
  formData: FormData
): Promise<MaterialFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const badRef = await checkOrgRefs(session.user.organizationId, { rawMaterialCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };

  try {
    await prisma.rawMaterial.create({
      data: { organizationId: session.user.organizationId, ...parsed.data },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Материал с таким артикулом уже существует" };
    throw e;
  }

  revalidatePath("/materials");
  redirect("/materials");
}

export async function updateMaterial(
  id: string,
  _prev: MaterialFormState,
  formData: FormData
): Promise<MaterialFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const badRef = await checkOrgRefs(session.user.organizationId, { rawMaterialCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };

  let result;
  try {
    result = await prisma.rawMaterial.updateMany({
      where: { id, organizationId: session.user.organizationId },
      data: parsed.data,
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Материал с таким артикулом уже существует" };
    throw e;
  }
  if (result.count === 0) return { error: "Материал не найден" };

  revalidatePath("/materials");
  redirect("/materials");
}

export async function createCategory(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const name = String(formData.get("categoryName") ?? "").trim().slice(0, 100);
  if (!name) return;

  await prisma.rawMaterialCategory.upsert({
    where: { organizationId_name: { organizationId: session.user.organizationId, name } },
    create: { organizationId: session.user.organizationId, name },
    update: {},
  });
  revalidatePath("/materials");
  revalidatePath("/materials/new");
}
