// Запуск проверок и кэш результата на 60 секунд. Только чтение БД. Без server-only (годится для scripts/check-invariants.ts);
// приложение вызывает через src/lib/integrity/index.ts.
import type { PrismaClient } from "@prisma/client";
import { ALL_CHECKS, makeHelpers, type Ctx, type DebtProbe } from "./checks";
import { loadIntegrityData } from "./data";
import { KNOWN_RULES } from "./known";
import type { CheckResult, IntegrityReport, IntegritySummary, KnownViolation, Violation } from "./types";

export const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; value: Promise<IntegrityReport> }>();

async function probeDebt(db: PrismaClient, orgId: string): Promise<DebtProbe | null> {
  try {
    const { loadSupplierDebt } = await import("../supplier-debt");
    const x = await loadSupplierDebt(db, orgId, "all");
    return { debt: Number(x.debt), total: Number(x.total), receivedNet: Number(x.receivedNet), invoiced: Number(x.invoiced), expected: Number(x.expected), unlinkedAdvances: Number(x.unlinkedAdvances) };
  } catch (e) {
    console.error("[integrity] долг поставщику не рассчитан:", e);
    return null;
  }
}

async function compute(db: PrismaClient, orgId: string): Promise<IntegrityReport> {
  const t0 = Date.now();
  const d = await loadIntegrityData(db, orgId);
  const prev = new Map<string, Violation[]>();
  let debtP: Promise<DebtProbe | null> | null = null;
  const ctx: Ctx = { d, helpers: makeHelpers(d), prev, supplierDebt: () => (debtP ??= probeDebt(db, orgId)) };
  const results: CheckResult[] = [];
  for (const c of ALL_CHECKS) {
    const t1 = Date.now();
    let checked = 0;
    let all: Violation[] = [];
    let error: string | undefined;
    try {
      const r = await c.run(ctx);
      checked = r.checked;
      all = r.violations;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.error(`[integrity] проверка ${c.id} упала:`, e);
    }
    prev.set(c.id, all);
    const rules = KNOWN_RULES.filter((k) => k.check === c.id);
    const violations: Violation[] = [];
    const known: KnownViolation[] = [];
    for (const v of all) {
      const rule = rules.find((k) => k.match(v));
      if (rule) known.push({ ...v, reason: rule.reason, decision: rule.decision });
      else violations.push(v);
    }
    results.push({
      id: c.id, title: c.title, group: c.group, severity: c.severity, tolerance: c.tolerance, what: c.what, fix: c.fix,
      status: error || violations.length ? "fail" : known.length ? "known" : "ok",
      violations, known, checked, ms: Date.now() - t1, error,
    });
  }
  const failing = results.reduce((s, r) => s + r.violations.length, 0);
  const failingErrors = results.filter((r) => r.severity === "error").reduce((s, r) => s + r.violations.length, 0);
  return {
    checkedAt: new Date().toISOString(),
    orgId,
    ms: Date.now() - t0,
    results,
    failing,
    failingErrors,
    failingWarns: failing - failingErrors,
    knownCount: results.reduce((s, r) => s + r.known.length, 0),
    checksTotal: results.length,
    checksFailed: results.filter((r) => r.status === "fail").length,
    ok: results.every((r) => r.status !== "fail"),
  };
}

/**
 * Отчёт самопроверки организации. Кэш в памяти 60 с (на одновременные вызовы — один расчёт); `force` пересчитывает сразу.
 * Читает только БД.
 */
export function runIntegrityChecks(db: PrismaClient, orgId: string, opts: { force?: boolean } = {}): Promise<IntegrityReport> {
  const hit = cache.get(orgId);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = compute(db, orgId);
  cache.set(orgId, { at: Date.now(), value });
  value.catch(() => cache.delete(orgId));
  return value;
}

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;

/** Короткая сводка для колокольчика: самые серьёзные расхождения первыми. */
export function summarize(r: IntegrityReport, limit = 12): IntegritySummary {
  const flat = r.results.flatMap((c) => c.violations.map((v) => ({ c, v })));
  flat.sort((a, b) => SEV_ORDER[a.c.severity] - SEV_ORDER[b.c.severity] || Math.abs(b.v.delta ?? 0) - Math.abs(a.v.delta ?? 0));
  return {
    checkedAt: r.checkedAt,
    failing: r.failing,
    failingErrors: r.failingErrors,
    knownCount: r.knownCount,
    ok: r.ok,
    items: flat.slice(0, limit).map(({ c, v }) => ({ checkId: c.id, title: c.title, severity: c.severity, message: v.message, delta: v.delta, unit: v.unit, href: v.href, entityLabel: v.entity.label })),
    more: Math.max(flat.length - limit, 0),
  };
}

/** Расхождения (неизвестные), которые касаются записи (основной или связанной). Для плашек на карточках. */
export function violationsForEntity(r: IntegrityReport, kind: string, id: string): { checkId: string; title: string; severity: CheckResult["severity"]; v: Violation }[] {
  const out: { checkId: string; title: string; severity: CheckResult["severity"]; v: Violation }[] = [];
  for (const c of r.results) {
    for (const v of c.violations) {
      if ((v.entity.kind === kind && v.entity.id === id) || v.also?.some((e) => e.kind === kind && e.id === id)) out.push({ checkId: c.id, title: c.title, severity: c.severity, v });
    }
  }
  return out;
}

/** Известные расхождения записи (для спокойной пометки «известно: …»). */
export function knownForEntity(r: IntegrityReport, kind: string, id: string): { checkId: string; title: string; v: KnownViolation }[] {
  const out: { checkId: string; title: string; v: KnownViolation }[] = [];
  for (const c of r.results) {
    for (const v of c.known) {
      if ((v.entity.kind === kind && v.entity.id === id) || v.also?.some((e) => e.kind === kind && e.id === id)) out.push({ checkId: c.id, title: c.title, v });
    }
  }
  return out;
}
