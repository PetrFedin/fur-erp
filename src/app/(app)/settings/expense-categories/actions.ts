"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "ACCOUNTANT"] as const;

const schema = z.object({
  name: z.string().trim().min(2, "Укажите название статьи").max(100, "Название слишком длинное"),
  kind: z.enum(["PURCHASE", "PRODUCTION", "GENERAL"]),
});

export async function createExpenseCategory(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = schema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
  });
  if (!parsed.success) {
    redirect(`/settings/expense-categories?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля формы")}`);
  }

  await prisma.expenseCategory.upsert({
    where: {
      organizationId_name_kind: {
        organizationId: session.user.organizationId,
        name: parsed.data.name,
        kind: parsed.data.kind,
      },
    },
    create: { organizationId: session.user.organizationId, ...parsed.data },
    update: { isActive: true },
  });
  revalidateAll(session.user.organizationId);
}

export async function toggleExpenseCategoryActive(id: string) {
  const session = await requireRole(...EDIT_ROLES);
  const category = await prisma.expenseCategory.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!category) return;

  await prisma.expenseCategory.update({
    where: { id },
    data: { isActive: !category.isActive },
  });
  revalidateAll(session.user.organizationId);
}

export async function updateExpenseCategory(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const id = String(formData.get("id") ?? "");
  const parsed = schema.safeParse({ name: formData.get("name"), kind: formData.get("kind") });
  if (!parsed.success) {
    redirect(`/settings/expense-categories?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля формы")}`);
  }
  const category = await prisma.expenseCategory.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!category) return;
  const clash = await prisma.expenseCategory.findFirst({
    where: { organizationId: session.user.organizationId, name: parsed.data.name, kind: parsed.data.kind, NOT: { id } },
  });
  if (clash) redirect(`/settings/expense-categories?error=${encodeURIComponent("Такая статья с этим типом уже есть")}`);
  await prisma.expenseCategory.update({ where: { id }, data: parsed.data });
  revalidateAll(session.user.organizationId);
}

/** Удалить статью можно, только если она нигде не использована (ни в расходах закупок, ни в расходах ТЗ); иначе — «Деактивировать». */
export async function deleteExpenseCategory(id: string): Promise<{ error?: string }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const c = await prisma.expenseCategory.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!c) return { error: "Статья не найдена" };
  const [p, q] = await Promise.all([prisma.purchaseExpense.count({ where: { categoryId: id } }), prisma.productionExpense.count({ where: { categoryId: id } })]);
  if (p + q > 0) return { error: `Статья используется в расходах (${p + q}) — деактивируйте её` };
  await prisma.expenseCategory.deleteMany({ where: { id, organizationId: orgId } });
  revalidateAll(session.user.organizationId);
  return {};
}
