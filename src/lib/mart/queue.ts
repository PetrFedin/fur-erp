import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Очередь пересборки витрины на Postgres (этап 3 плана архитектуры). Заменяет таймер в памяти процесса:
 *  • задача лежит в базе (DmRefreshJob, одна строка на организацию), поэтому переживает перезапуск сервера;
 *  • несколько правок подряд склеиваются: каждая сдвигает runAt, сборка стартует, когда запись «затихла» на DELAY_MS;
 *  • правка во время сборки ставит again — после окончания собираем ещё раз;
 *  • воркеры (по одному на экземпляр сервера) берут задачу через FOR UPDATE SKIP LOCKED, одну и ту же дважды не возьмут;
 *  • сборка, начатая и не законченная (сервер упал), через LOCK_MS возвращается в очередь;
 *  • ошибка — повтор с задержкой, после MAX_ATTEMPTS попыток задача получает status = failed (видна в «Контроле → Данные»).
 * Выключатель: MART_AUTO_REFRESH=0 (тесты, разовые скрипты).
 */
export const DELAY_MS = Math.max(0, Number(process.env.MART_REFRESH_DELAY_MS ?? 90_000)) || 90_000;
const LOCK_MS = 20 * 60_000;
const MAX_ATTEMPTS = 5;
const POLL_MS = 10_000;

const db = prisma as unknown as { $queryRaw: typeof prisma.$queryRaw; $executeRaw: typeof prisma.$executeRaw };

async function orgHasMart(orgId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM "DmSku" WHERE "organizationId" = ${orgId} LIMIT 1`;
  return rows.length > 0;
}

/** Поставить пересборку: через delayMs после последней записи (0 — как можно скорее). Витрины нет (демо, чистая база) — ничего не ставится. */
export async function enqueueMartRefresh(orgId: string, delayMs: number = DELAY_MS): Promise<void> {
  if (process.env.MART_AUTO_REFRESH === "0") return;
  try {
    if (!(await orgHasMart(orgId))) return;
    const runAt = new Date(Date.now() + delayMs);
    await db.$executeRaw`
      INSERT INTO "DmRefreshJob" ("id", "organizationId", "status", "runAt", "again", "attempts", "requestedAt")
      VALUES (${randomUUID()}, ${orgId}, 'pending', ${runAt}, false, 0, now())
      ON CONFLICT ("organizationId") DO UPDATE SET
        "again" = CASE WHEN "DmRefreshJob"."status" = 'running' THEN true ELSE "DmRefreshJob"."again" END,
        "status" = CASE WHEN "DmRefreshJob"."status" = 'running' THEN 'running' ELSE 'pending' END,
        "runAt" = ${runAt},
        "attempts" = CASE WHEN "DmRefreshJob"."status" = 'running' THEN "DmRefreshJob"."attempts" ELSE 0 END,
        "requestedAt" = now()`;
  } catch (e) {
    console.error("[mart] не удалось поставить пересборку в очередь:", e); // постановка не должна ломать сохранение данных
  }
}

/** Берёт одну созревшую задачу (или зависшую «running» с истёкшей блокировкой). Возвращает id организации или null. */
export async function claimDueJob(): Promise<string | null> {
  const rows = await db.$queryRaw<{ organizationId: string }[]>`
    UPDATE "DmRefreshJob" j SET "status" = 'running', "lockedUntil" = ${new Date(Date.now() + LOCK_MS)}, "lastStartedAt" = now(), "again" = false
    WHERE j."id" = (
      SELECT "id" FROM "DmRefreshJob"
      WHERE ("status" = 'pending' AND "runAt" <= now()) OR ("status" = 'running' AND "lockedUntil" < now())
      ORDER BY "runAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j."organizationId"`;
  return rows[0]?.organizationId ?? null;
}

/** Итог сборки: успех — done (или снова pending, если во время неё пришла правка); ошибка — повтор с нарастающей задержкой. */
export async function finishJob(orgId: string, error: unknown | null): Promise<void> {
  if (error === null) {
    await db.$executeRaw`
      UPDATE "DmRefreshJob" SET
        "status" = CASE WHEN "again" THEN 'pending' ELSE 'done' END,
        "runAt" = CASE WHEN "again" THEN now() + ${DELAY_MS} * interval '1 millisecond' ELSE "runAt" END,
        "attempts" = 0, "lastError" = NULL, "lockedUntil" = NULL, "lastFinishedAt" = now()
      WHERE "organizationId" = ${orgId}`;
    return;
  }
  const msg = String((error as Error)?.message ?? error).slice(0, 500);
  await db.$executeRaw`
    UPDATE "DmRefreshJob" SET
      "attempts" = "attempts" + 1, "lastError" = ${msg}, "lockedUntil" = NULL, "lastFinishedAt" = now(),
      "status" = CASE WHEN "attempts" + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
      "runAt" = now() + (LEAST(60, POWER(2, "attempts" + 1)) * 60000) * interval '1 millisecond'
    WHERE "organizationId" = ${orgId}`;
}

/** Обрабатывает созревшие задачи по одной. run — сама сборка (по умолчанию buildMart); в тестах подставляется заглушка. */
export async function processDueJobs(run?: (orgId: string) => Promise<unknown>): Promise<number> {
  const exec = run ?? (async (orgId: string) => { const { buildMart } = await import("@/lib/mart/build"); await buildMart(prisma, orgId); });
  let done = 0;
  for (;;) {
    const orgId = await claimDueJob();
    if (!orgId) return done;
    try { await exec(orgId); await finishJob(orgId, null); }
    catch (e) { console.error("[mart] пересборка не удалась:", e); await finishJob(orgId, e); }
    done++;
  }
}

let started = false;
/** Фоновый воркер: раз в POLL_MS проверяет очередь. Запускается один раз на процесс (src/instrumentation.ts). */
export function startMartWorker(): void {
  if (started || process.env.MART_AUTO_REFRESH === "0") return;
  started = true;
  const tick = () => { void processDueJobs().catch((e) => console.error("[mart] воркер очереди:", e)); };
  const t = setInterval(tick, POLL_MS);
  t.unref?.();
  setTimeout(tick, 5_000).unref?.(); // сразу после старта подбираем задачи, оставшиеся от прошлого процесса
}
