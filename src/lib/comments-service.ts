/**
 * Комментарии: операции над БД без привязки к Next (клиент БД и «кто делает» передаются параметрами) —
 * так их проверяет scripts/test-comments.ts на копии базы. Серверные действия и маршруты лишь берут сессию и вызывают это.
 * Журнал изменений (AuditLog) пишет расширение клиента: с `prisma` из src/lib/prisma.ts — автоматически.
 */
import type { PrismaClient } from "@prisma/client";
import { ACCESS, hasRole } from "@/lib/access";
import { labelFor } from "@/lib/audit-core";
import {
  COMMENT_KINDS,
  COMMENT_PRIORITIES,
  COMMENT_STATUSES,
  ENTITY_TITLES,
  MAX_NOTE,
  MAX_REPLY,
  MAX_TEXT,
  asContext,
  basePath,
  canDeleteOwn,
  canEditOwn,
  cleanAnchor,
  cleanText,
  normalizePagePath,
  parseEnum,
  rateAllow,
  sanitizeContext,
  type CKind,
  type CPriority,
  type CStatus,
  type CommentContext,
} from "@/lib/comments-core";

export type Db = PrismaClient;
export type CommentActor = { id: string; name: string; role: string; organizationId: string };
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const canManage = (role: string) => hasRole(role, ACCESS.comments);

const rate = new Map<string, number[]>();
/** Для проверок: сброс счётчика частоты. */
export const resetRateLimit = () => rate.clear();

// ───────────── кэш счётчиков (15 с) ─────────────
const TTL_MS = 15_000;
const counts = new Map<string, { at: number; value: Promise<PageCounts> }>();
const invalidate = (organizationId: string) => {
  for (const k of counts.keys()) if (k.startsWith(organizationId + "|")) counts.delete(k);
};

export type Count = { open: number; total: number };
export type PageCounts = { page: Count; blocks: Record<string, Count>; entity: Count | null; openTotal: number };

// ───────────── запись, к которой относится страница ─────────────

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Находит запись в своей организации и возвращает её id и подпись («Закупка З-2026-0014»); чужую или несуществующую — null. */
export async function resolveEntity(db: Db, organizationId: string, type: string, key: string): Promise<{ id: string; label: string } | null> {
  if (!(type in ENTITY_TITLES) || !key || key.length > 100) return null;
  const delegate = (db as unknown as Record<string, { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> }>)[lower(type)];
  if (!delegate) return null;
  let where: Record<string, unknown> = { id: key, organizationId };
  if (type === "ProductionBatch") {
    const n = Number(key);
    if (!Number.isInteger(n)) return null;
    where = { number: n, organizationId };
  }
  const row = await delegate.findFirst({ where });
  if (!row || typeof row.id !== "string") return null;
  const label = labelFor(type, row);
  return { id: row.id, label: label.slice(0, 200) };
}

// ───────────── создание ─────────────

export type CreateInput = {
  text: unknown;
  kind?: unknown;
  priority?: unknown;
  pagePath: unknown;
  pageTitle?: unknown;
  entityType?: unknown;
  entityKey?: unknown;
  anchor?: unknown;
  context?: unknown;
};

export async function createComment(db: Db, actor: CommentActor, input: CreateInput, server: Pick<CommentContext, "year" | "vat" | "commission4"> = {}): Promise<Result<{ id: string }>> {
  const text = cleanText(input.text, MAX_TEXT + 1);
  if (!text) return fail("Напишите текст комментария.");
  if (text.length > MAX_TEXT) return fail(`Комментарий длиннее ${MAX_TEXT} знаков — сократите.`);
  const pagePath = normalizePagePath(input.pagePath);
  if (!pagePath) return fail("Не удалось определить страницу.");
  if (!rateAllow(rate, actor.id)) return fail("Слишком много комментариев за минуту (не больше 30). Подождите немного.");

  let entity: { id: string; label: string } | null = null;
  let entityType: string | null = null;
  if (typeof input.entityType === "string" && input.entityType) {
    entity = await resolveEntity(db, actor.organizationId, input.entityType, cleanText(input.entityKey, 100));
    if (!entity) return fail("Запись не найдена или недоступна.");
    entityType = input.entityType;
  }
  const anchor = cleanAnchor(input.anchor);
  const ctx: CommentContext = {
    ...sanitizeContext(input.context),
    ...server,
    role: actor.role,
    capturedAt: new Date().toISOString(),
  };
  const row = await db.comment.create({
    data: {
      organizationId: actor.organizationId,
      authorId: actor.id,
      authorName: actor.name.slice(0, 120),
      authorRole: actor.role,
      text,
      kind: parseEnum<CKind>(input.kind, COMMENT_KINDS, "REMARK"),
      priority: parseEnum<CPriority>(input.priority, COMMENT_PRIORITIES, "NORMAL"),
      pagePath,
      pageTitle: cleanText(input.pageTitle, 200) || basePath(pagePath),
      entityType,
      entityId: entity?.id ?? null,
      entityLabel: entity?.label ?? null,
      anchor,
      context: ctx as object,
    },
    select: { id: true },
  });
  invalidate(actor.organizationId);
  return { ok: true, id: row.id };
}

