import "server-only";
import { prisma } from "@/lib/prisma";
import { runIntegrityChecks, summarize, violationsForEntity, knownForEntity, invalidateIntegrity } from "./run";
import type { IntegrityReport } from "./types";

export { summarize, violationsForEntity, knownForEntity, invalidateIntegrity };
export type { IntegrityReport, IntegritySummary, CheckResult, Violation, KnownViolation, EntityKind } from "./types";

/** Отчёт самопроверки организации (кэш 60 с, только чтение БД). Ошибка расчёта не должна ломать страницу: вернёт null. */
export async function getIntegrityReport(organizationId: string, opts: { force?: boolean } = {}): Promise<IntegrityReport | null> {
  try {
    return await runIntegrityChecks(prisma, organizationId, opts);
  } catch (e) {
    console.error("[integrity] отчёт не получен:", e);
    return null;
  }
}
