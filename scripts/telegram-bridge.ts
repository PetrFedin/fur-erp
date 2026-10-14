/**
 * Мост Telegram ⇄ чат платформы (long polling). Запуск: npm run telegram
 * Нужен TELEGRAM_BOT_TOKEN в .env (токен от @BotFather). Для проверки без токена — scripts/telegram-stub.ts и TELEGRAM_API_BASE.
 * Что уже получено, хранится в UPLOAD_DIR/telegram-offset.json — после перезапуска повторов нет.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TELEGRAM_NO_TOKEN, telegramAdapter, telegramToken, tgCall, type TgUpdate } from "../src/lib/channels/telegram";
import { handleIncoming } from "../src/lib/channels/incoming";
import { sweepUndispatched } from "../src/lib/channels/dispatch";

const OFFSET_FILE = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads", "telegram-offset.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadOffset(): Promise<number> {
  try { return Number(JSON.parse(await readFile(OFFSET_FILE, "utf8")).offset) || 0; } catch { return 0; }
}
async function saveOffset(offset: number) {
  await mkdir(path.dirname(OFFSET_FILE), { recursive: true });
  await writeFile(OFFSET_FILE, JSON.stringify({ offset }));
}

async function main() {
  if (!telegramToken()) {
    console.error(TELEGRAM_NO_TOKEN + "\nПодробнее: docs/DEPLOY.md, раздел «Telegram».");
    process.exit(1);
  }
  const st = await telegramAdapter.status();
  if (!st.connected) { console.error("Telegram не отвечает:", st.detail); process.exit(1); }
  console.log(`Мост Telegram запущен: бот ${st.botName ?? ""}`);
  let offset = await loadOffset();
  const once = process.argv.includes("--once");
  for (;;) {
    try {
      const updates = await tgCall<TgUpdate[]>("getUpdates", { offset, timeout: once ? 0 : 25, allowed_updates: ["message"] }, 40000);
      for (const u of updates) {
        const inc = telegramAdapter.parseIncoming(u);
        if (inc) {
          try { console.log(`[${u.update_id}] ${await handleIncoming(telegramAdapter, inc)}`); } catch (e) { console.error(`[${u.update_id}] ошибка:`, e instanceof Error ? e.message : e); }
        }
        offset = u.update_id + 1;
        await saveOffset(offset);
      }
      await sweepUndispatched();
    } catch (e) {
      console.error("Сбой опроса Telegram, повтор через 5 с:", e instanceof Error ? e.message : e);
      await sleep(5000);
    }
    if (once) break;
  }
  process.exit(0);
}
main();
