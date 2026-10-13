"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
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
    redirect(`/expense-categories?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля формы")}`);
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
  revalidatePath("/expense-categories");
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
  revalidatePath("/expense-categories");
}

export async function updateExpenseCategory(formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const id = String(formData.get("id") ?? "");
  const parsed = schema.safeParse({ name: formData.get("name"), kind: formData.get("kind") });
  if (!parsed.success) {
    redirect(`/expense-categories?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля формы")}`);
  }
  const category = await prisma.expenseCategory.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!category) return;
  const clash = await prisma.expenseCategory.findFirst({
    where: { organizationId: session.user.organizationId, name: parsed.data.name, kind: parsed.data.kind, NOT: { id } },
  });
  if (clash) redirect(`/expense-categories?error=${encodeURIComponent("Такая статья с этим типом уже есть")}`);
  await prisma.expenseCategory.update({ where: { id }, data: parsed.data });
  revalidatePath("/expense-categories");
}
