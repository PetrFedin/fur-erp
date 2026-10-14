import "server-only";

/** Рассылка сообщения в мессенджеры (этап B). Пока заглушка: сообщение остаётся только в платформе. */
export async function dispatchMessage(_messageId: string): Promise<void> {
  void _messageId;
}
