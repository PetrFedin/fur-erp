"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const clientSchema = z.object({
  name: z.string().trim().min(2, "Укажите название заказчика"),
  inn: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("Некорректный email").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type ClientFormState = { error?: string };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

function parseClient(formData: FormData) {
  return clientSchema.safeParse({
    name: formData.get("name"),
    inn: formData.get("inn") || undefined,
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    address: formData.get("address") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function createClient(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parseClient(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }

  await prisma.client.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });

  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClient(
  id: string,
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parseClient(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }

  const result = await prisma.client.updateMany({
    where: { id, organizationId: session.user.organizationId },
    data: parsed.data,
  });
  if (result.count === 0) {
    return { error: "Заказчик не найден" };
  }

  revalidatePath("/clients");
  redirect("/clients");
}

export async function toggleClientActive(id: string) {
  const session = await requireRole(...EDIT_ROLES);
  const client = await prisma.client.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!client) return;

  await prisma.client.update({
    where: { id },
    data: { isActive: !client.isActive },
  });
  revalidatePath("/clients");
}
