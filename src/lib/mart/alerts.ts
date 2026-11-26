import "server-only";

/**
 * Оповещение о сбое пересборки витрины (этап 7, наблюдаемость). Срабатывает, когда задача очереди исчерпала попытки (status = failed):
 *  • строка в логе с меткой [mart][alert] — её видно в логах Render и легко искать;
 *  • сообщение в Telegram, если заданы TELEGRAM_BOT_TOKEN и ALERT_TELEGRAM_CHAT_ID (чат владельца или группы); иначе только лог.
 * В приложении сбой показывается в «Что требует внимания» (control-counts) и на «Контроль → Данные».
 * Ошибка отправки не мешает очереди: оповещение — побочный канал.
 */
export async function alertMartFailed(orgId: string, error: string, attempts: number): Promise<void> {
  console.error(`[mart][alert] пересборка витрины не удалась после ${attempts} попыток (организация ${orgId}): ${error}`);
  const chatId = (process.env.ALERT_TELEGRAM_CHAT_ID ?? "").trim();
  if (!chatId) return;
  try {
    const { telegramToken, tgCall } = await import("@/lib/channels/telegram");
    if (!telegramToken()) return;
    const site = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const text = [
      "⚠️ МехУчёт: витрина данных не пересобралась",
      `Попыток: ${attempts}. Экраны показывают расчёт на лету (медленнее), цифры верные.`,
      `Ошибка: ${error.slice(0, 300)}`,
      site ? `Проверить: ${site}/data-check` : "Проверить: «Контроль → Данные»",
    ].join("\n");
    await tgCall("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, 10_000);
  } catch (e) {
    console.error("[mart][alert] оповещение в Telegram не отправлено:", e instanceof Error ? e.message : e);
  }
}
