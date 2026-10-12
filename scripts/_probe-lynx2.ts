import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const it = await prisma.purchaseItem.findFirst({ where: { rawMaterial: { name: "Рысь" }, purchase: { organizationId: org } }, select: { lotNumber: true, quantity: true, unitPrice: true, subtotal: true, costPlan: true, purchase: { select: { number: true, notes: true } } } });
  console.log(JSON.stringify(it, null, 1));
  const labels = await prisma.purchaseItem.findMany({ where: { rawMaterial: { name: "Рысь" }, purchase: { organizationId: org } }, select: { costPlan: true } });
  const d = new Map<string, Set<number>>();
  for (const l of labels) for (const x of ((l.costPlan as any)?.costBreakdown?.items ?? [])) { const s = d.get(x.label) ?? new Set(); s.add(Math.round(x.value * 1000) / 1000); d.set(x.label, s); }
  for (const [k, v] of d) console.log(k, [...v].slice(0, 6), v.size);
})().finally(() => prisma.$disconnect());
