"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByBatch } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { batchDeleteBlocker } from "@/lib/batch-delete";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { staleError, BATCH_V } from "@/lib/concurrency";
import { isUniqueViolation } from "@/lib/input";
import { type FormState } from "./shared";

const batchSchema = z.object({
  number: z.string().regex(/^\d{1,4}$/, "Номер партии — целое число от 1 до 9999"),
  name: z.string().trim().max(200),
  year: z.string().trim().regex(/^(\d{4})?$/, "Год — четыре цифры"),
  plannedUnits: z.string().trim().regex(/^(\d{1,6})?$/, "План, шт. — целое число"),
  notes: z.string().trim().max(2000),
});

/** Правка партии: номер, название, год, план, примечание. Номер должен быть свободен; ТЗ, документы и оплаты остаются привязаны (связь по id). */
export async function updateProductionBatch(batchId: string, formData: FormData): Promise<FormState & { number?: number }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const batch = await prisma.productionBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
  if (!batch) return { error: "Партия не найдена" };
  const stale = staleError(formData, batch, BATCH_V);
  if (stale) return { error: stale };
  const parsed = batchSchema.safeParse({
    number: String(formData.get("number") ?? ""),
    name: String(formData.get("name") ?? ""),
    year: String(formData.get("year") ?? ""),
    plannedUnits: String(formData.get("plannedUnits") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля партии" };
  const number = Number(parsed.data.number);
  if (number < 1) return { error: "Номер партии — целое число от 1 до 9999" };
  const year = parsed.data.year ? Number(parsed.data.year) : null;
  if (year !== null && (year < 2000 || year > 2100)) return { error: "Год вне диапазона 2000–2100" };
  if (number !== batch.number) {
    const taken = await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number, id: { not: batchId } }, select: { id: true } });
    if (taken) return { error: `Партия с номером ${number} уже есть — выберите другой номер или объедините ТЗ через карточки ТЗ` };
  }
  try {
    await prisma.productionBatch.update({
      where: { id: batchId },
      data: {
        number,
        name: parsed.data.name || null,
        year,
        plannedUnits: parsed.data.plannedUnits ? Number(parsed.data.plannedUnits) : null,
        notes: parsed.data.notes || null,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Партия с номером ${number} уже есть` };
    throw e;
  }
  await resetByBatch(orgId, batchId);
  revalidateAll(orgId);
  return { number };
}

/** «Удалить» пустую партию пошива (без ТЗ и документов). Партию с ТЗ удалить нельзя. */
export async function deleteProductionBatch(batchId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const batch = await prisma.productionBatch.findFirst({ where: { id: batchId, organizationId: orgId }, select: { id: true } });
  if (!batch) return { error: "Партия не найдена" };
  const why = await batchDeleteBlocker(orgId, batchId);
  if (why) return { error: why };
  await prisma.productionBatch.deleteMany({ where: { id: batchId, organizationId: orgId } });
  revalidateAll(orgId);
  return {};
}
