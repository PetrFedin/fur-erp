/**
 * Install fully synthetic budget fixtures in an already copied *_demo database.
 * No production source values are read. This module intentionally does not use
 * the real Budget PCS seed or the confidential budget's lines/params.
 */
import { prisma } from "../src/lib/prisma";
import fixture from "./demo-budget-fixtures.json";

type Node = { id:string; kind:string; parentId:string|null; pcs:number; hides:number; hidePrice:number; meters:number; meterPrice:number; work:number; [key:string]:unknown };
type Pcs = { pcs:number; avg:number|null; st:number[]; [key:string]:unknown };

export async function installSyntheticBudgetFixtures(orgId:string) {
  const nodes = fixture.budget.nodes as Node[];
  const pcs = fixture.pcs.rows as Pcs[];
  const ids = new Set(nodes.map((n) => n.id));
  const parents = new Set(nodes.map((n) => n.parentId).filter(Boolean));
  const leaves = nodes.filter((n) => n.kind !== "fur" && !parents.has(n.id));
  const totalPcs = leaves.reduce((s, n) => s + n.pcs, 0);
  if (!ids.size || ids.size !== nodes.length || !pcs.length ||
      pcs.some((r) => !Number.isFinite(r.pcs) || r.st.length !== 26) ||
      totalPcs !== pcs.reduce((s, r) => s + r.pcs, 0) ||
      leaves.some((n) => n.pcs <= 0 || n.hides < 0 || n.hidePrice <= 0 || n.work <= 0)) {
    throw new Error("Invalid synthetic budget fixture: refused to publish");
  }
  const expectedTotal = leaves.reduce((s, n) => {
    const material = n.hides * n.hidePrice + n.meters * n.meterPrice;
    return s + n.pcs * (material * (1 + fixture.budget.params.c4 / 100) + n.work);
  }, 0);
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    throw new Error("Synthetic budget has no meaningful total");
  }
  const now = new Date().toISOString();
  const old = await prisma.budgetScenario.findMany({
    where: { organizationId: orgId }, select: { id: true },
  });
  if (old.length) {
    await prisma.budgetScenario.deleteMany({ where: { organizationId: orgId } });
  }
  await prisma.budgetScenario.create({
    data: {
      organizationId: orgId, name: fixture.budget.name, season: fixture.budget.season,
      status: "DRAFT", comment: fixture.budget.comment,
      lines: nodes as object[], params: fixture.budget.params, updatedBy: "Демо",
      createdBy: "Демо",
    },
  });

  // Re-create only the demo-budget state. Do not disturb other SystemState features.
  await prisma.systemState.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { key: { startsWith: "budget-pcs:" } },
        { key: { startsWith: "raw-forecast:" } },
        { key: { in: ["budget-pcs-seeded", "raw-forecast-seeded"] } },
      ],
    },
  });
  const state = [
    { key: "budget-pcs-seeded", value: true },
    { key: "raw-forecast-seeded", value: true },
    { key: "budget-pcs:demo-fw27", value: {
      name: fixture.pcs.name, season: fixture.pcs.season, supplier: fixture.pcs.supplier,
      asOf: fixture.pcs.asOf, rows: pcs, params: fixture.pcs.params,
      createdAt: now, updatedBy: "Демо",
    }},
    { key: "raw-forecast:demo-fw26", value: {
      ...fixture.forecast, createdAt: now,
    }},
  ];
  for (const row of state) {
    await prisma.systemState.create({
      data: { organizationId: orgId, key: row.key, value: row.value as object },
    });
  }
  const saved = await prisma.budgetScenario.findFirst({
    where: { organizationId: orgId }, select: { lines: true },
  });
  if (!Array.isArray(saved?.lines) || saved.lines.length !== nodes.length) {
    throw new Error("Synthetic budget verification failed");
  }
  const pcsState = await prisma.systemState.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: "budget-pcs:demo-fw27" } },
  });
  const forecastState = await prisma.systemState.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: "raw-forecast:demo-fw26" } },
  });
  if (!pcsState || !forecastState) throw new Error("Synthetic PCS/forecast verification failed");
  console.log(`[synthetic demo] budget: ${nodes.length} nodes, ${totalPcs} units, total=${Math.round(expectedTotal)}; PCS: ${pcs.length} rows; forecast: 1`);
}
