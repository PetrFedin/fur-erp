"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Укажите название поставщика"),
  inn: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("Некорректный email").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type SupplierFormState = { error?: string };

const EDIT_ROLES = ACCESS.suppliers;

function parseSupplier(formData: FormData) {
  return supplierSchema.safeParse({
    name: formData.get("name"),
    inn: formData.get("inn") || undefined,
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    address: formData.get("address") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function createSupplier(
  _prev: SupplierFormState,
  formData: FormData
): Promise<SupplierFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parseSupplier(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }

  await prisma.supplier.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });

  revalidatePath("/suppliers");
  redirect("/suppliers");
}

export async function updateSupplier(
  id: string,
  _prev: SupplierFormState,
  formData: FormData
): Promise<SupplierFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parseSupplier(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }

  const result = await prisma.supplier.updateMany({
    where: { id, organizationId: session.user.organizationId },
    data: parsed.data,
  });
  if (result.count === 0) {
    return { error: "Поставщик не найден" };
  }

  revalidatePath("/suppliers");
  redirect("/suppliers");
}

export async function toggleSupplierActive(id: string) {
  const session = await requireRole(...EDIT_ROLES);
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!supplier) return;

  await prisma.supplier.update({
    where: { id },
    data: { isActive: !supplier.isActive },
  });
  revalidatePath("/suppliers");
}
