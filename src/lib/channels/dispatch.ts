import "server-only";
import { prisma } from "@/lib/prisma";
import { formatForMessenger, pickRecipients, type LinkLite } from "@/lib/chat-core";
import { supplierName } from "@/lib/chat";
import { readStoredFile } from "@/lib/fitting-files";
import { telegramAdapter, telegramToken } from "./telegram";

const appUrl = () => process.env.NEXTAUTH_URL?.trim() || "http://localhost:3200";

/** Из «чат:сообщение» достаёт id чата, откуда пришло сообщение (чтобы не вернуть его обратно). */
export const originChatOf = (externalId: string | null) => (externalId && externalId.includes(":") ? externalId.slice(0, externalId.lastIndexOf(":")) : null);

/**
 * Рассылка сообщения в Telegram: получателей выбирает pickRecipients (кому адресовано, без петли),
 * каждая отправка пишется в ChannelDelivery — повторный вызов ничего не задвоит и позволяет отвечать «reply».
 * Нет токена — тихо выходим, сообщение остаётся только в платформе (dispatchedAt пустой).
 */
export async function dispatchMessage(messageId: string): Promise<{ sent: number; failed: number }> {
  if (!telegramToken()) return { sent: 0, failed: 0 };
  const m = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { thread: true, attachments: true, deliveries: true } });
  if (!m) return { sent: 0, failed: 0 };
  const links = await prisma.channelLink.findMany({ where: { organizationId: m.organizationId, channel: "TELEGRAM" } });
  const userIds = [...new Set(links.map((l) => l.userId).filter((x): x is string => !!x))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, role: true, supplierId: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const lite: LinkLite[] = links.map((l) => ({ id: l.id, channel: l.channel, externalChatId: l.externalChatId, userId: l.userId, supplierId: l.supplierId, kind: l.kind }));
  let to: LinkLite[];
  if (m.thread.kind === "GROUP") {
    // Группа платформы: привязанная Telegram-группа и личные чаты участников (кроме автора и источника).
    const memberIds = new Set((await prisma.chatMember.findMany({ where: { threadId: m.threadId }, select: { userId: true } })).map((x) => x.userId));
    const origin = m.source === "TELEGRAM" ? originChatOf(m.externalId) : null;
    to = lite.filter((l) => l.externalChatId !== origin && !(l.userId && l.userId === m.authorId) && (links.find((x) => x.id === l.id)?.threadId === m.threadId || (l.kind === "PRIVATE" && !!l.userId && memberIds.has(l.userId))));
  } else to = pickRecipients({
    threadSupplierId: m.thread.supplierId, authorSide: m.authorSide, authorId: m.authorId,
    originChatId: m.source === "TELEGRAM" ? originChatOf(m.externalId) : null, links: lite,
    roleOf: (u) => byId.get(u)?.role ?? null, supplierOfUser: (u) => byId.get(u)?.supplierId ?? null,
  });
  const done = new Set(m.deliveries.map((d) => `${d.channel}:${d.externalChatId}`));
  const text = formatForMessenger({
    supplierName: await supplierName(m.organizationId, m.thread.supplierId), entityLabel: m.thread.entityLabel, subject: m.thread.subject,
    authorName: m.authorName, body: m.body || (m.attachments.length ? "📎 файл" : ""), threadId: m.threadId, appUrl: appUrl(), threadNo: m.thread.number,
  });
  const files: { name: string; mime: string; buf: Buffer }[] = [];
  for (const a of m.attachments) {
    const buf = await readStoredFile(a.storagePath);
    if (buf) files.push({ name: a.originalName, mime: a.mimeType, buf });
  }
  let sent = 0;
  let failed = 0;
  for (const l of to) {
    if (done.has(`${l.channel}:${l.externalChatId}`)) continue;
    try {
      const r = await telegramAdapter.send({ externalChatId: l.externalChatId }, { text, files });
      await prisma.channelDelivery.create({ data: { messageId: m.id, threadId: m.threadId, channel: "TELEGRAM", externalChatId: l.externalChatId, externalMessageId: r.externalMessageId } }).catch(() => {});
      sent++;
    } catch (e) {
      failed++;
      console.error(`[telegram] не отправлено в чат ${l.externalChatId}:`, e instanceof Error ? e.message : e);
    }
  }
  if (failed === 0) await prisma.chatMessage.update({ where: { id: m.id }, data: { dispatchedAt: new Date() } });
  return { sent, failed };
}

/** Дорассылка сообщений, которые не ушли сразу (мост был выключен, сеть, ошибка): за последние сутки, старше 5 секунд. */
export async function sweepUndispatched(now = new Date()): Promise<number> {
  const rows = await prisma.chatMessage.findMany({
    where: { dispatchedAt: null, createdAt: { gt: new Date(now.getTime() - 24 * 3600_000), lt: new Date(now.getTime() - 5000) } },
    select: { id: true }, orderBy: { createdAt: "asc" }, take: 50,
  });
  let n = 0;
  for (const r of rows) n += (await dispatchMessage(r.id)).sent;
  return n;
}
