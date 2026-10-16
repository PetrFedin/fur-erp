// Запуск демо-стенда в одном контейнере: приложение (внутри, 127.0.0.1) + общий замок Basic Auth на $PORT.
// Без GATE_USER и GATE_PASS контейнер НЕ стартует. Снаружи доступен только замок; приложение наружу не торчит.
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";

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

let appReady = false;

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

  // Стенд ещё просыпается (база, схема, запуск приложения): вместо ошибки показываем страницу, которая сама обновляется.
  if (!appReady) {
    res.writeHead(503, { "Retry-After": "10", "Content-Type": "text/html; charset=utf-8", ...baseHeaders });
    return res.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="8"><title>Стенд запускается</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#262626"><h1 style="font-size:1.25rem">Стенд просыпается</h1><p>Бесплатный сервер засыпает без запросов и запускается около минуты. Страница обновится сама, ничего нажимать не нужно.</p></body></html>');
  }

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
}).listen(PORT, "0.0.0.0", () => {
  log(`замок слушает порт ${PORT} → приложение :${UP}; проверка живости: /healthz`);
  boot().catch((e) => die(`запуск не удался: ${e instanceof Error ? e.message : e}`));
});

// ---------- Запуск по шагам (замок уже слушает порт, поэтому Render не показывает 503 всю минуту старта) ----------
/** Запуск команды без блокировки замка: { status, stdout, stderr }; по таймауту процесс убивается. */
const run = (cmd, args, { input, timeout = 600_000, env = process.env } = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => c.kill("SIGKILL"), timeout);
    c.on("error", (e) => { clearTimeout(t); resolve({ status: 1, stdout, stderr: stderr + String(e) }); });
    c.on("close", (code) => { clearTimeout(t); resolve({ status: code, stdout, stderr }); });
    c.stdin.on("error", () => {});
    c.stdin.end(input ?? "");
  });

