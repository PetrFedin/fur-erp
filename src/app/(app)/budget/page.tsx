import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PARAMS, grandTotal, nowPerUnit, parseNodes, perUnit, varPct, type BudgetParams } from "@/lib/budget-calc";
import Link from "next/link";
import { BudgetList, type BudgetSummary } from "./budget-list";

export const metadata = { title: "Бюджеты и прогнозы" };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function BudgetListPage() {
  const session = await requireSession();
  const rows = await prisma.budgetScenario.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { updatedAt: "desc" },
  });
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
      <section aria-label="Прогнозы" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Прогнозы</h2>
        <Link href="/budget/forecast" className="block max-w-md rounded-lg border border-neutral-200 bg-white p-4 shadow-sm hover:border-neutral-400">
          <span className="text-sm font-semibold">Сырьё на остаток FW26</span>
          <span className="mt-1 block text-xs text-neutral-500">Сколько шкур уйдёт на ещё не пришедшие артикулы и сколько останется по типам меха.</span>
        </Link>
      </section>
    </div>
  );
}
