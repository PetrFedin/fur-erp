"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { acceptInboxRow, type AcceptResult } from "@/lib/inbox-accept";
import { invalidateControlCounts } from "@/lib/control-counts";

type R = { error?: string; ok?: boolean };

/** «Принять»: создаёт закупку (черновик) или ТЗ из присланного черновика, одной транзакцией. Повторное нажатие ничего не дублирует. */
export async function acceptInbox(id: string): Promise<AcceptResult> {
  const s = await requireRole(...ACCESS.inbox);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: "Входящее не найдено" };
  const r = await acceptInboxRow(s, id);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
  return r;
}

/** «Отклонить»: SENT → REJECTED с обязательным комментарием (поставщик увидит его у себя). */
export async function rejectInbox(id: string, note: string): Promise<R> {
  const s = await requireRole(...ACCESS.inbox);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: "Входящее не найдено" };
  const text = note.replace(/\s+/g, " ").trim();
  if (text.length < 3) return { error: "Напишите, что исправить, — поставщик увидит этот комментарий" };
  if (text.length > 1000) return { error: "Комментарий слишком длинный (до 1000 знаков)" };
  const r = await prisma.supplierInbox.updateMany({
    where: { id, organizationId: s.user.organizationId, status: "SENT" },
    data: { status: "REJECTED", reviewNote: text, decidedAt: new Date(), decidedById: s.user.id },
  });
  if (r.count !== 1) return { error: "Это входящее уже обработано (принято или отклонено) — обновите страницу." };
  invalidateControlCounts(s.user.organizationId);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
  return { ok: true };
}