// ───────────── правка, статус, удаление, ответы ─────────────

async function own(db: Db, actor: CommentActor, id: string) {
  if (typeof id !== "string" || !id) return null;
  return db.comment.findFirst({ where: { id, organizationId: actor.organizationId } });
}

/** Автор правит текст, тип и приоритет в течение 15 минут после создания; владелец и администратор — всегда. */
export async function updateComment(db: Db, actor: CommentActor, id: string, patch: { text?: unknown; kind?: unknown; priority?: unknown }): Promise<Result> {
  const c = await own(db, actor, id);
  if (!c) return fail("Комментарий не найден.");
  if (!canManage(actor.role) && !canEditOwn(c, actor)) return fail("Править свой комментарий можно только в течение 15 минут после создания.");
  const text = cleanText(patch.text, MAX_TEXT + 1);
  if (!text) return fail("Напишите текст комментария.");
  if (text.length > MAX_TEXT) return fail(`Комментарий длиннее ${MAX_TEXT} знаков — сократите.`);
  await db.comment.update({
    where: { id },
    data: { text, kind: parseEnum<CKind>(patch.kind, COMMENT_KINDS, c.kind), priority: parseEnum<CPriority>(patch.priority, COMMENT_PRIORITIES, c.priority) },
  });
  invalidate(actor.organizationId);
  return { ok: true };
}

/** Статус меняют владелец и администратор (ACCESS.comments). «Учтено» просит пометку «как учтено» (необязательно, но желательно). */
export async function setStatus(db: Db, actor: CommentActor, ids: string[], status: unknown, note?: unknown): Promise<Result<{ changed: number }>> {
  if (!canManage(actor.role)) return fail("Менять статус комментариев могут владелец и администратор.");
  if (typeof status !== "string" || !(COMMENT_STATUSES as readonly string[]).includes(status)) return fail("Неизвестный статус.");
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x))).slice(0, 200);
  if (list.length === 0) return fail("Не выбрано ни одного комментария.");
  const s = status as CStatus;
  const resolutionNote = cleanText(note, MAX_NOTE) || null;
  const r = await db.comment.updateMany({
    where: { id: { in: list }, organizationId: actor.organizationId },
    data: s === "OPEN" ? { status: s, resolvedAt: null, resolvedById: null, resolutionNote: null } : { status: s, resolvedAt: new Date(), resolvedById: actor.id, resolutionNote },
  });
  invalidate(actor.organizationId);
  return { ok: true, changed: r.count };
}

/** Удалять: автор — пока комментарий открыт; чужие — владелец и администратор. Ответы уходят каскадом. */
export async function deleteComment(db: Db, actor: CommentActor, id: string): Promise<Result> {
  const c = await own(db, actor, id);
  if (!c) return fail("Комментарий не найден.");
  if (!canManage(actor.role) && !canDeleteOwn(c, actor)) return fail("Удалить можно только свой комментарий, пока он открыт.");
  await db.comment.delete({ where: { id } });
  invalidate(actor.organizationId);
  return { ok: true };
}

export async function addReply(db: Db, actor: CommentActor, id: string, textRaw: unknown): Promise<Result<{ id: string }>> {
  const c = await own(db, actor, id);
  if (!c) return fail("Комментарий не найден.");
  const text = cleanText(textRaw, MAX_REPLY + 1);
  if (!text) return fail("Напишите ответ.");
  if (text.length > MAX_REPLY) return fail(`Ответ длиннее ${MAX_REPLY} знаков.`);
  if (!rateAllow(rate, actor.id)) return fail("Слишком много сообщений за минуту. Подождите немного.");
  const r = await db.commentReply.create({
    data: { organizationId: actor.organizationId, commentId: id, authorId: actor.id, authorName: actor.name.slice(0, 120), authorRole: actor.role, text },
    select: { id: true },
  });
  invalidate(actor.organizationId);
  return { ok: true, id: r.id };
}

