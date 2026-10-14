import type { ChannelAdapter, IncomingMessage, InFile, OutMessage, SendTarget } from "./types";

/**
 * Telegram Bot API по HTTP (fetch). Токен — только из env TELEGRAM_BOT_TOKEN (в БД, логи и страницы не попадает),
 * адрес API — TELEGRAM_API_BASE (по умолчанию https://api.telegram.org; для проверки — локальная заглушка).
 */
export const telegramToken = () => (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
export const telegramBase = () => (process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/$/, "");
export const TELEGRAM_NO_TOKEN = "Telegram не подключён: добавьте токен бота (@BotFather) в .env";

type TgResp<T> = { ok: boolean; result?: T; description?: string };

/** Вызов метода Bot API. Ошибки не содержат токена и адреса с токеном. */
export async function tgCall<T>(method: string, params: Record<string, unknown> | FormData = {}, timeoutMs = 35000): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error(TELEGRAM_NO_TOKEN);
  const isForm = params instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${telegramBase()}/bot${token}/${method}`, {
      method: "POST",
      headers: isForm ? undefined : { "Content-Type": "application/json" },
      body: isForm ? params : JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`Telegram недоступен (${method}): ${e instanceof Error ? e.name : "ошибка сети"}`);
  }
  const data = (await res.json().catch(() => null)) as TgResp<T> | null;
  if (!data?.ok || data.result === undefined) throw new Error(`Telegram ${method}: ${data?.description ?? "HTTP " + res.status}`);
  return data.result;
}

type TgChat = { id: number | string; type: string };
type TgFrom = { id: number; first_name?: string; last_name?: string; username?: string };
type TgMessage = {
  message_id: number; chat: TgChat; from?: TgFrom; text?: string; caption?: string;
  reply_to_message?: { message_id: number };
  photo?: { file_id: string; width?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
};
export type TgUpdate = { update_id: number; message?: TgMessage };

export function parseTelegramUpdate(raw: unknown): IncomingMessage | null {
  const u = raw as TgUpdate | null;
  const m = u?.message;
  if (!u || !m || !m.chat) return null;
  const files: InFile[] = [];
  if (m.photo?.length) files.push({ fileId: m.photo[m.photo.length - 1].file_id, name: "photo.jpg", mime: "image/jpeg" });
  if (m.document) files.push({ fileId: m.document.file_id, name: m.document.file_name || "document", mime: m.document.mime_type });
  const text = (m.text ?? m.caption ?? "").trim();
  if (!text && files.length === 0) return null;
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "Telegram";
  return {
    updateId: u.update_id, chatId: String(m.chat.id), chatType: m.chat.type === "private" ? "private" : "group",
    messageId: String(m.message_id), text, fromName: name, fromUsername: m.from?.username,
    replyToMessageId: m.reply_to_message ? String(m.reply_to_message.message_id) : undefined, files,
  };
}

export const telegramAdapter: ChannelAdapter = {
  channel: "TELEGRAM",
  async status() {
    if (!telegramToken()) return { connected: false, detail: TELEGRAM_NO_TOKEN };
    try {
      const me = await tgCall<{ username?: string; first_name?: string }>("getMe", {}, 8000);
      return { connected: true, detail: "Токен принят", botName: me.username ? "@" + me.username : me.first_name };
    } catch (e) {
      return { connected: false, detail: e instanceof Error ? e.message : "Не удалось связаться с Telegram" };
    }
  },
  async send(to: SendTarget, msg: OutMessage) {
    const sent = await tgCall<{ message_id: number }>("sendMessage", { chat_id: to.externalChatId, text: msg.text.slice(0, 4000), link_preview_options: { is_disabled: true } });
    for (const f of msg.files ?? []) {
      const fd = new FormData();
      fd.set("chat_id", to.externalChatId);
      fd.set("document", new Blob([new Uint8Array(f.buf)], { type: f.mime }), f.name);
      await tgCall("sendDocument", fd, 60000);
    }
    return { externalMessageId: String(sent.message_id) };
  },
  parseIncoming: parseTelegramUpdate,
  async downloadFile(fileId: string) {
    const info = await tgCall<{ file_path?: string }>("getFile", { file_id: fileId }, 15000);
    if (!info.file_path) return null;
    const res = await fetch(`${telegramBase()}/file/bot${telegramToken()}/${info.file_path}`, { signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!res?.ok) return null;
    return { buf: Buffer.from(await res.arrayBuffer()), path: info.file_path };
  },
};
