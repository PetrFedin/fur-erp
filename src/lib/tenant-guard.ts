import { Prisma } from "@prisma/client";
import { appendFileSync } from "node:fs";

/**
 * Защита организации (этап 2 плана архитектуры): запрос к таблице с `organizationId` без условия по организации — потенциальная утечка
 * данных между организациями. Расширение клиента проверяет каждый запрос и, смотря по режиму TENANT_GUARD:
 *   off (по умолчанию) — ничего не делает;
 *   log   — пишет нарушения в TENANT_GUARD_LOG (одна JSON-строка на нарушение: модель, операция, место вызова);
 *   error — бросает ошибку (для тестов и CI, когда накопленные нарушения исправлены).
 * Запрос считается ограниченным организацией, если `organizationId` встречается в `where` на любой глубине (в том числе через связь:
 * { lot: { organizationId } }) или в `data` при создании. Одиночные операции по уникальному id (findUnique / update / delete) помечаются
 * отдельным видом «by-id»: id глобален, но проверка организации после чтения остаётся на вызывающем коде.
 */
const MODE = (process.env.TENANT_GUARD ?? "off") as "off" | "log" | "error";
const LOG = process.env.TENANT_GUARD_LOG ?? "";

const tenantModels = new Set(Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "organizationId")).map((m) => m.name));

const hasOrg = (x: unknown, depth = 0): boolean => {
  if (!x || typeof x !== "object" || depth > 8) return false;
  if (Array.isArray(x)) return x.some((v) => hasOrg(v, depth + 1));
  const o = x as Record<string, unknown>;
  if ("organizationId" in o) return true;
  return Object.values(o).some((v) => hasOrg(v, depth + 1));
};

const SCOPED_READS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);
const BY_ID = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

function callSite(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(2);
  const hit = lines.find((l) => !/node_modules|tenant-guard|prisma\.ts|node:internal|\.next\/server\/chunks\/ssr\/node_modules/.test(l)) ?? lines[0] ?? "";
  return hit.trim().replace(/^at /, "").slice(0, 200);
}

function report(model: string, operation: string, kind: string) {
  const line = { model, operation, kind, at: callSite() };
  if (MODE === "error" && kind !== "by-id") throw new Error(`[tenant-guard] ${model}.${operation} без organizationId (${line.at})`);
  if (LOG) { try { appendFileSync(LOG, JSON.stringify(line) + "\n"); } catch { /* журнал недоступен — не мешаем работе */ } }
}

export function tenantGuardExtension() {
  if (MODE === "off") return null;
  return Prisma.defineExtension({
    name: "tenant-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (tenantModels.has(model)) {
            const a = args as { where?: unknown; data?: unknown } | undefined;
            if (SCOPED_READS.has(operation) && !hasOrg(a?.where)) report(model, operation, "unscoped");
            else if (BY_ID.has(operation) && !hasOrg(a?.where)) report(model, operation, "by-id");
            else if (CREATES.has(operation) && !hasOrg(a?.data)) report(model, operation, "create-no-org");
          }
          return query(args);
        },
      },
    },
  });
}
