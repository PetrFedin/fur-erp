import "server-only";
import { prisma } from "@/lib/prisma";
import { appendMessage, createThread, defaultSupplierId, markRead, threadWhere } from "@/lib/chat";
import { REQUEST_TYPES, bindCodeValid, externalMsgId, parseCommand, routeIncoming, sideOfRole, type Side } from "@/lib/chat-core";
import { detectDocument } from "@/lib/doc-sniff";
import { MAX_DOC_BYTES, fixFileNameExt, truncateFileName, writeDocumentFiles, type StoredDoc } from "@/lib/purchase-files";
import type { ChannelAdapter, IncomingMessage } from "./types";
import { dispatchMessage } from "./dispatch";

const HELP =
  "Как пользоваться:\n• просто напишите сообщение — оно попадёт в последнее ваше обсуждение;\n• ответьте («reply») на сообщение бота — попадёт именно в его обсуждение;\n• /t НОМЕР текст — в обсуждение с этим номером (#N в заголовке);\n• /new тема — новый запрос.";

const appUrl = () => (process.env.NEXTAUTH_URL?.trim() || "http://localhost:3200").replace(/\/$/, "");

/**
 * Разбор одного входящего сообщения мессенджера: привязка по коду (/start, /bind), маршрутизация (reply, /t, /new, последний тред),
 * сохранение с вложениями, рассылка остальным каналам. Возвращает короткий итог для логов и проверки.
 */
