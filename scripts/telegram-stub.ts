/**
 * Локальная заглушка Telegram Bot API для проверки моста без настоящего бота.
 *   npx tsx scripts/telegram-stub.ts [порт]   (по умолчанию 3299)
 * Бот видит её через TELEGRAM_API_BASE=http://127.0.0.1:3299 и любой непустой TELEGRAM_BOT_TOKEN.
 * Методы: getMe, getUpdates, sendMessage, sendDocument, sendPhoto, getFile, GET /file/bot<токен>/<путь>.
 * Управление проверкой: POST /_inject (входящее «от человека»), GET /_sent (что бот отправил), POST /_reset.
 */
import http from "node:http";

const port = Number(process.argv[2] || process.env.STUB_PORT || 3299);
type Upd = { update_id: number; message: Record<string, unknown> };
let queue: Upd[] = [];
let updateId = 1000;
let msgId = 5000;
const sent: { method: string; chat_id: string; text?: string; file?: string; message_id: number }[] = [];
const files = new Map<string, { buf: Buffer; mime: string }>();

const json = (res: http.ServerResponse, body: unknown, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req: http.IncomingMessage) => new Promise<Buffer>((ok) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const raw = await readBody(req);
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  try {
    if (m) {
      const method = m[2];
      const ctype = req.headers["content-type"] ?? "";
      let params: Record<string, unknown> = {};
      let form: FormData | null = null;
      if (ctype.includes("application/json")) params = raw.length ? JSON.parse(raw.toString()) : {};
      else if (ctype.includes("multipart/form-data")) form = await new Request("http://x", { method: "POST", headers: { "content-type": ctype }, body: new Uint8Array(raw) }).formData();
      if (method === "getMe") return json(res, { ok: true, result: { id: 777, is_bot: true, first_name: "Заглушка", username: "fur_erp_stub_bot" } });
      if (method === "getUpdates") {
        const offset = Number(params.offset ?? 0);
        queue = queue.filter((u) => u.update_id >= offset);
        const wait = Math.min(Number(params.timeout ?? 0), 3) * 1000;
        const t0 = Date.now();
        while (!queue.length && Date.now() - t0 < wait) await new Promise((r) => setTimeout(r, 150));
        return json(res, { ok: true, result: queue.slice(0, 50) });
      }
      if (method === "sendMessage") {
        const id = ++msgId;
        sent.push({ method, chat_id: String(params.chat_id), text: String(params.text ?? ""), message_id: id });
        return json(res, { ok: true, result: { message_id: id, chat: { id: params.chat_id }, text: params.text } });
      }
      if (method === "sendDocument" || method === "sendPhoto") {
        const id = ++msgId;
        const f = form?.get(method === "sendDocument" ? "document" : "photo");
        sent.push({ method, chat_id: String(form?.get("chat_id")), file: f instanceof File ? `${f.name}:${f.size}` : "", message_id: id });
        return json(res, { ok: true, result: { message_id: id } });
      }
      if (method === "getFile") {
        const id = String(params.file_id);
        return files.has(id) ? json(res, { ok: true, result: { file_id: id, file_path: `files/${id}` } }) : json(res, { ok: false, description: "file not found" }, 400);
      }
      return json(res, { ok: false, description: "unknown method " + method }, 404);
    }
    const f = /^\/file\/bot[^/]+\/files\/(.+)$/.exec(url.pathname);
    if (f) {
      const file = files.get(f[1]);
      if (!file) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": file.mime }); return res.end(file.buf);
    }
    if (url.pathname === "/_inject" && req.method === "POST") {
      // { chat:{id,type}, from:{id,first_name,username}, text?, reply_to_message_id?, file?:{kind:"photo"|"document",name,mime,base64}, update_id? }
      const b = JSON.parse(raw.toString());
      const message: Record<string, unknown> = { message_id: b.message_id ?? ++msgId, chat: b.chat, from: b.from, date: Math.floor(Date.now() / 1000) };
      if (b.text) message[b.file ? "caption" : "text"] = b.text;
      if (b.reply_to_message_id) message.reply_to_message = { message_id: b.reply_to_message_id };
      if (b.file) {
        const fid = `f${++msgId}`;
        files.set(fid, { buf: Buffer.from(b.file.base64, "base64"), mime: b.file.mime });
        if (b.file.kind === "photo") message.photo = [{ file_id: fid + "s", width: 90 }, { file_id: fid, width: 800 }];
        else message.document = { file_id: fid, file_name: b.file.name, mime_type: b.file.mime };
        if (b.file.kind === "photo") files.set(fid + "s", files.get(fid)!);
      }
      const u = { update_id: b.update_id ?? ++updateId, message };
      queue.push(u);
      return json(res, { ok: true, update: u });
    }
    if (url.pathname === "/_sent") return json(res, sent);
    if (url.pathname === "/_reset") { queue = []; sent.length = 0; return json(res, { ok: true }); }
    json(res, { ok: false }, 404);
  } catch (e) {
    json(res, { ok: false, description: String(e) }, 500);
  }
}).listen(port, "127.0.0.1", () => console.log(`Заглушка Telegram API: http://127.0.0.1:${port}`));
