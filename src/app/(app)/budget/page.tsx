import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PARAMS, grandTotal, nowPerUnit, parseNodes, perUnit, varPct, type BudgetParams } from "@/lib/budget-calc";
import { listForecasts } from "@/lib/forecast-store";
import { ForecastCards } from "./forecast-cards";
import { PcsCards } from "./pcs-cards";
import { listPcs } from "@/lib/budget-pcs-store";
import { BudgetList, type BudgetSummary } from "./budget-list";

export const metadata = { title: "Бюджеты и прогнозы" };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function BudgetListPage() {
  const session = await requireSession();
  const rows = await prisma.budgetScenario.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { updatedAt: "desc" },
  });
  const forecasts = await listForecasts(session.user.organizationId);
  const pcsDocs = await listPcs(session.user.organizationId);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const items: BudgetSummary[] = rows.map((r) => {
    const params: BudgetParams = { ...DEFAULT_PARAMS, ...(r.params as Partial<BudgetParams>) };
    const t = grandTotal(parseNodes(r.lines), params);
    return {
      id: r.id, name: r.name, season: r.season, status: r.status === "APPROVED" ? "APPROVED" : "DRAFT", comment: r.comment,
      parentName: r.parentId ? (names.get(r.parentId) ?? null) : null,
      total: t.total, pcs: t.pcs, hides: t.hides, perUnit: perUnit(t), nowPerUnit: nowPerUnit(t), varPct: varPct(t),
      updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy,
    };
  });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы" }]} />
      <BudgetList items={items} canEdit={EDIT_ROLES.includes(session.user.role)} />
      <PcsCards canEdit={EDIT_ROLES.includes(session.user.role)} items={pcsDocs.map((f) => ({ id: f.id, name: f.name, season: f.season, updatedAt: f.updatedAt, updatedBy: f.updatedBy }))} />
      <ForecastCards canEdit={EDIT_ROLES.includes(session.user.role)} items={forecasts.map((f) => ({ id: f.id, name: f.name, season: f.season, updatedAt: f.updatedAt, updatedBy: f.updatedBy }))} />
    </div>
  );
}
