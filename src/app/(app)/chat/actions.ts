"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { canUseChat, appendMessage, loadThread, markRead, resolveEntity, searchEntities, toggleReaction, viewerOf } from "@/lib/chat";
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

export type NewChatState = ChatState & { existingId?: string; existingTitle?: string };

/** «+ Новый чат»: один путь для личного чата, группы и общего канала с подрядчиком. Поля — в JSON `payload`, файлы — `files`. */
export async function createChatAction(_prev: NewChatState, fd: FormData): Promise<NewChatState> {
  const { createChat } = await import("@/lib/chat");
  const v = await chatSession();
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(String(fd.get("payload") ?? "{}")) as Record<string, unknown>; } catch { return { error: "Не удалось прочитать форму" }; }
  const ids = (x: unknown) => (Array.isArray(x) ? x.slice(0, 100).map((y) => clip(y, 64)).filter(Boolean) : []);
  let entity = null;
  const type = clip(p.entityType, 40);
  const eid = clip(p.entityId, 64);
  if (type && eid) {
    entity = await resolveEntity(v, type, eid);
    if (!entity) return { error: "Запись не найдена или недоступна" };
  }
  const body = clip(p.body, 4000);
  const f = await readFiles(fd, v.organizationId);
  if ("error" in f) return { error: f.error };
  const topic = p.topic === null ? null : clip(p.topic, 40);
  const r = await createChat(v, {
    topic, customText: clip(p.customText, 100), title: clip(p.title, 120), userIds: ids(p.userIds), supplierIds: ids(p.supplierIds),
    entity, waitAnswer: p.waitAnswer === true, force: p.force === true,
  });
  if ("error" in r || "existingId" in r) {
    await removeStoredFiles(f.files.map((x) => x.storagePath));
    return "error" in r ? { error: r.error } : { existingId: r.existingId, existingTitle: r.existingTitle };
  }
  if (body || f.files.length) {
    try {
      const { message } = await appendMessage({ threadId: r.threadId, organizationId: v.organizationId, authorId: v.id, authorName: v.name, authorSide: v.side, body, files: f.files });
      await markRead(v, r.threadId);
      after(() => dispatchMessage(message.id).catch(() => {}));
    } catch (e) {
      await removeStoredFiles(f.files.map((x) => x.storagePath));
      revalidatePath("/chat");
      return { ok: true, threadId: r.threadId, error: e instanceof Error ? e.message : "Чат создан, но сообщение не отправилось" };
    }
  } else await markRead(v, r.threadId);
  revalidatePath("/chat");
  return { ok: true, threadId: r.threadId };
}

/** Закрыть чат или открыть заново. */
export async function setThreadClosed(threadId: string, closed: boolean): Promise<ChatState> {
  const { setClosed } = await import("@/lib/chat");
  const v = await chatSession();
  const r = await setClosed(v, clip(threadId, 64), closed);
  revalidatePath("/chat");
  return r.error ? { error: r.error } : { ok: true, threadId };
}

/** Сменить название и/или тему чата. */
export async function updateThreadAction(threadId: string, subject: string, topic?: string): Promise<ChatState> {
  const { updateThreadMeta } = await import("@/lib/chat");
  const v = await chatSession();
  const r = await updateThreadMeta(v, clip(threadId, 64), { subject: clip(subject, 120), topic: topic ? clip(topic, 40) : undefined });
  revalidatePath("/chat");
  return r.error ? { error: r.error } : { ok: true, threadId };
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

/** Участники, которых можно позвать в группу этой темы. */
export async function eligibleUsersAction(topic: string) {
  const { eligibleFor } = await import("@/lib/chat");
  const v = await chatSession();
  return eligibleFor(v, clip(topic, 40));
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