export async function handleIncoming(adapter: ChannelAdapter, inc: IncomingMessage): Promise<string> {
  const channel = adapter.channel;
  const say = (text: string) => adapter.send({ externalChatId: inc.chatId }, { text }).catch(() => undefined);
  const cmd = parseCommand(inc.text);

  // 1) Привязка по одноразовому коду.
  if (cmd && (cmd.cmd === "start" || cmd.cmd === "bind")) {
    if (!cmd.arg) { await say("Привет! Чтобы привязать аккаунт, возьмите одноразовый код в платформе (Чат → Подключить Telegram) и напишите: /start КОД\n\n" + HELP); return "start без кода"; }
    const code = await prisma.channelBindCode.findUnique({ where: { code: cmd.arg.trim().toUpperCase() } });
    if (!code || !bindCodeValid(code)) { await say("Код не найден или просрочен. Создайте новый в платформе."); return "код недействителен"; }
    const wantGroup = cmd.cmd === "bind";
    if ((code.kind === "GROUP") !== wantGroup || (inc.chatType === "group") !== wantGroup) {
      await say(wantGroup ? "Команда /bind работает только в группе, с кодом группы." : "Личный код: напишите боту /start КОД в личном чате.");
      return "не тот тип кода или чата";
    }
    const data = { organizationId: code.organizationId, userId: code.userId, supplierId: code.supplierId, threadId: code.threadId, kind: code.kind, externalUsername: inc.fromUsername ?? null, verifiedAt: new Date() };
    await prisma.channelLink.upsert({ where: { channel_externalChatId: { channel, externalChatId: inc.chatId } }, create: { channel, externalChatId: inc.chatId, ...data }, update: data });
    await prisma.channelBindCode.update({ where: { code: code.code }, data: { usedAt: new Date() } });
    let who = "внутренний чат";
    if (code.threadId) who = "группа платформы «" + ((await prisma.chatThread.findUnique({ where: { id: code.threadId }, select: { subject: true } }))?.subject ?? "") + "»";
    else if (code.userId) who = (await prisma.user.findUnique({ where: { id: code.userId }, select: { name: true } }))?.name ?? "пользователь";
    else if (code.supplierId) who = "группа поставщика " + ((await prisma.supplier.findUnique({ where: { id: code.supplierId }, select: { name: true } }))?.name ?? "");
    await say(`Готово: привязано (${who}). Сообщения из платформы будут приходить сюда.\n\n` + HELP);
    return "привязка";
  }
  if (cmd?.cmd === "help") { await say(HELP); return "help"; }

  // 2) Кто пишет.
  const link = await prisma.channelLink.findUnique({ where: { channel_externalChatId: { channel, externalChatId: inc.chatId } } });
  if (!link) {
    if (inc.chatType === "private") await say("Аккаунт не привязан: привяжите его — получите код в платформе (Чат → Подключить Telegram) и напишите /start КОД");
    return "не привязан";
  }
  const user = link.userId ? await prisma.user.findFirst({ where: { id: link.userId, organizationId: link.organizationId, isActive: true }, select: { id: true, name: true, role: true, supplierId: true } }) : null;
  if (link.userId && !user) { await say("Пользователь деактивирован. Привяжите аккаунт заново."); return "пользователь отключён"; }
  const orgId = link.organizationId;
  let side: Side;
  let authorId: string | null;
  let authorName: string;
  let supplierScope: string | null; // поставщик стороны-автора; null — внутренний (видит все треды организации)
  if (user) {
    side = sideOfRole(user.role); authorId = user.id; authorName = user.name; supplierScope = side === "SUPPLIER" ? user.supplierId : null;
    if (side === "SUPPLIER" && !supplierScope) return "поставщик без привязки";
  } else if (link.supplierId) {
    side = "SUPPLIER"; authorId = null; authorName = `${inc.fromName} (Telegram)`; supplierScope = link.supplierId;
  } else {
    side = "INTERNAL"; authorId = null; authorName = `${inc.fromName} (Telegram)`; supplierScope = null;
  }
  const viewer = { id: authorId ?? "-", name: authorName, role: side === "SUPPLIER" ? "SUPPLIER" : "OWNER", organizationId: orgId, supplierId: supplierScope, side };
  const scopeWhere = threadWhere(viewer);

  // 3) Маршрут.
  let replyThreadId: string | null = null;
  if (inc.replyToMessageId) {
    const d = await prisma.channelDelivery.findUnique({ where: { channel_externalChatId_externalMessageId: { channel, externalChatId: inc.chatId, externalMessageId: inc.replyToMessageId } }, select: { threadId: true } });
    replyThreadId = d?.threadId ?? null;
  }
  const lastDelivery = await prisma.channelDelivery.findFirst({ where: { channel, externalChatId: inc.chatId }, orderBy: { createdAt: "desc" }, select: { threadId: true } });
  const lastOwn = authorId ? await prisma.chatMessage.findFirst({ where: { authorId, thread: scopeWhere }, orderBy: { createdAt: "desc" }, select: { threadId: true } }) : null;
  const lastInScope = supplierScope ? await prisma.chatThread.findFirst({ where: { AND: [scopeWhere], kind: { not: "GROUP" }, status: { not: "CLOSED" } }, orderBy: { lastMessageAt: "desc" }, select: { id: true } }) : null;
  let lastActive = lastDelivery?.threadId ?? lastOwn?.threadId ?? lastInScope?.id ?? null;
  const cmdThreadNo = cmd?.cmd === "t" && /^#?\d{1,9}$/.test(cmd.threadNo) ? Number(cmd.threadNo.replace("#", "")) : null;
  const byNo = cmdThreadNo ? await prisma.chatThread.findFirst({ where: { AND: [scopeWhere], number: cmdThreadNo }, select: { id: true } }) : null;
  // Тред из reply / последний активный должен быть виден этой стороне.
  const visible = async (id: string | null) => (id ? !!(await prisma.chatThread.findFirst({ where: { AND: [scopeWhere], id }, select: { id: true } })) : false);
  if (!(await visible(replyThreadId))) replyThreadId = null;
  if (!(await visible(lastActive))) lastActive = null;
  const fixedThread = link.threadId ? await prisma.chatThread.findFirst({ where: { id: link.threadId, organizationId: orgId, kind: "GROUP" }, select: { id: true } }) : null;
  const route = fixedThread && !(cmd?.cmd === "t" || cmd?.cmd === "new") ? ({ type: "post", threadId: fixedThread.id, text: inc.text, how: "last" } as const) : routeIncoming({ text: inc.text, linked: true, replyThreadId, lastActiveThreadId: lastActive, resolveThreadNo: () => byNo?.id ?? null });
  if (route.type === "notfound") { await say(`Обсуждение #${route.threadNo} не найдено или недоступно.`); return "тред не найден"; }
  if (route.type === "empty" && inc.files.length === 0) { await say("Напишите текст после команды.\n\n" + HELP); return "пусто"; }

  // 4) Вложения.
  const stored: StoredDoc[] = [];
  const notes: string[] = [];
  for (const f of inc.files) {
    const dl = await adapter.downloadFile(f.fileId).catch(() => null);
    if (!dl) { notes.push(`[файл «${f.name}» не удалось скачать]`); continue; }
    if (dl.buf.length > MAX_DOC_BYTES) { notes.push(`[файл «${f.name}» больше 25 МБ]`); continue; }
    const name = f.name.replace(/["\u0000-\u001f]/g, "'");
    const kind = detectDocument(dl.buf.subarray(0, 16), name, dl.buf);
    if (!kind) { notes.push(`[файл «${f.name}» не принят: допустимы PDF, XLSX, DOCX, JPEG, PNG]`); continue; }
    const w = await writeDocumentFiles(orgId, "chat", [{ buf: dl.buf, kind, originalName: truncateFileName(fixFileNameExt(name, kind.ext), 200) }]);
    stored.push(...w);
  }
  const bodyText = route.type === "post" ? route.text : route.type === "new" ? route.text : "";
  const body = [bodyText, ...notes].filter(Boolean).join("\n");

  // 5) Сохранение (идемпотентно по чат:сообщение).
  const externalId = externalMsgId(inc.chatId, inc.messageId);
  let threadId: string;
  if (route.type === "new" || route.type === "empty") {
    const supplierId = supplierScope ?? (await defaultSupplierId(orgId));
    if (!supplierId) { await say("Нет поставщика, с которым можно переписываться."); return "нет поставщика"; }
    const dup = await prisma.chatMessage.findUnique({ where: { source_externalId: { source: "TELEGRAM", externalId } }, select: { id: true } });
    if (dup) return "дубль";
    const subject = route.type === "new" ? route.subject : "Файл из Telegram";
    const t = await createThread({ id: authorId ?? "telegram", name: authorName, role: side === "SUPPLIER" ? "SUPPLIER" : "OWNER", organizationId: orgId, supplierId: supplierScope, side }, { supplierId, kind: "REQUEST", subject, requestType: REQUEST_TYPES[REQUEST_TYPES.length - 1], entity: null });
    threadId = t.id;
    await say(`Создан запрос #${t.number}: ${t.subject}\n${appUrl()}/chat?thread=${t.id}`);
  } else if (route.type === "post") threadId = route.threadId;
  else return "нет маршрута";
  const { message, duplicate } = await appendMessage({ threadId, organizationId: orgId, authorId, authorName, authorSide: side, body, source: "TELEGRAM", externalId, files: stored });
  if (duplicate) return "дубль";
  if (authorId) await markRead({ id: authorId, name: authorName, role: "", organizationId: orgId, supplierId: supplierScope, side }, threadId);
  await dispatchMessage(message.id).catch((e) => console.error("[telegram] рассылка:", e instanceof Error ? e.message : e));
  return `сохранено в обсуждение ${threadId} (${route.type === "post" ? route.how : "new"})`;
}
