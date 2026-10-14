import type { ChannelAdapter } from "./types";

/**
 * WhatsApp: только расширяемый интерфейс и пустой адаптер. Реальное подключение требует аккаунта Meta Business
 * (WhatsApp Business Platform) и публичного HTTPS-адреса платформы для вебхука — подключим позже.
 */
export const WHATSAPP_NEEDS = "Нужны аккаунт Meta Business (WhatsApp Business Platform), номер телефона и публичный HTTPS-адрес платформы для вебхука.";

export const whatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",
  async status() {
    return { connected: false, detail: "Не подключено. " + WHATSAPP_NEEDS };
  },
  async send() {
    throw new Error("WhatsApp не подключён");
  },
  parseIncoming() {
    return null;
  },
  async downloadFile() {
    return null;
  },
};
