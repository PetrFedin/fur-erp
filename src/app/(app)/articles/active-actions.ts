"use server";

import { prisma } from "@/lib/prisma";
import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

/** Вкл/выкл модели («Изделия»): выкл — модели нет в наличии, строка приглушена. Это существующее поле «Активен» артикула; правка пишется в журнал изменений. */
export async function setModelActive(modelId: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireRole(...ACCESS.models);
  const m = await prisma.productModel.findFirst({ where: { id: modelId, organizationId: session.user.organizationId }, select: { id: true } });
  if (!m) return { error: "Модель не найдена" };
  await prisma.productModel.update({ where: { id: modelId }, data: { isActive: active } });
  revalidateAll(session.user.organizationId);
  return {};
}
