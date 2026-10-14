/** Канал мессенджера: отправка и разбор входящих. Telegram — рабочий, WhatsApp — пустой адаптер. */
export type ChannelName = "TELEGRAM" | "WHATSAPP";

export type OutFile = { name: string; mime: string; buf: Buffer };
export type OutMessage = { text: string; files?: OutFile[] };
export type SendTarget = { externalChatId: string };

export type InFile = { fileId: string; name: string; mime?: string };
export type IncomingMessage = {
  updateId?: number;
  chatId: string;
  chatType: "private" | "group";
  messageId: string;
  text: string;
  fromName: string;
  fromUsername?: string;
  replyToMessageId?: string;
  files: InFile[];
};

export type ChannelStatus = { connected: boolean; detail: string; botName?: string };

export interface ChannelAdapter {
  readonly channel: ChannelName;
  status(): Promise<ChannelStatus>;
  /** Отправляет сообщение; возвращает id отправленного текстового сообщения во внешнем канале. */
  send(to: SendTarget, msg: OutMessage): Promise<{ externalMessageId: string }>;
  /** Разбор «сырого» входящего (update Telegram, webhook WhatsApp…) в общий вид; null — служебное, пропускаем. */
  parseIncoming(raw: unknown): IncomingMessage | null;
  /** Скачивает вложение входящего сообщения. */
  downloadFile(fileId: string): Promise<{ buf: Buffer; path: string } | null>;
}
