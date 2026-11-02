// Данные для «План производства 2027» (отчёт в Бюджете и Excel «Сырьё и бюджет FW27», лист 8): строки Budget PCS с нормами,
// параметры закупки, склад и потребность FW26, цены, норка по полу и сохранённые правки плана (SystemState production-plan:fw27).
import "server-only";
import { prisma } from "@/lib/prisma";
import { getPcs, listPcs } from "@/lib/budget-pcs-store";
import { loadBudgetAvg, withBudgetAvg } from "@/lib/budget-pcs-avg";
import { loadRawBalance } from "@/lib/raw-balance";
import { loadMinkSexStock } from "@/lib/mink-sex";
import type { PlanState } from "@/lib/fw27-plan";

export const PLAN_KEY = "production-plan:fw27";

export async function getPlanState(orgId: string): Promise<PlanState> {
  const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PLAN_KEY } } });
  return { ...((r?.value ?? {}) as PlanState), updatedAt: r?.updatedAt.toISOString() };
}
export async function putPlanState(orgId: string, s: PlanState): Promise<void> {
  const value = JSON.parse(JSON.stringify(s));
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PLAN_KEY } }, update: { value }, create: { organizationId: orgId, key: PLAN_KEY, value } });
}

export async function loadPlanData(orgId: string) {
  const doc = (await getPcs(orgId, "fw27-mvst")) ?? (await listPcs(orgId))[0];
  const [avg, bal, state] = await Promise.all([loadBudgetAvg(orgId), loadRawBalance(orgId), getPlanState(orgId)]);
  const minkStock = await loadMinkSexStock(orgId, bal.rows.find((r) => r.fur === "Норка")?.stock ?? 0);
  return { pcsId: doc.id, pcsName: doc.name, rows: withBudgetAvg(doc.rows, avg), params: doc.params ?? { leftoverPct: 70, lynxPct: 85, newPct: 70 }, raw: bal.rows, mix: bal.mix, price: bal.price, minkStock, state };
}
