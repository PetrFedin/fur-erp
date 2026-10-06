import { PrismaClient, Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import * as React from "react";
import { AUDITED_MODELS, DELETE_CHILDREN, deleteSnapshot, diffRows, labelFor, snapshot } from "@/lib/audit-core";

/**
 * Клиент БД с ЖУРНАЛОМ ИЗМЕНЕНИЙ.
 *
 * Расширение `$extends` перехватывает create / createMany / update / updateMany / upsert / delete / deleteMany
 * по моделям из белого списка (AUDITED_MODELS в audit-core.ts), читает «было», считает diff и пишет AuditLog
 * в ТОЙ ЖЕ транзакции, что и сама правка:
 *   • внутри `prisma.$transaction(async (tx) => …)` — через tx (откат правки откатывает и запись журнала);
 *   • одиночная операция — оборачивается во внутреннюю транзакцию (правка + журнал атомарны);
 *   • `prisma.$transaction([…])` (массив) — журнал пишется после успешной фиксации пачки.
 * Актёр: сессия запроса (getFreshSession) → source "ui"; вне запроса — AUDIT_ACTOR или "script"; не определён — "system".
 * Сбой самого журнала никогда не ломает бизнес-операцию (кроме SQL-ошибки внутри уже открытой транзакции).
 * Скрипты со своим PrismaClient журнал не пишут: используйте createAuditedClient(actor) (см. docs/TESTING.md, раздел «Журнал изменений»).
 */

export type AuditActor = { source?: string; id?: string | null; name?: string | null; role?: string | null; organizationId?: string | null };

type Store = { tx: unknown; batchId: string; skip?: boolean };
const als = new AsyncLocalStorage<Store>();

const newId = () => "b" + randomBytes(9).toString("hex");
const MULTI_ROWS_MAX = 50; // updateMany/deleteMany: до скольких строк пишем отдельные записи, дальше — одна сводная
const FETCH_CAP = 2000;

type Db = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const lower = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

// ---------- актёр ----------

const reactCache: <T extends (...a: never[]) => unknown>(f: T) => T = (React as unknown as { cache?: <T>(f: T) => T }).cache ?? ((f) => f);

/** Один id на запрос/действие: несколько правок одного клика группируются в истории. */
const requestBatchId = reactCache(() => newId());

async function sessionActor(): Promise<AuditActor | null> {
  if (process.env.AUDIT_ACTOR) return null; // явно заданный источник (скрипт) важнее сессии
  try {
    const { getFreshSession } = await import("@/lib/session");
    const s = await getFreshSession();
    if (!s) return null;
    return { source: "ui", id: s.user.id, name: s.user.name, role: s.user.role, organizationId: s.user.organizationId };
  } catch {
    return null; // вне request-scope или сессия недоступна
  }
}

const resolveActorCached = reactCache(async (fixed: string): Promise<AuditActor> => {
  void fixed;
  const fromSession = await sessionActor();
  if (fromSession) return fromSession;
  const env = process.env.AUDIT_ACTOR;
  if (env) return { source: env.includes(":") ? env : `script:${env}` };
  return { source: process.env.NEXT_RUNTIME ? "system" : "script" };
});

// ---------- ядро ----------

type Rec = { model: string; recordId: string; action: "create" | "update" | "delete"; changes: unknown; label: string | null; organizationId?: string | null };

function orgOf(row: Record<string, unknown> | undefined | null): string | null {
  return typeof row?.organizationId === "string" ? row.organizationId : null;
}

type Env = { base: Db; fixedActor?: AuditActor };

async function defaultOrgId(env: Env): Promise<string> {
  const o = await env.base.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return o?.id ?? "unknown";
}

async function writeLog(env: Env, db: Db, recs: Rec[], batchId: string, groupBatch: boolean) {
  if (recs.length === 0) return;
  const actor = env.fixedActor ?? (await resolveActorCached("x"));
  const fallbackOrg = actor.organizationId ?? (recs.every((r) => r.organizationId) ? null : await defaultOrgId(env));
  const multi = groupBatch || recs.length > 1;
  await db.auditLog.createMany({
    data: recs.map((r) => ({
      organizationId: r.organizationId ?? fallbackOrg ?? "unknown",
      actorId: actor.id ?? null,
      actorName: actor.name ?? null,
      actorRole: actor.role ?? null,
      source: actor.source ?? "system",
      model: r.model,
      recordId: r.recordId,
      action: r.action,
      changes: r.changes as Prisma.InputJsonValue,
      label: r.label,
      batchId: multi ? batchId : null,
    })),
  });
}

function hasAllScalars(res: unknown, before: Record<string, unknown>): res is Record<string, unknown> {
  if (!res || typeof res !== "object") return false;
  const r = res as Record<string, unknown>;
  return Object.keys(before).every((k) => k in r);
}

/**
 * Выполняет операцию с журналом. `db` — клиент, через который читаем «было/стало» и пишем журнал (tx либо клиент вне транзакции);
 * `run` — сама правка (в той же транзакции).
 */
async function audited(
  env: Env,
  db: Db,
  model: string,
  operation: string,
  args: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  run: () => Promise<unknown>,
  ctx: { batchId: string; mode: "tx" | "batch"; group?: boolean },
): Promise<unknown> {
  const d = lower(model);
  const ops = AUDITED_MODELS[model];
  const kind: "create" | "update" | "delete" =
    operation === "create" || operation === "createMany" ? "create" : operation === "delete" || operation === "deleteMany" ? "delete" : "update";
  // upsert считаем обновлением, если строка уже была
  let before: Record<string, unknown> | null = null;
  let beforeRows: Record<string, unknown>[] = [];
  const include = DELETE_CHILDREN[model];
  try {
    if (operation === "update" || operation === "delete" || operation === "upsert") {
      before = await db[d].findUnique({ where: args.where, ...(operation === "delete" && include ? { include } : {}) });
    } else if (operation === "updateMany" || operation === "deleteMany") {
      beforeRows = await db[d].findMany({ where: args.where ?? {}, take: FETCH_CAP });
    }
  } catch (e) {
    console.error("[audit] не удалось прочитать «было»", model, operation, e);
  }

  let result: unknown;
  let createdRows: Record<string, unknown>[] | null = null;
  if (operation === "createMany" && ctx.mode === "tx") {
    // createMany не возвращает строки; берём createManyAndReturn, чтобы записать id (результат для вызывающего прежний: { count })
    createdRows = (await run()) as Record<string, unknown>[];
    result = { count: createdRows.length };
  } else {
    result = await run();
  }

  const recs: Rec[] = [];
  let groupBatch = false;
  try {
    if (!ops || !ops.includes(kind)) return result;
    if (operation === "create") {
      const row = result as Record<string, unknown>;
      recs.push({ model, recordId: String(row.id ?? "?"), action: "create", changes: snapshot(model, row), label: labelFor(model, row), organizationId: orgOf(row) });
    } else if (operation === "createMany") {
      const rows = createdRows;
      const data: Record<string, unknown>[] = Array.isArray(args.data) ? args.data : args.data ? [args.data] : [];
      const count = rows ? rows.length : ((result as { count?: number })?.count ?? data.length);
      if (count > 0) {
        const ids = rows ? rows.map((r) => String(r.id)) : data.map((r) => (r.id ? String(r.id) : "")).filter(Boolean);
        const sample = (rows ?? data).slice(0, 5).map((r) => snapshot(model, r));
        const first = (rows ?? data)[0] ?? {};
        recs.push({
          model,
          recordId: count === 1 && ids[0] ? ids[0] : `batch:${ctx.batchId}`,
          action: "create",
          changes: { count, ids, sample },
          label: `${count} шт.: ${labelFor(model, first)}`,
          organizationId: orgOf(first),
        });
      }
    } else if (operation === "update" || (operation === "upsert" && before)) {
      if (before) {
        const row = result as Record<string, unknown>;
        let after: Record<string, unknown> | null = hasAllScalars(row, before) ? row : null;
        if (!after) after = await db[d].findUnique({ where: { id: before.id } });
        const diff = after ? diffRows(model, before, after) : {};
        if (Object.keys(diff).length > 0) {
          recs.push({ model, recordId: String(before.id), action: "update", changes: diff, label: labelFor(model, after ?? before), organizationId: orgOf(after ?? before) });
        }
      }
    } else if (operation === "upsert") {
      const row = result as Record<string, unknown>;
      recs.push({ model, recordId: String(row.id ?? "?"), action: "create", changes: snapshot(model, row), label: labelFor(model, row), organizationId: orgOf(row) });
    } else if (operation === "delete") {
      if (before) recs.push({ model, recordId: String(before.id), action: "delete", changes: deleteSnapshot(model, before), label: labelFor(model, before), organizationId: orgOf(before) });
    } else if (operation === "updateMany") {
      if (beforeRows.length > 0) {
        const ids = beforeRows.map((r) => r.id);
        const afterRows: Record<string, unknown>[] = await db[d].findMany({ where: { id: { in: ids } } });
        const byId = new Map(afterRows.map((r) => [r.id, r]));
        const items = beforeRows
          .map((b) => ({ b, a: byId.get(b.id) }))
          .filter((x) => x.a)
          .map((x) => ({ id: String(x.b.id), diff: diffRows(model, x.b, x.a!), row: x.a! }))
          .filter((x) => Object.keys(x.diff).length > 0);
        if (items.length <= MULTI_ROWS_MAX) {
          groupBatch = items.length > 1;
          for (const it of items) recs.push({ model, recordId: it.id, action: "update", changes: it.diff, label: labelFor(model, it.row), organizationId: orgOf(it.row) });
        } else {
          recs.push({
            model,
            recordId: `batch:${ctx.batchId}`,
            action: "update",
            changes: { count: items.length, ids: items.map((i) => i.id), sample: items.slice(0, 20).map((i) => ({ id: i.id, diff: i.diff })) },
            label: `${items.length} шт.: ${labelFor(model, items[0].row)}`,
            organizationId: orgOf(items[0].row),
          });
        }
      }
    } else if (operation === "deleteMany") {
      if (beforeRows.length > 0) {
        if (beforeRows.length <= MULTI_ROWS_MAX) {
          groupBatch = beforeRows.length > 1;
          for (const b of beforeRows) recs.push({ model, recordId: String(b.id), action: "delete", changes: deleteSnapshot(model, b), label: labelFor(model, b), organizationId: orgOf(b) });
        } else {
          recs.push({
            model,
            recordId: `batch:${ctx.batchId}`,
            action: "delete",
            changes: { count: beforeRows.length, ids: beforeRows.map((r) => String(r.id)), rows: beforeRows.map((r) => snapshot(model, r)) },
            label: `${beforeRows.length} шт.: ${labelFor(model, beforeRows[0])}`,
            organizationId: orgOf(beforeRows[0]),
          });
        }
      }
    }
  } catch (e) {
    console.error("[audit] не удалось вычислить запись журнала", model, operation, e);
    return result;
  }

  if (recs.length > 0) {
    if (ctx.mode === "tx") {
      await writeLog(env, db, recs, ctx.batchId, groupBatch || !!ctx.group);
    } else {
      try {
        await writeLog(env, db, recs, ctx.batchId, groupBatch || !!ctx.group);
      } catch (e) {
        console.error("[audit] не удалось записать журнал", e);
      }
    }
  }
  return result;
}

function buildExtension(env: Env) {
  const { base } = env;
  return Prisma.defineExtension({
    name: "audit-log",
    query: {
      $allModels: {
        async $allOperations(params) {
          const { model, operation, args, query } = params;
          const ops = AUDITED_MODELS[model];
          const isWrite = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(operation);
          // Журнал не поддерживается устаревшим сгенерированным клиентом (до prisma generate) — не мешаем работе.
          if (!ops || !isWrite || als.getStore()?.skip || typeof (base as Db).auditLog?.createMany !== "function") return query(args);
          const kind = operation.startsWith("create") ? "create" : operation.startsWith("delete") ? "delete" : "update";
          const need = operation === "upsert" ? ["create", "update"] : [kind];
          if (!need.some((k) => ops.includes(k as "create" | "update" | "delete"))) return query(args);

          const itx = (params as unknown as { __internalParams?: { transaction?: { kind?: string } } }).__internalParams?.transaction;
          const store = als.getStore();

          if (itx?.kind === "itx" && store?.tx) {
            // уже внутри interactive-транзакции: правка, чтения и журнал идут через один и тот же tx
            const tx = store.tx as Db;
            if (operation === "createMany") {
              return audited(env, tx, model, operation, args, () => als.run({ ...store, skip: true }, () => tx[lower(model)].createManyAndReturn(args)), { batchId: store.batchId, mode: "tx", group: true });
            }
            return audited(env, tx, model, operation, args, () => query(args), { batchId: store.batchId, mode: "tx", group: true });
          }
          if (itx) {
            // пачка $transaction([...]) (или itx вне нашей обёртки): читаем «было» вне транзакции, журнал пишем после фиксации
            return audited(env, base, model, operation, args, () => query(args), { batchId: requestBatchId(), mode: "batch" });
          }
          // одиночная операция: правка + журнал в одной внутренней транзакции
          const batchId = requestBatchId();
          if (!env.fixedActor) await resolveActorCached("x"); // актёр определяется ДО открытия транзакции (не держим соединение)
          return (base as Db).$transaction(
            (tx: Db) =>
              audited(env, tx, model, operation, args, () => tx[lower(model)][operation === "createMany" ? "createManyAndReturn" : operation](args), { batchId, mode: "tx" }),
            { maxWait: 10_000, timeout: 60_000 },
          );
        },
      },
    },
  });
}

/** Обёртка над $transaction: запоминает tx, чтобы расширение писало журнал в ту же транзакцию, и даёт операции общий batchId. */
function wrapTransaction<C extends object>(client: C): C {
  return new Proxy(client, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (prop === "$transaction" && typeof v === "function") {
        return (arg: unknown, opts?: unknown) => {
          if (typeof arg === "function") {
            const batchId = newId();
            return (v as (...a: unknown[]) => unknown).call(target, (tx: unknown) => als.run({ tx, batchId }, () => (arg as (t: unknown) => unknown)(tx)), opts);
          }
          return (v as (...a: unknown[]) => unknown).call(target, arg, opts);
        };
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

function makeClient(base: PrismaClient, fixedActor?: AuditActor) {
  const extended = base.$extends(buildExtension({ base: base as unknown as Db, fixedActor }));
  return wrapTransaction(extended);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined; // прежний ключ (до журнала) — переиспользуем соединение при горячей перезагрузке
  prismaBase: PrismaClient | undefined;
  prismaAudited: PrismaClient | undefined;
};

const baseClient =
  globalForPrisma.prismaBase ??
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Тип намеренно PrismaClient: расширенный клиент структурно несовместим с PrismaClient/TransactionClient в сигнатурах по всему коду.
export const prisma: PrismaClient = globalForPrisma.prismaAudited ?? (makeClient(baseClient) as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = baseClient;
  globalForPrisma.prismaAudited = prisma;
}

/** Базовый клиент без журнала — только для служебных нужд (чтение журнала, тесты). */
export const rawPrisma: PrismaClient = baseClient;

/**
 * Клиент с журналом для скриптов (вне Next): `const prisma = createAuditedClient("script:apply-crosscheck-fixes")`.
 * Каждая правка по важным моделям попадёт в AuditLog с этим источником. `url` — другая БД (например, тестовая).
 */
export function createAuditedClient(actor: string | AuditActor, opts: { url?: string } = {}) {
  const a: AuditActor = typeof actor === "string" ? { source: actor.includes(":") ? actor : `script:${actor}` } : { source: "script", ...actor };
  const base = new PrismaClient(opts.url ? { datasources: { db: { url: opts.url } } } : undefined);
  return Object.assign(makeClient(base, a) as unknown as PrismaClient, { $rawBase: base });
}
