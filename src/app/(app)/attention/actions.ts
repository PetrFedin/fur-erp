"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { DECISIONS, DECISION_KEY_PREFIX } from "@/lib/task-docs-catalog";
import { invalidateControlCounts } from "@/lib/control-counts";

/**
 * «Решено: …» в блоке «Решения владельца». Выбор из вариантов каталога (task-docs-catalog.ts) пишется в SystemState
 * (ключ `owner-decision:<id>`): кто, когда, что выбрал и заметка. Расширение клиента БД пишет правку в журнал изменений
 * («Контроль → История»). Сами данные решение не меняет — в каждом варианте указано, что делать дальше.
 * Повторный выбор заменяет прежний (прежний остаётся в истории).
 */
export async function decideAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasRole(session.user.role, ACCESS.taskDecisions)) return;
  const id = String(formData.get("id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const note = String(formData.get("note") ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, 500);
  const decision = DECISIONS.find((d) => d.id === id);
  const option = decision?.options.find((o) => o.key === choice);
  if (!decision || !option) return;

  const organizationId = session.user.organizationId;
  const key = DECISION_KEY_PREFIX + decision.id;
  const value = {
    choice: option.key,
    label: option.label,
    note: note || null,
    at: new Date().toISOString(),
    by: session.user.id,
    byName: session.user.name ?? null,
  };
  await prisma.systemState.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value },
    update: { value },
  });
  invalidateControlCounts(organizationId);
  revalidatePath("/attention");
  revalidatePath("/dashboard");
}

/** Снять решение (вернуть вопрос в открытые). Запись удаляется, факт остаётся в журнале изменений. */
export async function reopenDecisionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!hasRole(session.user.role, ACCESS.taskDecisions)) return;
  const id = String(formData.get("id") ?? "");
  if (!DECISIONS.some((d) => d.id === id)) return;
  const organizationId = session.user.organizationId;
  await prisma.systemState.deleteMany({ where: { organizationId, key: DECISION_KEY_PREFIX + id } });
  invalidateControlCounts(organizationId);
  revalidatePath("/attention");
  revalidatePath("/dashboard");
}
