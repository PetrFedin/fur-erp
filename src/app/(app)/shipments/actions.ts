"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { DATE_RANGE_ERROR, MAX_LINE_QTY, MAX_LINES, MAX_TOTAL_QTY, isDateInRange } from "@/lib/shipments";

// Так же, как в разделе ТЗ: планировать отгрузки могут те, кто ведёт ТЗ.
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type ShipmentState = { error?: string; id?: string };

const dateStr = z
  .string({ error: "Укажите дату" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату")
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Укажите дату")
  .refine(isDateInRange, DATE_RANGE_ERROR);

const lineSchema = z.object({
  productionOrderId: z.string({ error: "Выберите ТЗ" }).min(1, "Выберите ТЗ"),
  size: z.string({ error: "Некорректный размер" }).trim().max(40, "Размер не длиннее 40 символов").optional(),
  quantity: z
    .number({ error: "Количество должно быть числом" })
    .int("Количество должно быть целым")
    .positive("Количество должно быть больше 0")
    .max(MAX_LINE_QTY, `Количество в строке не больше ${MAX_LINE_QTY.toLocaleString("ru-RU")} шт.`),
});

const inputSchema = z.object({
  plannedDate: dateStr,
  clientId: z.string({ error: "Некорректный заказчик" }).optional(),
  notes: z.string({ error: "Некорректная заметка" }).trim().max(2000, "Заметка не длиннее 2000 символов").optional(),
  lines: z
    .array(lineSchema, { error: "Добавьте хотя бы одну строку с количеством" })
    .min(1, "Добавьте хотя бы одну строку с количеством")
    .max(MAX_LINES, `Не больше ${MAX_LINES} строк в одной отгрузке`),
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

async function checkRefs(organizationId: string, input: z.infer<typeof inputSchema>, keepOrderIds: string[] = []) {
  const total = input.lines.reduce((a, l) => a + l.quantity, 0);
  if (total > MAX_TOTAL_QTY) return `Общее количество в отгрузке не больше ${MAX_TOTAL_QTY.toLocaleString("ru-RU")} шт.`;
  if (input.clientId) {
    const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true } });
    if (!c) return "Заказчик не найден";
  }
  const ids = [...new Set(input.lines.map((l) => l.productionOrderId))];
  const found = await prisma.productionOrder.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, status: true, clientId: true },
  });
  if (found.length !== ids.length) return "ТЗ не найдено";
  for (const o of found) {
    // Уже вошедшее в эту отгрузку ТЗ при правке оставляем, даже если его потом отменили.
    if (o.status === "CANCELLED" && !keepOrderIds.includes(o.id)) return "Нельзя отгружать по отменённому ТЗ";
    if ((o.clientId ?? null) !== (input.clientId || null)) return "ТЗ не принадлежит выбранному заказчику";
  }
  return null;
}

const toLines = (input: z.infer<typeof inputSchema>) =>
  input.lines.map((l) => ({
    productionOrderId: l.productionOrderId,
    size: l.size && l.size !== "—" ? l.size : null,
    quantity: l.quantity,
  }));

function revalidate(orgId: string) {
  revalidateAll(orgId);
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
  revalidate(session.user.organizationId);
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
  const existing = await prisma.shipmentLine.findMany({ where: { shipmentId: id }, select: { productionOrderId: true } });
  const bad = await checkRefs(organizationId, parsed.data, existing.map((l) => l.productionOrderId));
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
  revalidate(session.user.organizationId);
  return { id };
}

export async function markShipped(id: string, shippedDate: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const d = dateStr.safeParse(shippedDate);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Укажите фактическую дату отгрузки" };
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "PLANNED") return { error: "Отметить можно только запланированную отгрузку" };
  await prisma.shipment.update({ where: { id }, data: { status: "SHIPPED", shippedDate: new Date(d.data) } });
  revalidate(session.user.organizationId);
  return { id };
}

/** Для отгруженной: только заметка и фактическая дата. */
export async function updateShippedShipment(id: string, shippedDate: string, notes: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const d = dateStr.safeParse(shippedDate);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Укажите фактическую дату отгрузки" };
  if (notes.trim().length > 2000) return { error: "Заметка не длиннее 2000 символов" };
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "SHIPPED") return { error: "Правка доступна только для отгруженной отгрузки" };
  await prisma.shipment.update({
    where: { id },
    data: { shippedDate: new Date(d.data), notes: notes.trim().slice(0, 2000) || null },
  });
  revalidate(session.user.organizationId);
  return { id };
}

export async function cancelShipment(id: string): Promise<ShipmentState> {
  const session = await requireRole(...EDIT_ROLES);
  const cur = await prisma.shipment.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!cur) return { error: "Отгрузка не найдена" };
  if (cur.status !== "PLANNED") return { error: "Отменить можно только запланированную отгрузку" };
  await prisma.shipment.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidate(session.user.organizationId);
  return { id };
}
