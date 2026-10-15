// Запуск демо-стенда в одном контейнере: приложение (внутри, 127.0.0.1) + общий замок Basic Auth на $PORT.
// Без GATE_USER и GATE_PASS контейнер НЕ стартует. Снаружи доступен только замок; приложение наружу не торчит.
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";

const log = (m) => console.log(`[демо] ${m}`);
const die = (m) => { console.error(`[демо] ОШИБКА: ${m}`); process.exit(1); };

const PORT = Number(process.env.PORT || 10000);
const UP = Number(process.env.UPSTREAM_PORT || 3001);
const USER = process.env.GATE_USER || "";
const PASS = process.env.GATE_PASS || "";

if (!USER || !PASS) die("не заданы GATE_USER и GATE_PASS (логин и пароль общего замка). Задайте их в переменных окружения.");
if (PASS.length < 12) die("GATE_PASS короче 12 знаков: придумайте длиннее.");
if (USER.includes(":")) die("GATE_USER не должен содержать двоеточие.");
if (!process.env.DATABASE_URL) die("не задан DATABASE_URL.");
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) die("AUTH_SECRET не задан или короче 32 знаков (openssl rand -base64 32).");
if (process.env.DEMO_ALLOW_LOCAL_DB !== "true" && /localhost|127\.0\.0\.1|host\.docker\.internal/.test(process.env.DATABASE_URL)) die("DATABASE_URL указывает на локальный адрес: для стенда нужна облачная демо-база.");

if (process.env.DEMO_SKIP_MARKER !== "true" && !existsSync(".demo-build")) die("образ собран без DEMO_BUILD=true (нет метки .demo-build): в нём могут быть реальные справочные данные. Задайте DEMO_BUILD=true в переменных сервиса и пересоберите.");

// Безопасные значения по умолчанию (можно переопределить переменными, но по умолчанию всё опасное выключено)
const appEnv = {
  ...process.env,
  NODE_ENV: "production",
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || "true",
  ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION || "false",
  ALLOW_DEMO_LOGIN: process.env.ALLOW_DEMO_LOGIN || "false",
  ALLOW_ROLE_SWITCH: process.env.ALLOW_ROLE_SWITCH || "false",
  UPLOAD_DIR: process.env.UPLOAD_DIR || "/tmp/uploads",
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  PORT: String(UP),
  HOSTNAME: "127.0.0.1",
};
delete appEnv.GATE_USER; delete appEnv.GATE_PASS; // замок не нужен приложению
for (const k of ["ALLOW_REGISTRATION", "ALLOW_DEMO_LOGIN", "ALLOW_ROLE_SWITCH"]) {
  if (appEnv[k] !== "false") log(`ВНИМАНИЕ: ${k}=${appEnv[k]} (для внешних тестировщиков должно быть false)`);
}

try { mkdirSync(appEnv.UPLOAD_DIR, { recursive: true }); } catch { log(`не удалось создать ${appEnv.UPLOAD_DIR}`); }

// Первичная загрузка вшитого обезличенного демо-дампа: только если в базе ещё нет таблицы "User". Повторный старт ничего не трогает.
const DUMP = process.env.DEMO_DUMP || "deploy/demo/demo.sql.gz";
if (process.env.DEMO_RESTORE !== "false" && existsSync(DUMP)) {
  const pgUrl = (() => { try { const u = new URL(process.env.DATABASE_URL); u.searchParams.delete("schema"); return u.toString(); } catch { return process.env.DATABASE_URL; } })();
  const psql = (args, input) => spawnSync("psql", [pgUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { input, encoding: "utf8", timeout: 600_000, env: process.env });
  const cleanErr = (r) => ((r.stderr || "") + (r.stdout || "")).replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***").trim().split("\n").slice(-5).join("\n   ");
  // база может проснуться не сразу: до 6 попыток
  let chk = null;
  for (let i = 0; i < 6; i++) { chk = psql(["-tAc", `select to_regclass('public."User"') is not null`]); if (chk.status === 0) break; log(`база пока недоступна (попытка ${i + 1}/6)`); await new Promise((r) => setTimeout(r, 5000)); }
  if (chk.status !== 0) log(`не удалось проверить базу:\n   ${cleanErr(chk)}`);
  else if (chk.stdout.trim() === "t") log("база уже заполнена, дамп не загружается.");
  else {
    log("база пустая: загружаю демо-дамп (это один раз, 10-60 секунд)…");
    const r = spawnSync("sh", ["-c", `gzip -dc "$DUMP" | grep -vE '^\\\\(un)?restrict ' | psql "$PGURL" -X -q --single-transaction -v ON_ERROR_STOP=1 -o /dev/null`], { env: { ...process.env, DUMP, PGURL: pgUrl }, encoding: "utf8", timeout: 600_000 });
    if (r.status !== 0) die(`демо-дамп не загрузился (откат выполнен):\n   ${cleanErr(r)}`);
    const c = psql(["-tAc", `select (select count(*) from "User") || ' пользователей, ' || (select count(*) from "Purchase") || ' закупок'`]);
    log(`дамп загружен: ${c.stdout.trim()}`);
  }
}

// Миграции: идемпотентно. В демо-дамп таблицы уже входят; если схема приложения новее дампа — доедут недостающие.
if (process.env.DEMO_MIGRATE !== "false") {
  log("проверка схемы базы (prisma migrate deploy)…");
  const r = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: appEnv, encoding: "utf8", timeout: 180_000 });
  const tail = ((r.stdout || "") + (r.stderr || "")).split("\n").filter((l) => l.trim()).slice(-6).join("\n   ");
  const safe = tail.replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***");
  if (r.status === 0) log(`схема актуальна.\n   ${safe}`);
  else log(`миграции не применились (код ${r.status}); приложение всё равно запускается.\n   ${safe}\n   Подсказка: для Neon нужен адрес БЕЗ «-pooler» (прямое подключение).`);
}

