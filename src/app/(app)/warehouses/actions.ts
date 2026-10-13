"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

const EDIT_ROLES = ACCESS.warehouses;

const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Укажите название склада"),
  address: z.string().trim().optional(),
  isDefault: z.coerce.boolean().default(false),
});

export type WarehouseFormState = { error?: string; ok?: boolean };

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

  const dup = await prisma.warehouse.findFirst({
    where: { organizationId: session.user.organizationId, name: { equals: parsed.data.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (dup) return { error: "Такой склад уже есть: откройте его в списке или измените название" };

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: session.user.organizationId, ...parsed.data },
  });
  if (parsed.data.isDefault) {
    await clearOtherDefaults(session.user.organizationId, warehouse.id);
  }

  revalidateAll(session.user.organizationId);
  return { ok: true };
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

  revalidateAll(session.user.organizationId);
  redirect("/warehouses");
}
