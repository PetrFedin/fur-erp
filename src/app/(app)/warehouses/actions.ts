"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const EDIT_ROLES = ["OWNER", "ADMIN", "WAREHOUSE"] as const;

const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Укажите название склада"),
  address: z.string().trim().optional(),
  isDefault: z.coerce.boolean().default(false),
});

export type WarehouseFormState = { error?: string };

function parse(formData: FormData) {
  return warehouseSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") || undefined,
    isDefault: formData.get("isDefault") === "on",
  });
}

async function clearOtherDefaults(organizationId: string, exceptId?: string) {
  await prisma.warehouse.updateMany({
    where: { organizationId, id: exceptId ? { not: exceptId } : undefined },
    data: { isDefault: false },
  });
}

export async function createWarehouse(
  _prev: WarehouseFormState,
  formData: FormData
): Promise<WarehouseFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });
  if (parsed.data.isDefault) {
    await clearOtherDefaults(session.user.organizationId, warehouse.id);
  }

  revalidatePath("/warehouses");
  redirect("/warehouses");
}

export async function updateWarehouse(
  id: string,
  _prev: WarehouseFormState,
  formData: FormData
): Promise<WarehouseFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const result = await prisma.warehouse.updateMany({
    where: { id, organizationId: session.user.organizationId },
    data: parsed.data,
  });
  if (result.count === 0) return { error: "Склад не найден" };
  if (parsed.data.isDefault) {
    await clearOtherDefaults(session.user.organizationId, id);
  }

  revalidatePath("/warehouses");
  redirect("/warehouses");
}