// Приложение внутри контейнера
log(`запуск приложения на 127.0.0.1:${UP}`);
const app = spawn(process.execPath, ["server.js"], { env: appEnv, stdio: "inherit" });
app.on("exit", (code) => { console.error(`[демо] приложение остановилось (код ${code}); перезапуск контейнера`); process.exit(code || 1); });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { app.kill(s); setTimeout(() => process.exit(0), 3000).unref(); });

// ---------- ЗАМОК ----------
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const wantHash = sha(`${USER}:${PASS}`);
const WINDOW = 15 * 60_000, MAX_IP = 10, MAX_GLOBAL = 300;
const fails = new Map(); // ip -> {n, until}
let global = { n: 0, reset: Date.now() + WINDOW };

// Адрес клиента: Render и прочие прокси дописывают его в X-Forwarded-For (берём первый, при необходимости — GATE_IP_HEADER).
const ipOf = (req) => {
  const h = process.env.GATE_IP_HEADER;
  const v = String((h && req.headers[h.toLowerCase()]) || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?");
  return v.split(",")[0].trim();
};
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (v.until < t && t - (v.last || 0) > WINDOW) fails.delete(k); }, 60_000).unref();

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]);
const baseHeaders = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };

http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain", ...baseHeaders }); return res.end("ok"); }
  const ip = ipOf(req);
  const now = Date.now();
  if (global.reset < now) global = { n: 0, reset: now + WINDOW };
  const f = fails.get(ip);
  const h = req.headers.authorization || "";
  if ((f && f.until > now) || (h && global.n >= MAX_GLOBAL)) {
    res.writeHead(429, { "Retry-After": "900", "Content-Type": "text/plain; charset=utf-8", ...baseHeaders });
    return res.end("Слишком много попыток. Попробуйте позже.");
  }
  let ok = false;
  if (/^Basic /i.test(h)) {
    try { ok = crypto.timingSafeEqual(sha(Buffer.from(h.slice(6).trim(), "base64").toString("utf8")), wantHash); } catch { ok = false; }
  }
  if (!ok) {
    if (h) { // неверная попытка
      const n = (f?.n || 0) + 1;
      fails.set(ip, { n, last: now, until: n >= MAX_IP ? now + WINDOW : 0 });
      global.n++;
    }
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Demo", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8", ...baseHeaders });
    return res.end("Требуется логин и пароль");
  }
  fails.delete(ip);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== "authorization") headers[k] = v;
  headers["x-forwarded-for"] = ip;
  headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";
  headers["x-forwarded-proto"] = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const pub = `${headers["x-forwarded-proto"]}://${req.headers.host}`;

  const p = http.request({ host: "127.0.0.1", port: UP, method: req.method, path: req.url, headers }, (r) => {
    const hd = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) hd[k] = v;
    if (hd.location) hd.location = String(hd.location).replace(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/, pub);
    hd["x-robots-tag"] = baseHeaders["X-Robots-Tag"];
    res.writeHead(r.statusCode || 502, r.statusMessage, hd);
    r.pipe(res);
  });
  p.on("error", () => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", ...baseHeaders }); res.end("Приложение запускается или не отвечает. Обновите страницу через 30 секунд."); });
  res.on("close", () => p.destroy());
  req.pipe(p);
}).listen(PORT, "0.0.0.0", () => log(`замок слушает порт ${PORT} → приложение :${UP}; проверка живости: /healthz`));
