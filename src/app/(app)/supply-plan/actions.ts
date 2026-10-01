"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { zNum, parseDateInput } from "@/lib/input";
import { ACCESS } from "@/lib/access";

const EDIT_ROLES = ACCESS.supplyPlan;

const STATUS_VALUES = ["PLANNED", "LAUNCHED", "WITH_FURRIER", "WITH_TAILOR", "PRODUCED", "CANCELLED"] as const;

const MAX_PLAN_QTY = 1_000_000;

const monthField = z
  .string()
  .min(1, "Укажите месяц")
  .refine((s) => {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
    return !!m && Number(m[1]) >= 2020 && Number(m[1]) <= 2100;
  }, "Месяц должен быть в формате ГГГГ-ММ, год от 2020 до 2100");

const eventDateField = z
  .string()
  .optional()
  .refine((s) => !s || parseDateInput(s) !== null, "Некорректная дата события");

const quantityField = zNum("Количество", { positive: true, int: true, max: MAX_PLAN_QTY });

const entrySchema = z.object({
  productModelId: z.string().min(1, "Выберите артикул"),
  month: monthField,
  status: z.enum(STATUS_VALUES, { message: "Выберите статус" }),
  quantity: quantityField,
  eventDate: eventDateField,
  notes: z.string().trim().max(1000, "Заметка не длиннее 1000 символов").optional(),
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
  status: z.enum(STATUS_VALUES, { message: "Выберите статус" }),
  quantity: quantityField,
  eventDate: eventDateField,
  notes: z.string().trim().max(1000, "Заметка не длиннее 1000 символов").optional(),
});

export async function updateSupplyPlanEntry(entryId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = updateSchema.safeParse({
    status: formData.get("status"),
    quantity: formData.get("quantity"),
    eventDate: formData.get("eventDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля записи" };

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
  return {};
}

export async function removeSupplyPlanEntry(entryId: string) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.supplyPlanEntry.deleteMany({
    where: { id: entryId, organizationId: session.user.organizationId },
  });
  revalidatePath("/supply-plan");
}
