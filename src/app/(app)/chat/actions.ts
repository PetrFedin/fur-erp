"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canUseChat, appendMessage, createThread, defaultSupplierId, loadThread, markRead, resolveEntity, searchEntities, toggleReaction, viewerOf } from "@/lib/chat";
import { REQUEST_TYPES } from "@/lib/chat-core";
import { isPickedFile, readDocumentFiles, writeDocumentFiles, type StoredDoc } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { dispatchMessage } from "@/lib/channels/dispatch";

export type ChatState = { error?: string; ok?: boolean; threadId?: string };

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

async function chatSession() {
  const s = await requireSession({ allowSupplier: true });
  if (!canUseChat(s.user.role)) throw new Error("Нет доступа к чату");
  return viewerOf(s);
}

async function readFiles(fd: FormData, orgId: string): Promise<{ error: string } | { files: StoredDoc[] }> {
  const entries = fd.getAll("files").filter(isPickedFile);
  if (entries.length === 0) return { files: [] };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return { error: read.error };
  return { files: await writeDocumentFiles(orgId, "chat", read.files) };
}

/** Написать в обсуждение (текст и/или файлы). */
export async function sendMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const v = await chatSession();
  const t = await loadThread(v, clip(fd.get("threadId"), 64));
  if (!t) return { error: "Обсуждение не найдено" };
  const body = clip(fd.get("body"), 4000);
  const f = await readFiles(fd, v.organizationId);
  if ("error" in f) return { error: f.error };
  if (!body && f.files.length === 0) return { error: "Напишите сообщение или приложите файл" };
  try {
    const { message } = await appendMessage({ threadId: t.id, organizationId: v.organizationId, authorId: v.id, authorName: v.name, authorSide: v.side, body, files: f.files });
    await markRead(v, t.id);
    after(() => dispatchMessage(message.id).catch(() => {}));
  } catch (e) {
    await removeStoredFiles(f.files.map((x) => x.storagePath));
    return { error: e instanceof Error ? e.message : "Не удалось отправить" };
  }
  revalidatePath("/chat");
  return { ok: true, threadId: t.id };
}

/** Новое обсуждение или запрос: по записи или общий вопрос. */
export async function startThread(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const v = await chatSession();
  const kind = fd.get("kind") === "REQUEST" ? "REQUEST" : "GENERAL";
  const type = clip(fd.get("entityType"), 40);
  const id = clip(fd.get("entityId"), 64);
  let entity = null;
  if (type && id) {
    entity = await resolveEntity(v, type, id);
    if (!entity) return { error: "Запись не найдена или недоступна" };
  }
  const body = clip(fd.get("body"), 4000);
  const f = await readFiles(fd, v.organizationId);
  if ("error" in f) return { error: f.error };
  if (!body && f.files.length === 0) return { error: "Напишите сообщение или приложите файл" };
  const requestType = kind === "REQUEST" ? clip(fd.get("requestType"), 40) : "";
  if (kind === "REQUEST" && !(REQUEST_TYPES as readonly string[]).includes(requestType)) { await removeStoredFiles(f.files.map((x) => x.storagePath)); return { error: "Выберите тип запроса" }; }
  // С кем чат: у поставщика — он сам; у нас — поставщик записи, иначе указанный или единственный с кабинетом.
  let supplierId: string | null;
  if (v.side === "SUPPLIER") supplierId = v.supplierId;
  else {
    const wanted = clip(fd.get("supplierId"), 64);
    const ok = wanted ? await prisma.supplier.findFirst({ where: { id: wanted, organizationId: v.organizationId }, select: { id: true } }) : null;
    supplierId = entity?.supplierId ?? ok?.id ?? (await defaultSupplierId(v.organizationId));
  }
  if (!supplierId) { await removeStoredFiles(f.files.map((x) => x.storagePath)); return { error: "Нет поставщика с кабинетом, с которым можно переписываться" }; }
  const subject = clip(fd.get("subject"), 160) || (entity ? entity.label : body.split("\n")[0].slice(0, 60) || requestType || "Общий вопрос");
  try {
    const t = await createThread(v, { supplierId, kind, subject, requestType: requestType || null, entity });
    const { message } = await appendMessage({ threadId: t.id, organizationId: v.organizationId, authorId: v.id, authorName: v.name, authorSide: v.side, body, files: f.files });
    await markRead(v, t.id);
    after(() => dispatchMessage(message.id).catch(() => {}));
    revalidatePath("/chat");
    return { ok: true, threadId: t.id };
  } catch (e) {
    await removeStoredFiles(f.files.map((x) => x.storagePath));
    return { error: e instanceof Error ? e.message : "Не удалось создать обсуждение" };
  }
}

