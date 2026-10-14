import { timingSafeEqual } from "node:crypto";
import { telegramAdapter } from "@/lib/channels/telegram";
import { handleIncoming } from "@/lib/channels/incoming";

/**
 * Вебхук Telegram для продакшена (вместо long polling): включается переменной TELEGRAM_WEBHOOK_SECRET.
 * Telegram присылает её в заголовке X-Telegram-Bot-Api-Secret-Token (задаётся при setWebhook).
 */
export async function POST(req: Request) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return new Response("Not found", { status: 404 });
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Forbidden", { status: 403 });
  const raw = await req.json().catch(() => null);
  const inc = telegramAdapter.parseIncoming(raw);
  if (inc) {
    try { await handleIncoming(telegramAdapter, inc); } catch (e) { console.error("[telegram webhook]", e instanceof Error ? e.message : e); }
  }
  return Response.json({ ok: true });
}
