"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { checkOrgRefs } from "@/lib/org-guard";
import { cleanSearch, parseDateInput, zNum } from "@/lib/input";
import { revalidateAll } from "@/lib/revalidate-all";

const EDIT = ACCESS.planning;
// ok — запись сохранена без перехода (форма в раскрытом дне: страница остаётся на месте и обновляется).
export type EventFormState = { error?: string; ok?: boolean };

const schema = z.object({
  articleCode: z.string().trim().min(1, "Укажите артикул").max(100, "Артикул слишком длинный"),
  articleName: z.string().trim().max(200).optional(),
  quantity: zNum("Количество", { positive: true, int: true, max: 1_000_000 }),
  action: z.string().trim().min(1, "Выберите или впишите действие").max(60, "Действие — не длиннее 60 знаков"),
  notes: z.string().trim().max(1000, "Заметка — не длиннее 1000 знаков").optional(),
});

const opt = (v: FormDataEntryValue | null) => cleanSearch(v, 40) || undefined;

async function readEvent(orgId: string, formData: FormData) {
  const p = schema.safeParse({
    articleCode: formData.get("articleCode"),
    articleName: formData.get("articleName") || undefined,
    quantity: formData.get("quantity"),
    action: formData.get("action"),
    notes: formData.get("notes") || undefined,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Проверьте форму" } as const;
  const date = parseDateInput(formData.get("date"));
  if (!date) return { error: "Выберите дату (корректную)" } as const;
  const endRaw = String(formData.get("endDate") ?? "");
  const endDate = endRaw ? parseDateInput(endRaw) : null;
  if (endRaw && !endDate) return { error: "Некорректная дата «по»" } as const;
  if (endDate && endDate < date) return { error: "Дата «по» раньше даты «с»" } as const;
  if (endDate && (endDate.getTime() - date.getTime()) / 86_400_000 > 366) return { error: "Период — не больше года" } as const;
  const seasonId = opt(formData.get("seasonId"));
  const planId = opt(formData.get("planId"));
  const orderId = opt(formData.get("orderId"));
  const bad = await checkOrgRefs(orgId, { productionOrder: orderId });
  if (bad) return { error: bad } as const;
  if (seasonId && !(await prisma.season.count({ where: { id: seasonId, organizationId: orgId } }))) return { error: "Сезон не найден" } as const;
  if (planId && !(await prisma.productionPlan.count({ where: { id: planId, organizationId: orgId } }))) return { error: "Позиция плана не найдена" } as const;
  return {
    data: {
      date,
      endDate,
      articleCode: p.data.articleCode,
      articleName: p.data.articleName || null,
      quantity: p.data.quantity as number,
      action: p.data.action,
      notes: p.data.notes || null,
      seasonId: seasonId ?? null,
      planId: planId ?? null,
      orderId: orderId ?? null,
      done: formData.get("done") === "on",
    },
  } as const;
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export async function createEvent(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const session = await requireRole(...EDIT);
  const r = await readEvent(session.user.organizationId, formData);
  if ("error" in r) return { error: r.error };
  const { done, ...data } = r.data;
  await prisma.calendarEvent.create({
    data: { ...data, organizationId: session.user.organizationId, createdById: session.user.id, doneAt: done ? new Date() : null },
  });
  revalidateAll(session.user.organizationId);
  if (formData.get("stay") === "1") return { ok: true };
  redirect(`/calendar?m=${monthOf(data.date)}`);
}

export async function updateEvent(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const id = cleanSearch(formData.get("id"), 40);
  const own = await prisma.calendarEvent.findFirst({ where: { id, organizationId: orgId } });
  if (!own) return { error: "Событие не найдено" };
  const r = await readEvent(orgId, formData);
  if ("error" in r) return { error: r.error };
  const { done, ...data } = r.data;
  await prisma.calendarEvent.update({ where: { id }, data: { ...data, doneAt: done ? (own.doneAt ?? new Date()) : null } });
  revalidateAll(orgId);
  if (formData.get("stay") === "1") return { ok: true };
  redirect(`/calendar?m=${monthOf(data.date)}`);
}

export async function toggleDone(formData: FormData) {
  const session = await requireRole(...EDIT);
  const id = cleanSearch(formData.get("id"), 40);
  const own = await prisma.calendarEvent.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!own) redirect("/calendar");
  await prisma.calendarEvent.update({ where: { id }, data: { doneAt: own.doneAt ? null : new Date() } });
  revalidateAll(session.user.organizationId);
  redirect(`/calendar?m=${monthOf(own.date)}`);
}

export async function deleteEvent(formData: FormData) {
  const session = await requireRole(...EDIT);
  const id = cleanSearch(formData.get("id"), 40);
  const own = await prisma.calendarEvent.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (own) await prisma.calendarEvent.delete({ where: { id } });
  revalidateAll(session.user.organizationId);
  redirect(`/calendar?m=${own ? monthOf(own.date) : ""}`);
}

/** Из раскрытого дня: отметить выполненным / вернуть в план — без перехода со страницы. */
export async function setEventDone(id: string, done: boolean): Promise<EventFormState> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const own = await prisma.calendarEvent.findFirst({ where: { id: cleanSearch(id, 40), organizationId: orgId } });
  if (!own) return { error: "Событие не найдено" };
  await prisma.calendarEvent.update({ where: { id: own.id }, data: { doneAt: done ? (own.doneAt ?? new Date()) : null } });
  revalidateAll(orgId);
  return { ok: true };
}

/** Из раскрытого дня: удалить событие (подтверждение — на клиенте, useConfirm). */
export async function removeEvent(id: string): Promise<EventFormState> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const own = await prisma.calendarEvent.findFirst({ where: { id: cleanSearch(id, 40), organizationId: orgId } });
  if (!own) return { error: "Событие уже удалено" };
  await prisma.calendarEvent.delete({ where: { id: own.id } });
  revalidateAll(orgId);
  return { ok: true };
}
