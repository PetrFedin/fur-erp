"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

const STATUS_VALUES = ["PLANNED", "LAUNCHED", "WITH_FURRIER", "WITH_TAILOR", "PRODUCED", "CANCELLED"] as const;

const entrySchema = z.object({
  productModelId: z.string().min(1, "Выберите артикул"),
  month: z.string().min(1, "Укажите месяц"),
  status: z.enum(STATUS_VALUES),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
  eventDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

export type FormState = { error?: string };

export async function addSupplyPlanEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = entrySchema.safeParse({
    productModelId: formData.get("productModelId"),
    month: formData.get("month"),
    status: formData.get("status"),
    quantity: formData.get("quantity"),
    eventDate: formData.get("eventDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const model = await prisma.productModel.findFirst({
    where: { id: parsed.data.productModelId, organizationId: session.user.organizationId },
  });
  if (!model) return { error: "Артикул не найден" };

  await prisma.supplyPlanEntry.create({
    data: {
      organizationId: session.user.organizationId,
      productModelId: parsed.data.productModelId,
      month: new Date(`${parsed.data.month}-01`),
      status: parsed.data.status,
      quantity: parsed.data.quantity,
      eventDate: parsed.data.eventDate ? new Date(parsed.data.eventDate) : undefined,
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/supply-plan");
  return {};
}

const updateSchema = z.object({
  status: z.enum(STATUS_VALUES),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
  eventDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

export async function updateSupplyPlanEntry(entryId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = updateSchema.safeParse({
    status: formData.get("status"),
    quantity: formData.get("quantity"),
    eventDate: formData.get("eventDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  await prisma.supplyPlanEntry.updateMany({
    where: { id: entryId, organizationId: session.user.organizationId },
    data: {
      status: parsed.data.status,
      quantity: parsed.data.quantity,
      eventDate: parsed.data.eventDate ? new Date(parsed.data.eventDate) : null,
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/supply-plan");
}

export async function removeSupplyPlanEntry(entryId: string) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.supplyPlanEntry.deleteMany({
    where: { id: entryId, organizationId: session.user.organizationId },
  });
  revalidatePath("/supply-plan");
}
