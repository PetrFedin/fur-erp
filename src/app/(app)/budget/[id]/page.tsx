import { Breadcrumbs } from "@/components/breadcrumbs";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadBudgetStats } from "@/lib/budget-stats";
import { articleHint, articleLabel } from "@/lib/article-label";
import { DEFAULT_PARAMS, normKey, parseNodes, type BudgetParams } from "@/lib/budget-calc";
import { BudgetEditor } from "../budget-editor";

export const metadata = { title: "Бюджет" };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function BudgetVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const row = await prisma.budgetScenario.findFirst({ where: { id, organizationId: orgId } });
  if (!row) notFound();
  const [stats, furs, cats, models] = await Promise.all([
    loadBudgetStats(orgId),
    prisma.furRef.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.categoryRef.findMany({ where: { organizationId: orgId }, select: { name: true, group: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productModel.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, aliases: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const articles = models.map((m) => ({
    id: m.id,
    label: articleLabel(m),
    hint: articleHint(m),
    cat: (m.category ?? "").trim(),
    search: [m.name, m.sku, m.category, m.salesCode, m.salesName, ...m.aliases].filter(Boolean).join(" ").toLowerCase(),
  }));
  // Группы категорий (у аксессуаров длина не вводится).
  const catGroups: Record<string, string> = {};
  for (const c of cats) if (c.group) catGroups[normKey(c.name)] = c.group;
  const bp: BudgetParams = { ...DEFAULT_PARAMS, ...(row.params as Partial<BudgetParams>) };
  const furNames = Array.from(new Set([...furs.map((f) => f.name), "Норка+Соболь"]));
  return (
    <div className="flex flex-col gap-4">
    <Breadcrumbs items={[{ label: "Бюджет", href: "/budget" }, { label: row.name }]} />
    <BudgetEditor
      id={row.id}
      name={row.name}
      season={row.season}
      status={row.status === "APPROVED" ? "APPROVED" : "DRAFT"}
      initialComment={row.comment ?? ""}
      initialParams={bp}
      initialNodes={parseNodes(row.lines)}
      initialStats={stats}
      furNames={furNames}
      catNames={cats.map((c) => c.name)}
      catGroups={catGroups}
      articles={articles}
      canEdit={EDIT_ROLES.includes(session.user.role)}
      savedAt={row.updatedAt.toISOString()}
      savedBy={row.updatedBy}
      createdAt={row.createdAt.toISOString()}
    />
    </div>
  );
}