async function boot() {
  // Первичная загрузка вшитого обезличенного демо-дампа: только если в базе ещё нет таблицы "User". Повторный старт ничего не трогает.
  const DUMP = process.env.DEMO_DUMP || "deploy/demo/demo.sql.gz";
  const pgUrl = (() => { try { const u = new URL(process.env.DATABASE_URL); u.searchParams.delete("schema"); return u.toString(); } catch { return process.env.DATABASE_URL; } })();
  const psql = (args) => run("psql", [pgUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { timeout: 600_000 });
  const cleanErr = (r) => ((r.stderr || "") + (r.stdout || "")).replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***").trim().split("\n").slice(-5).join("\n   ");
  let schemaCurrent = false;
  if (process.env.DEMO_RESTORE !== "false" && existsSync(DUMP)) {
    // база может проснуться не сразу: до 6 попыток
    let chk = null;
    for (let i = 0; i < 6; i++) { chk = await psql(["-tAc", `select to_regclass('public."User"') is not null`]); if (chk.status === 0) break; log(`база пока недоступна (попытка ${i + 1}/6)`); await new Promise((r) => setTimeout(r, 5000)); }
    if (chk.status !== 0) log(`не удалось проверить базу:\n   ${cleanErr(chk)}`);
    else if (chk.stdout.trim() === "t") {
      log("база уже заполнена, дамп не загружается.");
      // Все миграции уже применены? Тогда долгий `prisma migrate deploy` (на 0,1 ЦП это десятки секунд) не нужен.
      try {
        const dirs = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).length;
        const done = await psql(["-tAc", `select count(*) from "_prisma_migrations" where finished_at is not null and rolled_back_at is null`]);
        if (done.status === 0 && Number(done.stdout.trim()) === dirs && dirs > 0) { schemaCurrent = true; log(`схема актуальна: применено миграций ${dirs} из ${dirs}, проверка пропущена.`); }
      } catch { /* не вышло сравнить — запустим migrate deploy как раньше */ }
    } else {
      log("база пустая: загружаю демо-дамп (это один раз, 10-60 секунд)…");
      const r = await run("sh", ["-c", `gzip -dc "$DUMP" | grep -vE '^\\\\(un)?restrict ' | psql "$PGURL" -X -q --single-transaction -v ON_ERROR_STOP=1 -o /dev/null`], { env: { ...process.env, DUMP, PGURL: pgUrl } });
      if (r.status !== 0) die(`демо-дамп не загрузился (откат выполнен):\n   ${cleanErr(r)}`);
      const c = await psql(["-tAc", `select (select count(*) from "User") || ' пользователей, ' || (select count(*) from "Purchase") || ' закупок'`]);
      log(`дамп загружен: ${c.stdout.trim()}`);
    }
  }

  // Миграции: идемпотентно. В демо-дамп таблицы уже входят; если схема приложения новее дампа — доедут недостающие.
  if (process.env.DEMO_MIGRATE !== "false" && !schemaCurrent) {
    log("проверка схемы базы (prisma migrate deploy)…");
    const r = await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: appEnv, timeout: 180_000 });
    const tail = ((r.stdout || "") + (r.stderr || "")).split("\n").filter((l) => l.trim()).slice(-6).join("\n   ");
    const safe = tail.replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***");
    if (r.status === 0) log(`схема актуальна.\n   ${safe}`);
    else log(`миграции не применились (код ${r.status}); приложение всё равно запускается.\n   ${safe}\n   Подсказка: для Neon нужен адрес БЕЗ «-pooler» (прямое подключение).`);
  }

  // Фото артикулов, ссылки магазина и PLU (deploy/demo/article-photos*): файлы в /tmp/uploads стираются при каждом старте — распаковываем всегда;
  // SQL-патч идемпотентен (ON CONFLICT DO UPDATE), дамп заново не грузится. Сбой тут не мешает старту.
  try {
    const PACK = "deploy/demo/article-photos.tgz", PATCH = "deploy/demo/article-photos-patch.sql";
    let files = 0;
    if (existsSync(PACK)) {
      const dir = `${appEnv.UPLOAD_DIR}/article-photos`;
      const count = (d) => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? count(`${d}/${e.name}`) : 1; } catch { /* нет каталога */ } return n; };
      files = count(dir);
      if (files < 100) { const t = await run("tar", ["-xzf", PACK, "-C", appEnv.UPLOAD_DIR], { timeout: 120_000 }); if (t.status !== 0) log(`пакет фото не распаковался: ${cleanErr(t)}`); files = count(dir); }
    }
    let arts = 0;
    if (existsSync(PATCH)) {
      const r = await psql(["-f", PATCH]);
      if (r.status !== 0) log(`патч фото не применился (приложение запускается без него):\n   ${cleanErr(r)}`);
      else { const c = await psql(["-tAc", `select count(*) from "SystemState" where key like 'article-photos:%'`]); arts = Number(c.stdout.trim()) || 0; }
    }
    if (existsSync(PACK) || existsSync(PATCH)) log(`фото артикулов: ${arts} артикулов, ${files} файлов`);
  } catch (e) { log(`фото артикулов пропущены: ${e instanceof Error ? e.message : e}`); }

  // Приложение внутри контейнера
  log(`запуск приложения на 127.0.0.1:${UP}`);
  const app = spawn(process.execPath, ["server.js"], { env: appEnv, stdio: "inherit" });
  app.on("exit", (code) => { console.error(`[демо] приложение остановилось (код ${code}); перезапуск контейнера`); process.exit(code || 1); });
  for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { app.kill(s); setTimeout(() => process.exit(0), 3000).unref(); });

  // Ждём, пока приложение начнёт отвечать, и прогреваем первый вызов (загрузка модулей Next и подключение к базе).
  for (let i = 0; i < 180; i++) {
    const ok = await new Promise((resolve) => {
      const q = http.get({ host: "127.0.0.1", port: UP, path: "/login", timeout: 4000 }, (r) => { r.resume(); r.on("end", () => resolve(true)); });
      q.on("error", () => resolve(false));
      q.on("timeout", () => { q.destroy(); resolve(false); });
    });
    if (ok) { appReady = true; log("приложение отвечает."); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log("приложение не ответило за 3 минуты; замок продолжает пересылать запросы.");
  appReady = true;
}

