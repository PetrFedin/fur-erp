"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

// Так же, как в разделе ТЗ: планировать отгрузки могут те, кто ведёт ТЗ.
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type ShipmentState = { error?: string; id?: string };

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату")
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Укажите дату");

const lineSchema = z.object({
  productionOrderId: z.string().min(1),
  size: z.string().trim().max(40).optional(),
  quantity: z.number({ error: "Количество должно быть числом" }).int("Количество должно быть целым").positive("Количество должно быть больше 0"),
});

const inputSchema = z.object({
  plannedDate: dateStr,
  clientId: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema).min(1, "Добавьте хотя бы одну строку с количеством"),
});

export type ShipmentInput = {
  plannedDate: string;
  clientId?: string;
  notes?: string;
  lines: { productionOrderId: string; size?: string; quantity: number }[];
};

function firstError(e: z.ZodError) {
  return e.issues[0]?.message ?? "Проверьте форму";
}

async function checkRefs(organizationId: string, input: z.infer<typeof inputSchema>) {
  if (input.clientId) {
    const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true } });
    if (!c) return "Заказчик не найден";
  }
  const ids = [...new Set(input.lines.map((l) => l.productionOrderId))];
  const n = await prisma.productionOrder.count({ where: { id: { in: ids }, organizationId } });
  if (n !== ids.length) return "ТЗ не найдено";
  return null;
}

const toLines = (input: z.infer<typeof inputSchema>) =>
  input.lines.map((l) => ({
    productionOrderId: l.productionOrderId,
    size: l.size && l.size !== "—" ? l.size : null,
    quantity: l.quantity,
  }));

function revalidate(id?: string) {
  revalidatePath("/shipments");
  if (id) revalidatePath(`/shipments/${id}`);
  revalidatePath("/production", "layout");
  revalidatePath("/articles");
}

export async function createShipment(raw: ShipmentInput): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const organizationId = session.user.organizationId;
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const bad = await checkRefs(organizationId, parsed.data);
  if (bad) return { error: bad };
  const s = await prisma.shipment.create({
    data: {
      organizationId,
      clientId: parsed.data.clientId || null,
      plannedDate: new Date(parsed.data.plannedDate),
      notes: parsed.data.notes || null,
      createdById: session.user.id,
      lines: { create: toLines(parsed.data) },
    },
  });
  revalidate(s.id);
  return { id: s.id };
}

/** Пока не отгружена: дата, заказчик, заметка и состав. */
export async function updateShipment(id: string, raw: ShipmentInput): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const organizationId = session.user.organizationId;
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "PLANNED") return { error: "Изменить можно только запланированную отгрузку" };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const bad = await checkRefs(organizationId, parsed.data);
  if (bad) return { error: bad };
  await prisma.$transaction([
    prisma.shipmentLine.deleteMany({ where: { shipmentId: id } }),
    prisma.shipment.update({
      where: { id },
      data: {
        clientId: parsed.data.clientId || null,
        plannedDate: new Date(parsed.data.plannedDate),
        notes: parsed.data.notes || null,
        lines: { create: toLines(parsed.data) },
      },
    }),
  ]);
  revalidate(id);
  return { id };
}

export async function markShipped(id: string, shippedDate: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const d = dateStr.safeParse(shippedDate);
  if (!d.success) return { error: "Укажите фактическую дату отгрузки" };
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "PLANNED") return { error: "Отметить можно только запланированную отгрузку" };
  await prisma.shipment.update({ where: { id }, data: { status: "SHIPPED", shippedDate: new Date(d.data) } });
  revalidate(id);
  return { id };
}

/** Для отгруженной: только заметка и фактическая дата. */
export async function updateShippedShipment(id: string, shippedDate: string, notes: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const d = dateStr.safeParse(shippedDate);
  if (!d.success) return { error: "Укажите фактическую дату отгрузки" };
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "SHIPPED") return { error: "Правка доступна только для отгруженной отгрузки" };
  await prisma.shipment.update({
    where: { id },
    data: { shippedDate: new Date(d.data), notes: notes.trim().slice(0, 2000) || null },
  });
  revalidate(id);
  return { id };
}

export async function cancelShipment(id: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "PLANNED") return { error: "Отменить можно только запланированную отгрузку" };
  await prisma.shipment.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidate(id);
  return { id };
}
