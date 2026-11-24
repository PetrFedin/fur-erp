"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByOrder } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNum } from "@/lib/input";
import { type FormState, getEditableOrder, syncCompletedOrderCost, applyExpenseEdit } from "./shared";

// ---------- Production expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: zNum("Сумма", { positive: true }),
  description: z.string().trim().max(500).optional(),
});

export async function addProductionExpense(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const badCat = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badCat) return { error: badCat };

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.create({
      data: { productionOrderId: orderId, ...parsed.data },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

export async function removeProductionExpense(orderId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    // Только расход этого (своего) ТЗ: чужой id не удалится.
    await tx.productionExpense.deleteMany({ where: { id: expenseId, productionOrderId: orderId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });
  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
}

export async function updateProductionExpense(
  orderId: string,
  expenseId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };


  const expense = await prisma.productionExpense.findFirst({
    where: { id: expenseId, productionOrderId: orderId },
  });
  if (!expense) return { error: "Расход не найден" };

  const parsed = z
    .object({
      categoryId: z.string().min(1, "Выберите статью расходов"),
      amount: zNum("Сумма", { positive: true }),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      amount: formData.get("amount"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const badCat = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badCat) return { error: badCat };

  const description = (formData.get("description") as string)?.trim() || null;

  await prisma.$transaction((tx) => applyExpenseEdit(tx, session.user.organizationId, orderId, expense.id, parsed.data.categoryId, parsed.data.amount, description));

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}
