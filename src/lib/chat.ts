import "server-only";
import { prisma } from "@/lib/prisma";
import type { ChatSide, ChatSource, ChatStatus, Prisma } from "@prisma/client";
import {
  CHAT_INTERNAL_ROLES, SUPPLIER_ENTITY_TYPES, createTopicsFor, eligibleForTopic, canManageGroup, canCreateGroup, awaitsMyAnswer, entityHrefFor, isUnread, nextStatus, safeEntityLabel, sideOfRole,
  type Side, isReaction, groupReactions, type ReactionGroup,
} from "@/lib/chat-core";
import type { StoredDoc } from "@/lib/purchase-files";

/** Кто работает с чатом: роль и привязка к поставщику берутся из свежей сессии (session.ts). */
export type ChatViewer = { id: string; name: string; role: string; organizationId: string; supplierId: string | null; side: Side };

type SessionLike = { user: { id?: string; name?: string | null; role: string; organizationId: string; supplierId?: string | null } };

export function viewerOf(s: SessionLike): ChatViewer {
  return {
    id: s.user.id ?? "", name: s.user.name ?? "", role: s.user.role, organizationId: s.user.organizationId,
    supplierId: s.user.supplierId ?? null, side: sideOfRole(s.user.role),
  };
}

export const canUseChat = (role: string) => role === "SUPPLIER" || (CHAT_INTERNAL_ROLES as readonly string[]).includes(role);

/** Условие выборки обсуждений: организация; поставщик — только свой supplierId. */
export const threadWhere = (v: ChatViewer): Prisma.ChatThreadWhereInput => ({
  organizationId: v.organizationId,
  // Обсуждения с поставщиком — по supplierId; группы — только тем, кто в них состоит.
  OR: [
    { kind: { not: "GROUP" }, ...(v.side === "SUPPLIER" ? { supplierId: v.supplierId ?? "-" } : {}) },
    { kind: "GROUP", members: { some: { userId: v.id } } },
  ],
});

export async function loadThread(v: ChatViewer, id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return prisma.chatThread.findFirst({ where: { id, ...threadWhere(v) } });
}

/** Поставщик по умолчанию для обсуждений «от нас»: тот, у кого есть кабинет (пользователь с ролью SUPPLIER). */
export async function defaultSupplierId(orgId: string): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { organizationId: orgId, role: "SUPPLIER", isActive: true, supplierId: { not: null } }, select: { supplierId: true }, orderBy: { createdAt: "asc" } });
  return u?.supplierId ?? null;
}

export async function supplierName(orgId: string, supplierId: string | null): Promise<string> {
  if (!supplierId) return "Внутренний чат";
  const s = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: orgId }, select: { name: true } });
  return s?.name ?? "Поставщик";
}

// ───────── Записи, по которым можно писать ─────────

export type EntityRef = { type: string; id: string; label: string; supplierId: string | null };

/**
 * Проверяет доступ к записи и даёт безопасную подпись. Внутренние видят всё в организации;
 * поставщик — только свои закупки, отгрузки, входящие, записи календаря и артикулы (без цен).
 */
