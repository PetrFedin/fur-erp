import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadBudgetStats } from "@/lib/budget-stats";
import { DEFAULT_PARAMS, autoCalc, defaultLines, type BudgetLine, type BudgetParams } from "@/lib/budget-calc";
import { BudgetEditor } from "./budget-editor";

export const metadata = { title: "Бюджет" };

const SEASON = "FW27";
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function BudgetPage() {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const [saved, stats] = await Promise.all([
    prisma.budgetScenario.findUnique({ where: { organizationId_season: { organizationId: orgId, season: SEASON } } }),
    loadBudgetStats(orgId),
  ]);
  const params: BudgetParams = saved ? { ...DEFAULT_PARAMS, ...(saved.params as Partial<BudgetParams>) } : DEFAULT_PARAMS;
  // Первый заход: строки по бюджету, всё кроме рыси заполнено автоматически из данных системы; рысь — вручную.
  const lines: BudgetLine[] = saved ? (saved.lines as unknown as BudgetLine[]) : autoCalc(defaultLines(), stats, params);
  return (
    <BudgetEditor
      season={SEASON}
      initialParams={params}
      initialLines={lines}
      initialStats={stats}
      canEdit={EDIT_ROLES.includes(session.user.role)}
      savedAt={saved?.updatedAt.toISOString() ?? null}
      savedBy={saved?.updatedBy ?? null}
    />
  );
}
