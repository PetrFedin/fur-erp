"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { BIND_CODE_TTL_MS, makeBindCode } from "@/lib/chat-core";
import { canUseChat } from "@/lib/chat";

export type CodeState = { error?: string; code?: string; minutes?: number; hint?: string };

async function newCode(data: { organizationId: string; userId?: string; supplierId?: string; kind: "PRIVATE" | "GROUP" }) {
  const code = makeBindCode((n) => randomBytes(n));
  await prisma.channelBindCode.create({ data: { code, organizationId: data.organizationId, userId: data.userId ?? null, supplierId: data.supplierId ?? null, kind: data.kind, expiresAt: new Date(Date.now() + BIND_CODE_TTL_MS) } });
  return code;
}

/** Одноразовый код (15 минут) для привязки личного Telegram: боту — /start КОД. */
export async function createMyBindCode(): Promise<CodeState> {
  const s = await requireSession({ allowSupplier: true });
  if (!canUseChat(s.user.role)) return { error: "Нет доступа" };
  const code = await newCode({ organizationId: s.user.organizationId, userId: s.user.id, kind: "PRIVATE" });
  return { code, minutes: BIND_CODE_TTL_MS / 60000, hint: `/start ${code}` };
}

export async function unlinkMyTelegram(): Promise<void> {
  const s = await requireSession({ allowSupplier: true });
  await prisma.channelLink.deleteMany({ where: { organizationId: s.user.organizationId, userId: s.user.id, channel: "TELEGRAM" } });
  revalidatePath("/chat");
}

/** Код группы: «группа поставщика» (supplierId) или внутренняя группа (supplierId пусто). В группе с ботом — /bind КОД. Только владелец и администратор. */
export async function createGroupBindCode(supplierId: string): Promise<CodeState> {
  const s = await requireSession();
  if (!hasRole(s.user.role, ACCESS.channels)) return { error: "Только владелец и администратор" };
  let sup: string | undefined;
  if (supplierId) {
    const ok = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.user.organizationId }, select: { id: true } });
    if (!ok) return { error: "Поставщик не найден" };
    sup = ok.id;
  }
  const code = await newCode({ organizationId: s.user.organizationId, supplierId: sup, kind: "GROUP" });
  return { code, minutes: BIND_CODE_TTL_MS / 60000, hint: `/bind ${code}` };
}

export async function revokeLink(id: string): Promise<void> {
  const s = await requireSession();
  if (!hasRole(s.user.role, ACCESS.channels)) return;
  await prisma.channelLink.deleteMany({ where: { id, organizationId: s.user.organizationId } });
  revalidatePath("/settings/channels");
}