export async function resolveEntity(v: ChatViewer, type: string, id: string): Promise<EntityRef | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const org = v.organizationId;
  const sup = v.side === "SUPPLIER";
  if (sup && !(SUPPLIER_ENTITY_TYPES as readonly string[]).includes(type)) return null;
  const mineSup = sup ? (v.supplierId ?? "-") : undefined;
  switch (type) {
    case "ProductionOrder": {
      const r = await prisma.productionOrder.findFirst({ where: { id, organizationId: org }, select: { number: true, workOrderNumber: true } });
      // Рабочий номер из документа Веллмеха («ТЗ 182»), а не только наш внутренний «П-2026-…».
      return r && { type, id, label: safeEntityLabel(type, { number: r.workOrderNumber?.trim() || r.number }), supplierId: null };
    }
    case "ProductModel": {
      const r = await prisma.productModel.findFirst({ where: { id, organizationId: org }, select: { name: true } });
      return r && { type, id, label: safeEntityLabel(type, { name: r.name }), supplierId: null };
    }
    case "Purchase": {
      const r = await prisma.purchase.findFirst({ where: { id, organizationId: org, ...(sup ? { supplierId: mineSup } : {}) }, select: { number: true, auctionSession: true, supplierId: true } });
      return r && { type, id, label: safeEntityLabel(type, r), supplierId: r.supplierId };
    }
    case "Payment": {
      const r = await prisma.payment.findFirst({ where: { id, organizationId: org }, select: { paidAt: true, supplierId: true, purchase: { select: { number: true } } } });
      return r && { type, id, label: safeEntityLabel(type, { date: r.paidAt, purchaseNumber: r.purchase?.number }), supplierId: r.supplierId };
    }
    case "Shipment": {
      const r = await prisma.shipment.findFirst({ where: { id, organizationId: org, ...(sup ? { supplierId: mineSup } : {}) }, select: { name: true, plannedDate: true, supplierId: true } });
      return r && { type, id, label: safeEntityLabel(type, { name: r.name, date: r.plannedDate }), supplierId: r.supplierId };
    }
    case "CalendarEvent": {
      const r = await prisma.calendarEvent.findFirst({ where: { id, organizationId: org, ...(sup ? { supplierId: mineSup } : {}) }, select: { articleCode: true, date: true, supplierId: true } });
      return r && { type, id, label: safeEntityLabel(type, r), supplierId: r.supplierId };
    }
    case "SupplierInbox": {
      const r = await prisma.supplierInbox.findFirst({ where: { id, organizationId: org, ...(sup ? { supplierId: mineSup } : {}) }, select: { title: true, kind: true, supplierId: true } });
      return r && { type, id, label: safeEntityLabel(type, { title: (r.kind === "TZ" ? "ТЗ поставщика " : "Расчёт аукциона ") + r.title }), supplierId: r.supplierId };
    }
    case "RawMaterialLot": {
      const r = await prisma.rawMaterialLot.findFirst({ where: { id, organizationId: org }, select: { lotNumber: true } });
      return r && { type, id, label: safeEntityLabel(type, { lotNumber: r.lotNumber }), supplierId: null };
    }
    default:
      return null;
  }
}