/** Закрыть запрос или открыть заново. */
export async function setThreadClosed(threadId: string, closed: boolean): Promise<ChatState> {
  const v = await chatSession();
  const t = await loadThread(v, threadId);
  if (!t) return { error: "Обсуждение не найдено" };
  await prisma.chatThread.update({
    where: { id: t.id },
    data: closed ? { status: "CLOSED", closedAt: new Date(), closedById: v.id } : { status: "OPEN", closedAt: null, closedById: null },
  });
  revalidatePath("/chat");
  return { ok: true, threadId: t.id };
}

/** Отметить обсуждение прочитанным (при открытии). */
export async function markThreadRead(threadId: string): Promise<void> {
  const v = await chatSession();
  const t = await loadThread(v, threadId);
  if (t) await markRead(v, t.id);
}

/** Поиск записей для формы «Новый запрос». */
export async function searchEntitiesAction(type: string, q: string): Promise<{ id: string; label: string }[]> {
  const v = await chatSession();
  return searchEntities(v, clip(type, 40), clip(q, 60));
}

/** Создать группу по теме с участниками (только сотрудники). */
export async function createGroupAction(input: { name: string; topic: string; memberIds: string[]; entityType?: string; entityId?: string }): Promise<ChatState> {
  const { createGroup } = await import("@/lib/chat");
  const v = await chatSession();
  let entity = null;
  if (input.entityType && input.entityId) {
    entity = await resolveEntity(v, clip(input.entityType, 40), clip(input.entityId, 64));
    if (!entity) return { error: "Запись не найдена или недоступна" };
  }
  const r = await createGroup(v, { name: clip(input.name, 120), topic: clip(input.topic, 40), memberIds: (input.memberIds ?? []).slice(0, 100).map((x) => clip(x, 64)), entity });
  if ("error" in r) return { error: r.error };
  revalidatePath("/chat");
  return { ok: true, threadId: r.threadId };
}

/** Участники, которых можно позвать в группу этой темы. */
export async function eligibleUsersAction(topic: string): Promise<{ id: string; name: string; role: string; isSupplier: boolean }[]> {
  const { eligibleUsers } = await import("@/lib/chat");
  const v = await chatSession();
  if (v.side === "SUPPLIER") return [];
  return eligibleUsers(v.organizationId, clip(topic, 40));
}

/** Добавить / убрать участника (или выйти из группы). */
export async function changeMemberAction(threadId: string, userId: string, op: "add" | "remove"): Promise<ChatState> {
  const { changeMember } = await import("@/lib/chat");
  const v = await chatSession();
  const r = await changeMember(v, clip(threadId, 64), clip(userId, 64), op === "add" ? "add" : "remove");
  revalidatePath("/chat");
  return r.error ? { error: r.error } : { ok: true };
}

/** Поставить / снять реакцию на сообщение. */
export async function toggleReactionAction(messageId: string, emoji: string): Promise<ChatState> {
  const v = await chatSession();
  const r = await toggleReaction(v, clip(messageId, 64), clip(emoji, 16));
  if (r.error) return { error: r.error };
  revalidatePath("/chat");
  return { ok: true };
}
