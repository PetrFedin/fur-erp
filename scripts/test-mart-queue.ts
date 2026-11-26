// Очередь пересборки витрины (src/lib/mart/queue.ts) на копии базы (имя содержит «scratch»): склейка правок, again, восстановление после падения,
// повтор при ошибке, отсутствие двойного захвата. Сама сборка подменяется заглушкой.
process.env.MART_AUTO_REFRESH = "1";
delete process.env.SNAPSHOTS; // проверка свежести настоящая, не «всегда устарела»
import "./stubs/server-only-shim";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; console.log(`${cond ? "OK  " : "FAIL"} ${what}${extra ? " " + extra : ""}`); if (!cond) fails++; };

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { enqueueMartRefresh, claimDueJob, finishJob, processDueJobs } = await import("../src/lib/mart/queue");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const hasMart = (await prisma.dmSku.count({ where: { organizationId: org } })) > 0;
  if (!hasMart) { console.log("(в копии нет витрины — проверка пропущена)"); process.exit(0); }
  const job = () => prisma.dmRefreshJob.findUniqueOrThrow({ where: { organizationId: org } });
  await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } });

  // 1. склейка: три правки подряд — одна строка, runAt сдвигается
  await enqueueMartRefresh(org, 60_000);
  const t1 = (await job()).runAt.getTime();
  await new Promise((r) => setTimeout(r, 30));
  await enqueueMartRefresh(org, 60_000);
  await enqueueMartRefresh(org, 60_000);
  ok("правки склеились в одну задачу", (await prisma.dmRefreshJob.count({ where: { organizationId: org } })) === 1);
  ok("каждая правка сдвигает время старта", (await job()).runAt.getTime() > t1);
  ok("до срока задачу не берут", (await claimDueJob()) === null);

  // 2. созрела — берётся ровно одним воркером
  await enqueueMartRefresh(org, 0);
  const [a, b] = await Promise.all([claimDueJob(), claimDueJob()]);
  ok("два воркера одновременно: задачу взял один", [a, b].filter(Boolean).length === 1);
  ok("статус running", (await job()).status === "running");

  // 3. правка во время сборки → again, после окончания снова pending
  await enqueueMartRefresh(org, 0);
  ok("правка во время сборки ставит again", (await job()).again === true && (await job()).status === "running");
  await finishJob(org, null);
  const afterAgain = await job();
  ok("после сборки с again задача снова ждёт", afterAgain.status === "pending" && afterAgain.again === true);

  // 4. нормальный цикл: processDueJobs с заглушкой
  await prisma.dmRefreshJob.update({ where: { organizationId: org }, data: { runAt: new Date(Date.now() - 1000), again: false } });
  const ran: string[] = [];
  const n = await processDueJobs(async (o) => { ran.push(o); });
  ok("воркер выполнил задачу один раз", n === 1 && ran[0] === org);
  ok("статус done", (await job()).status === "done");

  // 5. ошибка → повтор с задержкой, потом failed
  await prisma.dmRefreshJob.update({ where: { organizationId: org }, data: { status: "pending", runAt: new Date(Date.now() - 1000), attempts: 0 } });
  await processDueJobs(async () => { throw new Error("тестовая ошибка"); });
  const afterErr = await job();
  ok("после ошибки задача вернулась в очередь с задержкой", afterErr.status === "pending" && afterErr.attempts === 1 && afterErr.runAt.getTime() > Date.now() && /тестовая/.test(afterErr.lastError ?? ""));
  // Оповещение о сбое: заглушка Bot API на локальном порту ловит sendMessage (этап 7, наблюдаемость).
  const http = await import("node:http");
  const got: { method: string; body: string }[] = [];
  const tg = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push({ method: String(req.url).split("/").pop() ?? "", body: b }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, result: { message_id: 1 } })); }); });
  await new Promise<void>((r) => tg.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_API_BASE: `http://127.0.0.1:${(tg.address() as { port: number }).port}`, ALERT_TELEGRAM_CHAT_ID: "-100123" });
  await prisma.dmRefreshJob.update({ where: { organizationId: org }, data: { status: "running", attempts: 0, lockedUntil: new Date(Date.now() + 60_000) } });
  await finishJob(org, new Error("первая"));
  ok("промежуточная ошибка (попытка 1) оповещения не шлёт", got.length === 0 && (await job()).status === "pending");
  await prisma.dmRefreshJob.update({ where: { organizationId: org }, data: { status: "running", attempts: 4, lockedUntil: new Date(Date.now() + 60_000) } });
  await finishJob(org, new Error("снова"));
  ok("после исчерпания попыток — failed", (await job()).status === "failed");
  const sent = got.find((g) => g.method === "sendMessage");
  ok("при failed оповещение ушло в Telegram: чат, текст, ошибка", !!sent && /-100123/.test(sent.body) && /не пересобралась/.test(sent.body) && /снова/.test(sent.body), sent?.body.slice(0, 120) ?? "нет запроса");
  const { loadControlCounts } = await import("../src/lib/control-counts");
  const cc = await loadControlCounts(org, "all", { fresh: true });
  ok("сбой виден в «Что требует внимания» первой строкой со ссылкой на «Контроль → Данные»", cc.top?.[0]?.id === "mart-failed" && cc.top[0].href === "/data-check");
  tg.close();
  for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_API_BASE", "ALERT_TELEGRAM_CHAT_ID"]) delete process.env[k];

  // 6. восстановление после падения сервера: running с истёкшей блокировкой
  await prisma.dmRefreshJob.update({ where: { organizationId: org }, data: { status: "running", lockedUntil: new Date(Date.now() - 1000), attempts: 0 } });
  ok("зависшая задача возвращается в работу", (await claimDueJob()) === org);

  // 7. после выкладки: устаревшей витрине ставится пересборка без задержки, свежей — нет
  const { enqueueStaleOnStart } = await import("../src/lib/mart/queue");
  await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } });
  await prisma.$executeRaw`UPDATE "SystemState" SET value = to_jsonb(${Date.now() + 3_600_000}::bigint) WHERE "organizationId" = ${org} AND key = 'data-version'`;
  const stale = await enqueueStaleOnStart();
  const sj = await prisma.dmRefreshJob.findUnique({ where: { organizationId: org } });
  ok("устаревшая витрина: при старте поставлена пересборка", stale >= 1 && sj?.status === "pending" && sj.runAt.getTime() <= Date.now() + 1000);
  await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } });
  await prisma.$executeRaw`UPDATE "SystemState" SET value = to_jsonb(0::bigint) WHERE "organizationId" = ${org} AND key = 'data-version'`;
  // Полный набор снимков: недостающие (копия могла быть собрана прежним кодом) — пустышки, после теста удаляются.
  const { SNAPSHOT_REQUIRED_KEYS, missingSnapshotKeys } = await import("../src/lib/mart/fresh");
  const added = await missingSnapshotKeys(prisma, org);
  for (const key of added) await prisma.dmSnapshot.create({ data: { organizationId: org, key, payload: {}, builtAt: new Date() } });
  const fresh = await enqueueStaleOnStart();
  ok("свежая полная витрина: при старте ничего не ставится", fresh === 0 && (await prisma.dmRefreshJob.count({ where: { organizationId: org } })) === 0);
  // 7б. свежая, но без снимка, который читает новый код (выкладка 25.11: pay:auctions, drill:all) — пересборка ставится
  const gone = await prisma.dmSnapshot.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org, key: "pay:auctions" } } });
  await prisma.dmSnapshot.delete({ where: { id: gone.id } });
  ok("недостающий снимок виден", (await missingSnapshotKeys(prisma, org)).join() === "pay:auctions");
  const incomplete = await enqueueStaleOnStart();
  ok("свежая витрина без снимка: при старте поставлена пересборка", incomplete >= 1 && (await prisma.dmRefreshJob.findUnique({ where: { organizationId: org } }))?.status === "pending");
  await prisma.dmSnapshot.create({ data: gone as never });
  await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } });
  await prisma.dmSnapshot.deleteMany({ where: { organizationId: org, key: { in: added } } });
  ok("в списке обязательных снимков нет повторов", new Set(SNAPSHOT_REQUIRED_KEYS).size === SNAPSHOT_REQUIRED_KEYS.length);

  // 8. витрины нет вовсе (демо-база после выкладки), лоты есть — при старте пересборка ставится
  await prisma.$executeRaw`DELETE FROM "DmLot" WHERE "organizationId" = ${org}`;
  await prisma.$executeRaw`DELETE FROM "DmSku" WHERE "organizationId" = ${org}`;
  const none = await enqueueStaleOnStart();
  ok("витрины нет: при старте поставлена пересборка", none >= 1 && (await prisma.dmRefreshJob.findUnique({ where: { organizationId: org } }))?.status === "pending");
  ok("обычная правка без витрины задачу не ставит", (await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } })) && (await enqueueMartRefresh(org, 0)) === false);

  await prisma.dmRefreshJob.deleteMany({ where: { organizationId: org } });
  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
