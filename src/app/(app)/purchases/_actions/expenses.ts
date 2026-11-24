"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNum } from "@/lib/input";
import { resetByPurchase } from "@/lib/verification";
import { staleError, PURCHASE_EXPENSE_V } from "@/lib/concurrency";
import { vatField, EDIT_ROLES, type FormState, getEditablePurchase } from "./shared";

// ---------- Expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: zNum("Сумма", { positive: true }),
  vatRate: vatField,
  description: z.string().trim().max(500).optional(),
});

export async function addPurchaseExpense(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать — она уже принята на склад или отменена" };

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate") ?? 0,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля расхода" };
  const badRef = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };

  await prisma.purchaseExpense.create({
    data: { purchaseId, ...parsed.data },
  });

  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

export async function removePurchaseExpense(purchaseId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseExpense.deleteMany({ where: { id: expenseId, purchaseId: purchase.id } });
  await resetByPurchase(purchaseId);
  revalidateAll();
}

export async function updatePurchaseExpense(purchaseId: string, expenseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await getEditablePurchase(orgId, purchaseId);
  if (!purchase) {
    return { error: "Расходы принятой закупки менять нельзя: они уже распределены по лотам (себестоимость лотов зафиксирована). Чтобы исправить расход, верните закупку к приёмке через администратора или внесите поправку отдельным расходом в ТЗ." };
  }
  const exp = await prisma.purchaseExpense.findFirst({ where: { id: expenseId, purchaseId } });
  if (!exp) return { error: "Расход не найден (возможно, уже удалён)" };
  const stale = staleError(formData, exp, PURCHASE_EXPENSE_V);
  if (stale) return { error: stale };
  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate") ?? 0,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля расхода" };
  const badRef = await checkOrgRefs(orgId, { expenseCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };
  await prisma.purchaseExpense.update({
    where: { id: expenseId },
    data: {
      categoryId: parsed.data.categoryId,
      amount: parsed.data.amount,
      vatRate: parsed.data.vatRate,
      description: (formData.get("description") as string)?.trim() || null,
    },
  });
  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}
