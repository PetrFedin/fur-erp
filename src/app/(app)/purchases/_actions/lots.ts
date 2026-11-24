"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { resolveColorInput } from "@/lib/colors";
import { resetByPurchase } from "@/lib/verification";
import { staleError, LOT_V } from "@/lib/concurrency";
import { parseLotSizeGrade } from "@/lib/lot-size";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { WAREHOUSE_ROLES, type FormState } from "./shared";

const lotMetaSchema = z.object({
  lotNumber: z.string().trim().max(100),
  grade: z.string().trim().max(500),
  sizeGrade: z.string().trim().max(40),
  notes: z.string().trim().max(2000),
});

/**
 * Безопасные поля лота ПОСЛЕ приёмки: № лота, сорт/описание, размер, цвет (из справочника), примечание.
 * Количество, цена и остатки не затрагиваются (их правит строка закупки, пока лот не списан).
 * Размер: пусто = определить из сорта автоматически (src/lib/lot-size.ts).
 * Если лот питает одну позицию закупки — её лот/сорт/цвет обновляются вместе с лотом.
 */
export async function updateLotMeta(lotId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);
  const orgId = session.user.organizationId;
  const lot = await prisma.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: orgId },
    include: { rawMaterial: { select: { name: true } }, purchaseItems: { select: { id: true } } },
  });
  if (!lot) return { error: "Лот не найден" };
  const stale = staleError(formData, lot, LOT_V);
  if (stale) return { error: stale };
  const parsed = lotMetaSchema.safeParse({
    lotNumber: String(formData.get("lotNumber") ?? ""),
    grade: String(formData.get("grade") ?? ""),
    sizeGrade: String(formData.get("sizeGrade") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля лота" };
  const colorRes = await resolveColorInput(prisma, orgId, { color: String(formData.get("color") ?? ""), colorRefId: formData.get("colorRefId") as string | null });
  const grade = parsed.data.grade || null;
  const sizeGrade = parsed.data.sizeGrade ? parsed.data.sizeGrade.toUpperCase() : parseLotSizeGrade(grade, lot.rawMaterial.name);
  const lotNumber = parsed.data.lotNumber || null;
  const cosmetic = { lotNumber, grade, color: colorRes.color, colorRefId: colorRes.colorRefId };
  await prisma.$transaction([
    prisma.rawMaterialLot.update({ where: { id: lotId }, data: { ...cosmetic, sizeGrade, notes: parsed.data.notes || null } }),
    ...(lot.purchaseItems.length === 1
      ? [prisma.purchaseItem.update({ where: { id: lot.purchaseItems[0].id }, data: cosmetic })]
      : []),
  ]);
  if (lot.purchaseId) await resetByPurchase(lot.purchaseId);
  invalidateFilterOptions(orgId);
  revalidateAll(orgId);
  return {};
}