/** Поиск записей для «Нового запроса»: по номеру ТЗ / артикулу / аукциону / отгрузке и т. д. Для поставщика — только его. */
export async function searchEntities(v: ChatViewer, type: string, q: string): Promise<{ id: string; label: string }[]> {
  const org = v.organizationId;
  const sup = v.side === "SUPPLIER";
  if (sup && !(SUPPLIER_ENTITY_TYPES as readonly string[]).includes(type)) return [];
  const mineSup = sup ? (v.supplierId ?? "-") : undefined;
  const s = q.trim().slice(0, 60);
  const ci = (field: string) => ({ [field]: { contains: s, mode: "insensitive" as const } });
  const lab = (t: string, d: Parameters<typeof safeEntityLabel>[1]) => safeEntityLabel(t, d);
  switch (type) {
    case "ProductionOrder": {
      const rows = await prisma.productionOrder.findMany({ where: { organizationId: org, ...(s ? { OR: [ci("number"), ci("workOrderNumber")] } : {}) }, select: { id: true, number: true, workOrderNumber: true }, orderBy: { createdAt: "desc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, { number: r.workOrderNumber?.trim() || r.number }) }));
    }
    case "ProductModel": {
      const rows = await prisma.productModel.findMany({ where: { organizationId: org, isActive: true, ...(s ? ci("name") : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, { name: r.name }) }));
    }
    case "Purchase": {
      const rows = await prisma.purchase.findMany({
        where: { organizationId: org, ...(sup ? { supplierId: mineSup } : {}), ...(s ? { OR: [ci("number"), ci("auctionSession"), ci("invoiceNumber")] } : {}) },
        select: { id: true, number: true, auctionSession: true }, orderBy: { createdAt: "desc" }, take: 8,
      });
      return rows.map((r) => ({ id: r.id, label: lab(type, r) }));
    }
    case "Payment": {
      const rows = await prisma.payment.findMany({
        where: { organizationId: org, ...(s ? { OR: [{ purchase: ci("number") }, { purchase: ci("invoiceNumber") }, ci("notes")] } : {}) },
        select: { id: true, paidAt: true, purchase: { select: { number: true } } }, orderBy: { paidAt: "desc" }, take: 8,
      });
      return rows.map((r) => ({ id: r.id, label: lab(type, { date: r.paidAt, purchaseNumber: r.purchase?.number }) }));
    }
    case "Shipment": {
      const rows = await prisma.shipment.findMany({ where: { organizationId: org, ...(sup ? { supplierId: mineSup } : {}), ...(s ? ci("name") : {}) }, select: { id: true, name: true, plannedDate: true }, orderBy: { plannedDate: "desc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, { name: r.name, date: r.plannedDate }) }));
    }
    case "CalendarEvent": {
      const rows = await prisma.calendarEvent.findMany({ where: { organizationId: org, ...(sup ? { supplierId: mineSup } : { supplierId: { not: null } }), ...(s ? ci("articleCode") : {}) }, select: { id: true, articleCode: true, date: true }, orderBy: { date: "desc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, r) }));
    }
    case "SupplierInbox": {
      const rows = await prisma.supplierInbox.findMany({ where: { organizationId: org, ...(sup ? { supplierId: mineSup } : { status: { not: "DRAFT" } }), ...(s ? ci("title") : {}) }, select: { id: true, title: true, kind: true }, orderBy: { updatedAt: "desc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, { title: (r.kind === "TZ" ? "ТЗ поставщика " : "Расчёт аукциона ") + r.title }) }));
    }
    case "RawMaterialLot": {
      const rows = await prisma.rawMaterialLot.findMany({ where: { organizationId: org, ...(s ? ci("lotNumber") : {}) }, select: { id: true, lotNumber: true }, orderBy: { createdAt: "desc" }, take: 8 });
      return rows.map((r) => ({ id: r.id, label: lab(type, { lotNumber: r.lotNumber }) }));
    }
    default:
      return [];
  }
}

// ───────── Обсуждения и сообщения ─────────

export async function createThread(v: ChatViewer, i: {
  supplierId: string | null; kind: "GENERAL" | "REQUEST"; subject: string; requestType?: string | null; entity?: EntityRef | null;
}) {
  const now = new Date();
  return prisma.chatThread.create({
    data: {
      organizationId: v.organizationId, supplierId: i.supplierId, kind: i.kind, subject: i.subject.slice(0, 160),
      requestType: i.requestType ?? null,
      entityType: i.entity?.type ?? null, entityId: i.entity?.id ?? null, entityLabel: i.entity?.label ?? null,
      entityHref: i.entity ? entityHrefFor(i.entity.type, i.entity.id, "INTERNAL") : null,
      createdById: v.id, createdByName: v.name, createdBySide: v.side, lastMessageAt: now, lastMessageSide: v.side,
    },
  });
}

export type NewMessage = {
  threadId: string; organizationId: string; authorId: string | null; authorName: string; authorSide: ChatSide; body: string;
  source?: ChatSource; externalId?: string | null; replyToId?: string | null; files?: StoredDoc[];
};

/** Единая точка записи сообщения (платформа и мессенджеры): статус запроса, последнее сообщение, идемпотентность по externalId. */
export async function appendMessage(i: NewMessage): Promise<{ message: { id: string }; duplicate: boolean }> {
  const source = i.source ?? "PLATFORM";
  if (i.externalId) {
    const ex = await prisma.chatMessage.findUnique({ where: { source_externalId: { source, externalId: i.externalId } }, select: { id: true } });
    if (ex) return { message: ex, duplicate: true };
  }
  const t = await prisma.chatThread.findFirst({ where: { id: i.threadId, organizationId: i.organizationId } });
  if (!t) throw new Error("Обсуждение не найдено");
  const status: ChatStatus = nextStatus(t, i.authorSide);
  let message;
  try {
    message = await prisma.chatMessage.create({
      data: {
        threadId: t.id, organizationId: i.organizationId, authorId: i.authorId, authorName: i.authorName.slice(0, 120), authorSide: i.authorSide,
        body: i.body.slice(0, 4000), source, externalId: i.externalId ?? null, replyToId: i.replyToId ?? null,
        attachments: i.files?.length ? { create: i.files.map((f) => ({ storagePath: f.storagePath, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes })) } : undefined,
      },
      select: { id: true, createdAt: true },
    });
  } catch (e) {
    // Гонка двух одинаковых входящих: уникальный индекс (source, externalId) не даёт задвоить.
    if (i.externalId && (e as { code?: string }).code === "P2002") {
      const ex = await prisma.chatMessage.findUnique({ where: { source_externalId: { source, externalId: i.externalId } }, select: { id: true } });
      if (ex) return { message: ex, duplicate: true };
    }
    throw e;
  }
  await prisma.chatThread.update({
    where: { id: t.id },
    data: { lastMessageAt: message.createdAt, lastMessageSide: i.authorSide, status, ...(t.status === "CLOSED" ? { closedAt: null, closedById: null } : {}) },
  });
  return { message, duplicate: false };
}

export async function markRead(v: ChatViewer, threadId: string) {
  const now = new Date();
  await prisma.chatRead.upsert({ where: { threadId_userId: { threadId, userId: v.id } }, create: { threadId, userId: v.id, lastReadAt: now }, update: { lastReadAt: now } });
}

/** Счётчики для меню и страницы: непрочитанные обсуждения и запросы, ждущие ответа этой стороны. */
export async function chatCounts(v: ChatViewer): Promise<{ unread: number; awaiting: number }> {
  if (!canUseChat(v.role)) return { unread: 0, awaiting: 0 };
  const rows = await prisma.chatThread.findMany({
    where: { AND: [threadWhere(v), { status: { not: "CLOSED" } }, { OR: [{ kind: "GROUP" }, { lastMessageSide: { not: v.side } }] }] },
    select: { kind: true, status: true, lastMessageAt: true, lastMessageSide: true, reads: { where: { userId: v.id }, select: { lastReadAt: true } } },
    take: 500,
  });
  let unread = 0;
  let awaiting = 0;
  for (const t of rows) {
    if (isUnread(t, t.reads[0]?.lastReadAt, v.side)) unread++;
    if (t.kind === "GROUP") continue;
    if (awaitsMyAnswer(t, v.side)) awaiting++;
  }
  return { unread, awaiting };
}

/** Запросы поставщика без ответа более 2 дней (для «Контроля» у нас). */
export async function staleSupplierRequests(orgId: string, now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  return prisma.chatThread.count({ where: { organizationId: orgId, kind: "REQUEST", status: { not: "CLOSED" }, lastMessageSide: "SUPPLIER", lastMessageAt: { lt: limit } } });
}

// ───────── Группы ─────────

/** Люди, которых можно позвать в группу этой темы: активные пользователи организации с доступом к теме. */
export async function eligibleUsers(orgId: string, topic: string): Promise<{ id: string; name: string; role: string; isSupplier: boolean }[]> {
  const users = await prisma.user.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return users.filter((u) => eligibleForTopic(topic, u.role)).map((u) => ({ ...u, isSupplier: u.role === "SUPPLIER" }));
}

/**
 * Кого viewer может позвать в группу темы. Сотрудники — как раньше. Поставщик — только наших пользователей
 * с доступом к теме (не других поставщиков), и только в темах из createTopicsFor.
 */
export async function eligibleFor(v: ChatViewer, topic: string) {
  if (v.side !== "SUPPLIER") return eligibleUsers(v.organizationId, topic);
  if (!createTopicsFor("SUPPLIER").includes(topic)) return [];
  // Роли наших людей поставщику не отдаём — только имена.
  return (await eligibleUsers(v.organizationId, topic)).filter((u) => !u.isSupplier).map((u) => ({ ...u, role: "" }));
}

export async function createGroup(v: ChatViewer, i: { name: string; topic: string; memberIds: string[]; entity?: EntityRef | null }): Promise<{ error: string } | { threadId: string }> {
  if (!canCreateGroup(v.role)) return { error: "Создавать группы могут сотрудники" };
  const name = i.name.trim().slice(0, 120);
  if (!name) return { error: "Введите название группы" };
  if (!eligibleForTopic(i.topic, v.role) || !createTopicsFor(v.role).includes(i.topic)) return { error: "У вас нет доступа к этой теме" };
  if (v.side === "SUPPLIER" && !v.supplierId) return { error: "Кабинет не привязан к поставщику" };
  const ok = new Set((await eligibleFor(v, i.topic)).map((u) => u.id));
  const ids = [...new Set(i.memberIds)].filter((id) => ok.has(id) && id !== v.id);
  const now = new Date();
  const t = await prisma.chatThread.create({
    data: {
      organizationId: v.organizationId, supplierId: null, kind: "GROUP", subject: name, topic: i.topic,
      entityType: i.entity?.type ?? null, entityId: i.entity?.id ?? null, entityLabel: i.entity?.label ?? null,
      entityHref: i.entity ? entityHrefFor(i.entity.type, i.entity.id, "INTERNAL") : null,
      createdById: v.id, createdByName: v.name, createdBySide: v.side, lastMessageAt: now, lastMessageSide: v.side,
      members: { create: [{ userId: v.id, role: "OWNER", addedById: v.id }, ...ids.map((id) => ({ userId: id, role: "MEMBER" as const, addedById: v.id }))] },
    },
    select: { id: true },
  });
  return { threadId: t.id };
}

export async function groupMembers(threadId: string) {
  const ms = await prisma.chatMember.findMany({ where: { threadId }, orderBy: { addedAt: "asc" } });
  const users = await prisma.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true, role: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  return ms.map((m) => ({ userId: m.userId, role: m.role, name: by.get(m.userId)?.name ?? "—", userRole: by.get(m.userId)?.role ?? "", isSupplier: by.get(m.userId)?.role === "SUPPLIER" }));
}

export async function changeMember(v: ChatViewer, threadId: string, userId: string, op: "add" | "remove"): Promise<{ error?: string }> {
  const t = await loadThread(v, threadId);
  if (!t || t.kind !== "GROUP") return { error: "Группа не найдена" };
  const members = await prisma.chatMember.findMany({ where: { threadId }, select: { userId: true, role: true } });
  const self = userId === v.id;
  if (op === "remove" && self) { /* выйти может любой участник */ }
  else if (!canManageGroup({ id: v.id, role: v.role }, members)) return { error: "Менять состав может владелец группы" };
  if (op === "add") {
    const ok = (await eligibleFor(v, t.topic ?? "")).some((u) => u.id === userId);
    if (!ok) return { error: "У этого человека нет доступа к теме группы" };
    await prisma.chatMember.upsert({ where: { threadId_userId: { threadId, userId } }, create: { threadId, userId, addedById: v.id }, update: {} });
  } else {
    const target = members.find((m) => m.userId === userId);
    if (!target) return { error: "Его нет в группе" };
    if (target.role === "OWNER" && members.filter((m) => m.role === "OWNER").length === 1 && members.length > 1) return { error: "Сначала передайте группу другому владельцу или удалите остальных" };
    await prisma.chatMember.delete({ where: { threadId_userId: { threadId, userId } } });
  }
  return {};
}

// ───────── Реакции ─────────

/** Реакции по сообщениям. Если таблицы ещё нет (миграция не применена) — available:false, страница живёт без реакций. */
export async function loadReactions(v: ChatViewer, messageIds: string[]): Promise<{ available: boolean; byMessage: Map<string, ReactionGroup[]> }> {
  const byMessage = new Map<string, ReactionGroup[]>();
  if (messageIds.length === 0) return { available: true, byMessage };
  try {
    const rows = await prisma.chatMessageReaction.findMany({ where: { messageId: { in: messageIds } }, orderBy: { createdAt: "asc" }, select: { messageId: true, userId: true, emoji: true } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const grouped = new Map<string, { emoji: string; userId: string }[]>();
    for (const r of rows) (grouped.get(r.messageId) ?? grouped.set(r.messageId, []).get(r.messageId)!).push(r);
    for (const [id, list] of grouped) byMessage.set(id, groupReactions(list, v.id, (u) => name.get(u) ?? "—"));
    return { available: true, byMessage };
  } catch {
    return { available: false, byMessage };
  }
}

/** Поставить реакцию или снять, если уже стоит. Только участники обсуждения (поставщик — своего). */
export async function toggleReaction(v: ChatViewer, messageId: string, emoji: string): Promise<{ error?: string; on?: boolean }> {
  if (!isReaction(emoji)) return { error: "Такой реакции нет" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) return { error: "Сообщение не найдено" };
  const m = await prisma.chatMessage.findFirst({ where: { id: messageId, thread: threadWhere(v) }, select: { id: true } });
  if (!m) return { error: "Сообщение не найдено" };
  try {
    const key = { messageId_userId_emoji: { messageId, userId: v.id, emoji } };
    const ex = await prisma.chatMessageReaction.findUnique({ where: key, select: { id: true } });
    if (ex) { await prisma.chatMessageReaction.delete({ where: key }); return { on: false }; }
    await prisma.chatMessageReaction.create({ data: { messageId, userId: v.id, emoji } });
    return { on: true };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { on: true };
    return { error: "Реакции пока недоступны" };
  }
}