// ───────────── чтение для страницы ─────────────

const pathCond = (base: string) => [{ pagePath: base }, { pagePath: { startsWith: base + "?" } }];

/** Лёгкие счётчики страницы: по блокам, по странице и по записи. Кэш 15 с на организацию+страницу. */
export function pageCounts(db: Db, organizationId: string, path: string, entity?: { type: string; id: string } | null): Promise<PageCounts> {
  const base = basePath(path);
  const key = `${organizationId}|${base}|${entity ? entity.type + ":" + entity.id : ""}`;
  const hit = counts.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const [groups, ent, openTotal] = await Promise.all([
      db.comment.groupBy({ by: ["anchor", "status"], where: { organizationId, OR: pathCond(base) }, _count: { _all: true } }),
      entity
        ? db.comment.groupBy({ by: ["status"], where: { organizationId, entityType: entity.type, entityId: entity.id }, _count: { _all: true } })
        : Promise.resolve([] as Array<{ status: string; _count: { _all: number } }>),
      db.comment.count({ where: { organizationId, status: "OPEN" } }),
    ]);
    const blocks: Record<string, Count> = {};
    const page: Count = { open: 0, total: 0 };
    for (const g of groups) {
      const n = g._count._all;
      page.total += n;
      if (g.status === "OPEN") page.open += n;
      if (g.anchor) {
        const b = (blocks[g.anchor] ??= { open: 0, total: 0 });
        b.total += n;
        if (g.status === "OPEN") b.open += n;
      }
    }
    let entityCount: Count | null = null;
    if (entity) {
      entityCount = { open: 0, total: 0 };
      for (const g of ent) {
        entityCount.total += g._count._all;
        if (g.status === "OPEN") entityCount.open += g._count._all;
      }
    }
    return { page, blocks, entity: entityCount, openTotal };
  })();
  counts.set(key, { at: Date.now(), value });
  value.catch(() => counts.delete(key));
  return value;
}

export type CommentDto = {
  id: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  text: string;
  status: CStatus;
  kind: CKind;
  priority: CPriority;
  anchor: string | null;
  anchorLabel: string | null;
  quote: string | null;
  entityLabel: string | null;
  pagePath: string;
  resolutionNote: string | null;
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManage: boolean;
  replies: Array<{ id: string; authorName: string; authorRole: string; createdAt: string; text: string }>;
};

/** Ветки комментариев страницы (все или одного блока / записи). До 100 штук, новые сверху. */
export async function pageThread(
  db: Db,
  actor: CommentActor,
  path: string,
  filter: { anchor?: string | null; entity?: { type: string; id: string } | null } = {},
): Promise<CommentDto[]> {
  const base = basePath(path);
  const where = filter.entity
    ? { organizationId: actor.organizationId, entityType: filter.entity.type, entityId: filter.entity.id }
    : { organizationId: actor.organizationId, OR: pathCond(base), ...(filter.anchor ? { anchor: filter.anchor } : {}) };
  const rows = await db.comment.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { replies: { orderBy: { createdAt: "asc" }, take: 50 } } });
  return rows.map((c) => toDto(c, actor));
}

type RowWithReplies = Awaited<ReturnType<Db["comment"]["findMany"]>>[number] & { replies: Array<{ id: string; authorName: string; authorRole: string; createdAt: Date; text: string }> };

/** Строка БД → то, что уходит в браузер, с правами текущего пользователя. */
export function toDto(c: RowWithReplies, actor: CommentActor, now = Date.now()): CommentDto & { pageTitle: string; context: CommentContext } {
  const mgr = canManage(actor.role);
  const ctx = asContext(c.context);
  return {
    id: c.id,
    authorName: c.authorName,
    authorRole: c.authorRole,
    createdAt: c.createdAt.toISOString(),
    text: c.text,
    status: c.status,
    kind: c.kind,
    priority: c.priority,
    anchor: c.anchor,
    anchorLabel: ctx.anchorLabel ?? null,
    quote: ctx.quote ?? null,
    entityLabel: c.entityLabel,
    pagePath: c.pagePath,
    pageTitle: c.pageTitle,
    context: ctx,
    resolutionNote: c.resolutionNote,
    mine: c.authorId === actor.id,
    canEdit: mgr || canEditOwn(c, actor, now),
    canDelete: mgr || canDeleteOwn(c, actor),
    canManage: mgr,
    replies: c.replies.map((r) => ({ id: r.id, authorName: r.authorName, authorRole: r.authorRole, createdAt: r.createdAt.toISOString(), text: r.text })),
  };
}
