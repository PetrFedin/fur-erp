"use server";

import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { loadBudgetStats } from "@/lib/budget-stats";
import { DEFAULT_PARAMS, type BudgetLine, type BudgetParams, type BudgetStat } from "@/lib/budget-calc";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

/** Свежая статистика системы для кнопки «Автоматический расчёт». */
export async function refreshBudgetStats(): Promise<BudgetStat[]> {
  const session = await requireSession();
  return loadBudgetStats(session.user.organizationId);
}

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown, max = 80) => String(v ?? "").slice(0, max);

/** Сохранение бюджета (параметры и строки одним документом); значения проверяются и ограничиваются. */
export async function saveBudget(season: string, params: BudgetParams, lines: BudgetLine[]): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  const session = await requireRole(...EDIT);
  if (!Array.isArray(lines) || lines.length > 300) return { ok: false, error: "Слишком много строк" };
  const p: BudgetParams = { upFur: n(params?.upFur, 10), upLining: n(params?.upLining, 10), upWork: n(params?.upWork, 10), c4: n(params?.c4, 4) };
  const clean: BudgetLine[] = lines.map((l) => ({
    id: s(l.id, 40), fur: s(l.fur), cat: s(l.cat), pcs: n(l.pcs), statFur: s(l.statFur), statCat: s(l.statCat), locked: !!l.locked,
    hides: n(l.hides), hidePrice: n(l.hidePrice), meters: n(l.meters), meterPrice: n(l.meterPrice), work: n(l.work),
    base: l.base ? { hides: n(l.base.hides), hidePrice: n(l.base.hidePrice), meters: n(l.base.meters), meterPrice: n(l.base.meterPrice), work: n(l.base.work) } : null,
    sample: n(l.sample),
  }));
  const orgId = session.user.organizationId;
  const row = await prisma.budgetScenario.upsert({
    where: { organizationId_season: { organizationId: orgId, season: s(season, 20) } },
    create: { organizationId: orgId, season: s(season, 20), name: `Бюджет ${s(season, 20)}`, params: p, lines: clean, updatedBy: session.user.name ?? null },
    update: { params: p, lines: clean, updatedBy: session.user.name ?? null },
  });
  return { ok: true, at: row.updatedAt.toISOString() };
}

export async function resetBudget(season: string): Promise<{ ok: boolean }> {
  const session = await requireRole(...EDIT);
  await prisma.budgetScenario.deleteMany({ where: { organizationId: session.user.organizationId, season: s(season, 20) } });
  void DEFAULT_PARAMS;
  return { ok: true };
}
