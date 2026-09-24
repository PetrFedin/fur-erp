"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER", "TECHNOLOGIST"] as const;

const materialSchema = z.object({
  name: z.string().trim().min(2, "Укажите название сырья"),
  sku: z.string().trim().optional(),
  unit: z.enum(["PIECE", "KG", "M2", "M", "SET"]),
  categoryId: z.string().trim().optional(),
  minStockLevel: z.coerce.number().nonnegative().optional().or(z.nan().transform(() => undefined)),
  description: z.string().trim().optional(),
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

  await prisma.rawMaterial.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });

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

  const result = await prisma.rawMaterial.updateMany({
    where: { id, organizationId: session.user.organizationId },
    data: parsed.data,
  });
  if (result.count === 0) return { error: "Сырьё не найдено" };

  revalidatePath("/materials");
  redirect("/materials");
}

export async function createCategory(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const name = String(formData.get("categoryName") ?? "").trim();
  if (!name) return;

  await prisma.rawMaterialCategory.upsert({
    where: { organizationId_name: { organizationId: session.user.organizationId, name } },
    create: { organizationId: session.user.organizationId, name },
    update: {},
  });
  revalidatePath("/materials");
  revalidatePath("/materials/new");
}
